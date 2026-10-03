// XLSX session model — the editable workbook state an open() produces.
//
// The model owns a pending-edit plan plus the post-edit formula map: every
// cell that will carry <f> after the pending edits apply. Save plans a single
// assemble pass (cell edits + refreshed cached formula values) — never the
// input bytes with a success claim, and never a formula replaced by its
// displayed value.
import { XlsxEngineError, type XlsxCellEdit, type XlsxCellState, type XlsxRecalcEdit, type XlsxWorkbookSnapshot } from "./engine.ts";
import {
  a1ToRowColumn,
  groupXlsxStructuralOps,
  isXlsxStructuralOp,
  toA1,
  type XlsxEditOp,
  type XlsxSheetResolver,
  type XlsxSheetStructuralOps,
  type XlsxStructuralOp,
} from "./ops.ts";

/** One pending cell: content and independent style fields fold separately. */
interface PendingCell {
  readonly sheetName: string;
  readonly row: number;
  readonly column: number;
  readonly edit: XlsxCellEdit;
  readonly recalcInput: string | null;
}

/** The cell map a serialize plans against: snapshot cells overlaid with the
 *  pending edits (a clear removes the entry, a set replaces it). */
function overlayCells(
  base: Readonly<Record<string, XlsxCellState>>,
  pending: Map<string, PendingCell>,
): Record<string, XlsxCellState> {
  const cells: Record<string, XlsxCellState> = { ...base };
  for (const entry of pending.values()) {
    const address = toA1(entry.row, entry.column);
    if (entry.edit.writeValue) {
      cells[address] = entry.edit.cell;
      if (cells[address].value === null && cells[address].formula === undefined) delete cells[address];
    } else {
      cells[address] = cells[address] ?? { value: null };
    }
  }
  return cells;
}

export class XlsxSessionModel {
  /** The engine's parse result — sheets read through `cells()` reflect edits. */
  snapshot: XlsxWorkbookSnapshot;
  /** sha256 of the workbook bytes this model was opened from — the save path
   *  re-verifies it before any mutation is attempted. */
  inputSha256: string;
  /** Bumped on every successful rebase — one term of the session binding. */
  modelRevision = 0;
  private pending = new Map<string, PendingCell>();
  /** Structural journal: row/column ops per sheet, in replay order. Cell
   *  entries above are kept in post-operation coordinates (the renderer's
   *  journal applies every shift to its own entries the same way), so the
   *  gateway replays this list first and then writes the cell edits. */
  private structural = new Map<string, XlsxStructuralOp[]>();
  private touched = false;
  /** Monotonic edit counter — a two-save chain can prove the base advanced. */
  revision = 0;

  constructor(imported: XlsxWorkbookSnapshot, inputSha256: string) {
    this.snapshot = imported;
    this.inputSha256 = inputSha256;
  }

  get isDirty(): boolean {
    return this.touched;
  }

  /** Sheet-name resolver the ops parser validates targets against. */
  resolver(sheetNamesById: Readonly<Record<string, string>>): XlsxSheetResolver {
    const names = this.snapshot.sheets.map((s) => s.name);
    return {
      sheetNames: () => names,
      nameForId: (id) => sheetNamesById[id],
    };
  }

  /** Cells of one sheet with pending edits overlaid (the save-plan view). */
  cells(sheetName: string): Record<string, XlsxCellState> {
    const sheet = this.snapshot.sheets.find((s) => s.name === sheetName);
    if (!sheet) throw new XlsxEngineError("bad_target", "unknown sheet " + JSON.stringify(sheetName));
    return overlayCells(sheet.cells, this.pendingFor(sheetName));
  }

  private pendingFor(sheetName: string): Map<string, PendingCell> {
    const out = new Map<string, PendingCell>();
    for (const [key, entry] of this.pending) {
      if (entry.sheetName === sheetName) out.set(key, entry);
    }
    return out;
  }

  applyEdit(op: XlsxEditOp): void {
    if (isXlsxStructuralOp(op)) {
      this.applyStructuralOp(op);
      return;
    }
    const key = JSON.stringify([op.target.sheetName, op.target.address]);
    const previous = this.pending.get(key);
    const writesContent = op.kind === "clear_cell" || op.writeValue;
    const resetsStyle = op.kind === "set_cell" && op.styleReset === true;
    const delta = op.kind === "set_cell" ? op.style : undefined;
    // A nested style field (border, color, fill) is a complete gateway value.
    // Replace that field atomically; keep the other independently edited fields.
    const style = resetsStyle ? delta : previous?.edit.style || delta ? { ...previous?.edit.style, ...delta } : undefined;
    const styleReset = resetsStyle || previous?.edit.styleReset === true;
    const cell = writesContent
      ? op.kind === "clear_cell" ? { value: null } : op.cell
      : previous?.edit.cell ?? (op.kind === "set_cell" ? op.cell : { value: null });
    this.pending.set(key, {
      sheetName: op.target.sheetName,
      row: op.target.row,
      column: op.target.column,
      edit: {
        sheetName: op.target.sheetName,
        row: op.target.row,
        column: op.target.column,
        writeValue: writesContent || previous?.edit.writeValue === true,
        cell: structuredClone(cell),
        ...(style === undefined ? {} : { style: structuredClone(style) }),
        ...(styleReset ? { styleReset: true } : {}),
      },
      // Styling preserves an earlier native input, including a clear's "".
      recalcInput: writesContent ? op.recalcInput : previous?.recalcInput ?? null,
    });
    this.touched = true;
    this.revision += 1;
  }

  /** Records one structural op and moves already-pending cells into the
   *  op's post-operation space — exactly the shift the renderer journal
   *  applies when it records the same op, so both sides of the save agree on
   *  final coordinates. Ops that don't shift anything (sizes, hidden flags,
   *  outline levels) only append to the journal. */
  private applyStructuralOp(op: XlsxStructuralOp): void {
    const ops = this.structural.get(op.sheetName) ?? [];
    ops.push(op);
    this.structural.set(op.sheetName, ops);
    if ("index" in op) this.shiftPendingCells(op);
    this.touched = true;
    this.revision += 1;
  }

  private shiftPendingCells(op: Extract<XlsxStructuralOp, { index: number }>): void {
    const axis = op.kind === "insert_cols" || op.kind === "remove_cols" ? "column" : "row";
    const removing = op.kind === "remove_rows" || op.kind === "remove_cols";
    const move = (position: number): number | null => {
      if (removing) {
        if (position >= op.index && position < op.index + op.count) return null;
        return position >= op.index + op.count ? position - op.count : position;
      }
      return position >= op.index ? position + op.count : position;
    };
    const shifted = new Map<string, PendingCell>();
    for (const entry of this.pending.values()) {
      if (entry.sheetName !== op.sheetName) {
        shifted.set(JSON.stringify([entry.sheetName, toA1(entry.row, entry.column)]), entry);
        continue;
      }
      const moved = move(axis === "row" ? entry.row : entry.column);
      if (moved === null) continue;
      const row = axis === "row" ? moved : entry.row;
      const column = axis === "column" ? moved : entry.column;
      shifted.set(JSON.stringify([entry.sheetName, toA1(row, column)]), { ...entry, row, column, edit: { ...entry.edit, row, column } });
    }
    this.pending = shifted;
  }

  /** The structural journal for the gateway's structuralOps argument: ops
   *  grouped per sheet, first-touch sheet order, journal order inside a
   *  sheet. Empty when the session has no structural edits. */
  pendingStructuralOps(): XlsxSheetStructuralOps[] {
    return groupXlsxStructuralOps([...this.structural.values()].flat());
  }

  /** Edits in insertion order (last write wins per cell already applied). */
  pendingEdits(): XlsxCellEdit[] {
    return [...this.pending.values()].map((e) => e.edit);
  }

  /** The recalc wire edits — one per pending writeValue edit; style-only
   *  edits carry no input so IronCalc never hears about them. */
  pendingRecalcEdits(): XlsxRecalcEdit[] {
    const out: XlsxRecalcEdit[] = [];
    for (const entry of this.pending.values()) {
      if (entry.recalcInput === null) continue;
      out.push({ sheet: entry.sheetName, row: entry.row, column: entry.column, input: entry.recalcInput });
    }
    return out;
  }

  /** Every cell that carries a formula AFTER the pending edits apply —
   *  existing <f> cells a literal overwrite drops, plus new formula edits.
   *  These are exactly the cells whose cached <v> must be refreshed on save. */
  formulaCellsAfterEdits(): { sheetName: string; row: number; column: number; address: string }[] {
    const out: { sheetName: string; row: number; column: number; address: string }[] = [];
    for (const sheet of this.snapshot.sheets) {
      const cells = this.cells(sheet.name);
      for (const [address, cell] of Object.entries(cells)) {
        if (cell.formula === undefined) continue;
        const { row, column } = a1ToRowColumn(address, "<model>", "address");
        out.push({ sheetName: sheet.name, row, column, address });
      }
    }
    return out;
  }

  /** A sheet whose formula a pending edit dropped (literal over <f>) still
   *  must NOT be recalc-read as a formula — the engine types it as a literal
   *  after edits, so coverage checks read the post-edit model. */
  coveredFormulaCount(): number {
    return this.formulaCellsAfterEdits().length;
  }

  /** Re-base after a successful serialize: the produced bytes become the new
   *  original (their own parse) and pending edits drain — the xlsx equivalent
   *  of docx commitSaved. */
  rebase(newSnapshot: XlsxWorkbookSnapshot, newInputSha256: string): void {
    this.snapshot = newSnapshot;
    this.inputSha256 = newInputSha256;
    this.pending.clear();
    this.structural.clear();
    this.touched = false;
    this.modelRevision += 1;
  }
}

export function createXlsxSessionModel(imported: XlsxWorkbookSnapshot, inputSha256: string): XlsxSessionModel {
  return new XlsxSessionModel(imported, inputSha256);
}
