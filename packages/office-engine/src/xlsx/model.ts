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
  groupXlsxFilterStates,
  groupXlsxStructuralOps,
  isXlsxFilterOp,
  isXlsxSheetOp,
  isXlsxStructuralOp,
  toA1,
  type XlsxEditOp,
  type XlsxFilterOp,
  type XlsxSheetFilterState,
  type XlsxSheetOp,
  type XlsxSheetResolver,
  type XlsxSheetStructuralOps,
  type XlsxStructuralOp,
} from "./ops.ts";
import { groupXlsxPageSetupStates, isXlsxPageSetupOp, type XlsxPageSetupFields, type XlsxPageSetupOp, type XlsxSheetPageSetupState } from "./page-setup.ts";

/** The vendored gateway's SheetEditPlan, rebuilt from the model's final sheet
 *  state at save time (xlsx-sheets.ts SheetEditPlan). `order` is the COMPLETE
 *  final tab order; renames/additions name final sheets, removals name the
 *  original file name, hidden changes are keyed by the original name (or the
 *  added name). */
export interface XlsxSheetEditPlan {
  readonly renames: readonly { readonly sheetName: string; readonly newName: string }[];
  readonly additions: readonly { readonly name: string; readonly sourceSheetName?: string | undefined }[];
  readonly removals: readonly string[];
  readonly order: readonly string[];
  readonly hiddenChanges?: readonly { readonly sheetName: string; readonly hidden: boolean }[] | undefined;
  readonly orderChanged?: boolean | undefined;
}

/** One sheet's session state: a stable identity plus the user-visible current
 *  name. Sheet ops are applied in emission order, so `name` is what every
 *  later wire op addresses and what the save plan reports; `originalName` is
 *  the name the package on disk still carries (undefined for a sheet added
 *  this session). */
interface ModelSheetState {
  readonly key: string;
  readonly originalName?: string | undefined;
  name: string;
  hidden: boolean;
  hiddenTouched: boolean;
  readonly added: boolean;
  readonly sourceKey?: string | undefined;
}

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
   *  gateway replays this list first and then writes the cell edits. The map
   *  key is the sheet's CURRENT name; a rename rewrites both. */
  private structural = new Map<string, XlsxStructuralOp[]>();
  /** Declarative filter journal: the LAST filter op per sheet, in first-touch
   *  order. A filter snapshot is whole-sheet, so only the last one matters
   *  (the gateway applies filterStates after structural replay and cell
   *  edits). The map key is the sheet's CURRENT name; a rename rewrites it. */
  private filters = new Map<string, XlsxFilterOp>();
  /** Declarative page-setup journal: the LAST page-setup op per sheet, in
   *  first-touch order (whole-sheet, like filters). The map key is the
   *  sheet's CURRENT name; a rename rewrites it. */
  private pageSetups = new Map<string, XlsxPageSetupOp>();
  /** Ordered sheet registry: file sheets in tab order, plus additions. Ops
   *  are applied in emission order, so every entry's `name` is current. */
  private sheetStates: ModelSheetState[] = [];
  /** Original file names of sheets removed this session (additions removed
   *  before save leave no trace). */
  private removedOriginals: string[] = [];
  /** True once a reorder op applied: calcChain sheet indexes go stale. */
  private sheetOrderChanged = false;
  /** Count of applied sheet ops — the save plan exists only when > 0. */
  private sheetOpsApplied = 0;
  private addedSheetSequence = 0;
  private touched = false;
  /** Monotonic edit counter — a two-save chain can prove the base advanced. */
  revision = 0;

  constructor(imported: XlsxWorkbookSnapshot, inputSha256: string) {
    this.snapshot = imported;
    this.inputSha256 = inputSha256;
    this.sheetStates = imported.sheets.map((sheet) => ({
      key: sheet.name,
      originalName: sheet.name,
      name: sheet.name,
      hidden: false,
      hiddenTouched: false,
      added: false,
    }));
  }

  get isDirty(): boolean {
    return this.touched;
  }

  /** Sheet-name resolver the ops parser validates targets against. It is a
   *  LIVE view: the adapter parses and applies in one pass, so an op after a
   *  rename resolves to the new name and a removed sheet stops resolving.
   *  `nameForId` maps a grid id to the sheet's current name (undefined once
   *  that sheet is gone). */
  resolver(sheetNamesById: Readonly<Record<string, string>>): XlsxSheetResolver {
    return {
      sheetNames: () => this.sheetStates.map((sheet) => sheet.name),
      nameForId: (id) => {
        const original = sheetNamesById[id];
        if (original === undefined) return undefined;
        return this.sheetStates.find((sheet) => sheet.originalName === original)?.name;
      },
    };
  }

  /** Cells of one sheet with pending edits overlaid (the save-plan view). An
   *  added sheet has no file cells; a renamed sheet reads its original part. */
  cells(sheetName: string): Record<string, XlsxCellState> {
    const sheet = this.sheetStates.find((s) => s.name === sheetName);
    if (!sheet) throw new XlsxEngineError("bad_target", "unknown sheet " + JSON.stringify(sheetName));
    const base =
      sheet.originalName === undefined
        ? {}
        : this.snapshot.sheets.find((s) => s.name === sheet.originalName)?.cells ?? {};
    return overlayCells(base, this.pendingFor(sheetName));
  }

  private pendingFor(sheetName: string): Map<string, PendingCell> {
    const out = new Map<string, PendingCell>();
    for (const [key, entry] of this.pending) {
      if (entry.sheetName === sheetName) out.set(key, entry);
    }
    return out;
  }

  applyEdit(op: XlsxEditOp): void {
    if (isXlsxSheetOp(op)) {
      this.applySheetOp(op);
      return;
    }
    if (isXlsxFilterOp(op)) {
      this.applyFilterOp(op);
      return;
    }
    if (isXlsxPageSetupOp(op)) {
      this.applyPageSetupOp(op);
      return;
    }
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

  /** Filters are declarative whole-sheet snapshots: the last op per sheet
   *  wins, in first-touch order. Nothing shifts — filter coordinates are
   *  final when the renderer snapshots them (the gateway applies the states
   *  after structural replay and cell edits). */
  private applyFilterOp(op: XlsxFilterOp): void {
    this.filters.set(op.sheetName, op);
    this.touched = true;
    this.revision += 1;
  }

  /** Page setup is a declarative whole-sheet snapshot; the op carries only the
   *  fields the UI changed, so the journal merges field-wise (last write per
   *  field wins) in first-touch order — a second dialog apply must not drop
   *  the first one's settings. The gateway then merges each present field into
   *  the file and keeps absent fields verbatim. */
  private applyPageSetupOp(op: XlsxPageSetupOp): void {
    const previous = this.pageSetups.get(op.sheetName)?.setup;
    const setup: XlsxPageSetupFields = { ...previous };
    for (const [key, value] of Object.entries(op.setup)) {
      if (value !== undefined) (setup as Record<string, unknown>)[key] = value;
    }
    this.pageSetups.set(op.sheetName, { kind: "set_page_setup", sheetName: op.sheetName, setup });
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

  // ── sheet ops (add / rename / remove / duplicate / reorder / hide) ───────
  //
  // Applied in emission order against the live sheet registry. A rename
  // rewrites pending cell edits and the structural journal so both keep
  // addressing the sheet's current name; a removal drops them (nothing may
  // reach a part the save deletes); a duplicate clones the source's pending
  // state, mirroring the renderer journal's own copy — the gateway seeds the
  // clone from the source PART, and the cloned edits bring it to the source's
  // on-screen state.

  private applySheetOp(op: XlsxSheetOp): void {
    switch (op.kind) {
      case "add_sheet":
        this.sheetStates.splice(this.insertIndex(op.index), 0, this.makeAddedSheet(op.name, undefined));
        break;
      case "duplicate_sheet": {
        const source = this.requireSheet(op.sheetName);
        const addition = this.makeAddedSheet(op.name, source.key);
        this.sheetStates.splice(this.insertIndex(op.index), 0, addition);
        this.cloneSheetEdits(source.name, addition.name);
        break;
      }
      case "rename_sheet": {
        const sheet = this.requireSheet(op.sheetName);
        if (sheet.name !== op.newName) {
          const previous = sheet.name;
          sheet.name = op.newName;
          this.renamePendingSheet(previous, op.newName);
        }
        break;
      }
      case "remove_sheet": {
        const sheet = this.requireSheet(op.sheetName);
        if (sheet.originalName !== undefined) this.removedOriginals.push(sheet.originalName);
        this.dropPendingSheet(sheet.name);
        this.sheetStates.splice(this.sheetStates.indexOf(sheet), 1);
        break;
      }
      case "reorder_sheet": {
        const sheet = this.requireSheet(op.sheetName);
        this.sheetStates.splice(this.sheetStates.indexOf(sheet), 1);
        this.sheetStates.splice(op.index, 0, sheet);
        this.sheetOrderChanged = true;
        break;
      }
      case "set_sheet_hidden": {
        const sheet = this.requireSheet(op.sheetName);
        sheet.hidden = op.hidden;
        sheet.hiddenTouched = true;
        break;
      }
    }
    this.sheetOpsApplied += 1;
    this.touched = true;
    this.revision += 1;
  }

  private requireSheet(name: string): ModelSheetState {
    const sheet = this.sheetStates.find((candidate) => candidate.name === name);
    if (!sheet) throw new XlsxEngineError("bad_target", "unknown sheet " + JSON.stringify(name));
    return sheet;
  }

  /** Insertion point for an addition: an explicit 0-based position (already
   *  range-checked by the parser) or the end of the tab strip. */
  private insertIndex(index: number | undefined): number {
    return index ?? this.sheetStates.length;
  }

  private makeAddedSheet(name: string, sourceKey: string | undefined): ModelSheetState {
    this.addedSheetSequence += 1;
    return {
      key: `added:${this.addedSheetSequence}`,
      name,
      hidden: false,
      hiddenTouched: false,
      added: true,
      ...(sourceKey === undefined ? {} : { sourceKey }),
    };
  }

  private renamePendingSheet(previous: string, next: string): void {
    const moved = new Map<string, PendingCell>();
    for (const entry of this.pending.values()) {
      if (entry.sheetName !== previous) {
        moved.set(JSON.stringify([entry.sheetName, toA1(entry.row, entry.column)]), entry);
        continue;
      }
      moved.set(JSON.stringify([next, toA1(entry.row, entry.column)]), {
        ...entry,
        sheetName: next,
        edit: { ...entry.edit, sheetName: next },
      });
    }
    this.pending = moved;
    const ops = this.structural.get(previous);
    if (ops !== undefined) {
      this.structural.delete(previous);
      this.structural.set(next, ops.map((structural) => ({ ...structural, sheetName: next })));
    }
    const filter = this.filters.get(previous);
    if (filter !== undefined) {
      this.filters.delete(previous);
      this.filters.set(next, { ...filter, sheetName: next });
    }
    const pageSetup = this.pageSetups.get(previous);
    if (pageSetup !== undefined) {
      this.pageSetups.delete(previous);
      this.pageSetups.set(next, { ...pageSetup, sheetName: next });
    }
  }

  private dropPendingSheet(sheetName: string): void {
    for (const [key, entry] of this.pending) {
      if (entry.sheetName === sheetName) this.pending.delete(key);
    }
    this.structural.delete(sheetName);
    this.filters.delete(sheetName);
    this.pageSetups.delete(sheetName);
  }

  private cloneSheetEdits(fromName: string, toName: string): void {
    for (const entry of [...this.pending.values()]) {
      if (entry.sheetName !== fromName) continue;
      this.pending.set(JSON.stringify([toName, toA1(entry.row, entry.column)]), {
        ...entry,
        sheetName: toName,
        edit: { ...entry.edit, sheetName: toName },
      });
    }
    const ops = this.structural.get(fromName);
    if (ops !== undefined) {
      this.structural.set(toName, ops.map((structural) => ({ ...structural, sheetName: toName })));
    }
    const filter = this.filters.get(fromName);
    if (filter !== undefined) this.filters.set(toName, { ...filter, sheetName: toName });
    const pageSetup = this.pageSetups.get(fromName);
    if (pageSetup !== undefined) this.pageSetups.set(toName, { ...pageSetup, sheetName: toName });
  }

  /** The gateway's SheetEditPlan rebuilt from the model's final state. Field
   *  names follow the vendored interface exactly: renames/addition names are
   *  final, removals are original file names, `order` is the complete final
   *  tab order and hidden changes are keyed by the original (or added) name. */
  pendingSheetPlan(): XlsxSheetEditPlan | undefined {
    if (this.sheetOpsApplied === 0) return undefined;
    const live = this.sheetStates;
    const renames = live.flatMap((sheet) =>
      !sheet.added && sheet.originalName !== sheet.name
        ? [{ sheetName: sheet.originalName as string, newName: sheet.name }]
        : [],
    );
    const additions = live.flatMap((sheet) => {
      if (!sheet.added) return [];
      const sourceSheetName = this.duplicateSourceOriginal(sheet.sourceKey);
      return [{ name: sheet.name, ...(sourceSheetName === undefined ? {} : { sourceSheetName }) }];
    });
    const hiddenChanges = live.flatMap((sheet) =>
      sheet.hiddenTouched ? [{ sheetName: sheet.originalName ?? sheet.name, hidden: sheet.hidden }] : [],
    );
    return {
      renames,
      additions,
      removals: [...this.removedOriginals],
      order: live.map((sheet) => sheet.name),
      ...(hiddenChanges.length === 0 ? {} : { hiddenChanges }),
      ...(this.sheetOrderChanged ? { orderChanged: true } : {}),
    };
  }

  /** Walks a duplicate chain back to a file sheet (its original name is the
   *  clone base the gateway can resolve). A chain that ends at an added sheet,
   *  or at one removed before save, has no file part — the clone base is
   *  blank and the cloned pending edits carry the content. */
  private duplicateSourceOriginal(sourceKey: string | undefined): string | undefined {
    let key = sourceKey;
    const seen = new Set<string>();
    while (key !== undefined && !seen.has(key)) {
      seen.add(key);
      if (!key.startsWith("added:")) return key;
      const sheet = this.sheetStates.find((candidate) => candidate.key === key);
      if (sheet === undefined) return undefined;
      key = sheet.sourceKey;
    }
    return undefined;
  }

  /** The name the package on disk currently holds for a sheet the envelope
   *  addresses by its current name: the original file name for a pre-existing
   *  sheet, the (final) name itself for an addition. Cell edits, structural
   *  ops and recalc reads are translated through this before the gateway call
   *  — the gateway resolves parts by the CURRENT file names and applies the
   *  plan's renames last. */
  gatewaySheetName(name: string): string {
    return this.sheetStates.find((sheet) => sheet.name === name)?.originalName ?? name;
  }

  /** The structural journal for the gateway's structuralOps argument: ops
   *  grouped per sheet, first-touch sheet order, journal order inside a
   *  sheet. Empty when the session has no structural edits. */
  pendingStructuralOps(): XlsxSheetStructuralOps[] {
    return groupXlsxStructuralOps([...this.structural.values()].flat());
  }

  /** The filter plan for the gateway's filterStates argument: one declarative
   *  state per touched sheet, last write per sheet, in first-touch order. A
   *  sheet whose last filter op was a clear folds to `filter: null` (remove
   *  the autoFilter, unhide the visibility range). Empty when the session has
   *  no filter edits. */
  pendingFilterStates(): XlsxSheetFilterState[] {
    return groupXlsxFilterStates([...this.filters.values()]);
  }

  /** The page-setup plan for the gateway's pageSetupStates argument: one
   *  declarative state per touched sheet, last write per sheet, in first-touch
   *  order. Empty when the session has no page-setup edits. */
  pendingPageSetupStates(): XlsxSheetPageSetupState[] {
    return groupXlsxPageSetupStates([...this.pageSetups.values()]);
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
   *  These are exactly the cells whose cached <v> must be refreshed on save.
   *  Added sheets are skipped: the recalc sidecar reads the ORIGINAL bytes,
   *  where such a part does not exist, and an identity-changing sheet op skips
   *  the recalc pass entirely (adapter.serialize). */
  formulaCellsAfterEdits(): { sheetName: string; row: number; column: number; address: string }[] {
    const out: { sheetName: string; row: number; column: number; address: string }[] = [];
    for (const state of this.sheetStates) {
      if (state.added) continue;
      const cells = this.cells(state.name);
      for (const [address, cell] of Object.entries(cells)) {
        if (cell.formula === undefined) continue;
        const { row, column } = a1ToRowColumn(address, "<model>", "address");
        out.push({ sheetName: state.name, row, column, address });
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
   *  of docx commitSaved. The sheet registry is rebuilt from the new snapshot,
   *  so final names become the new originals. */
  rebase(newSnapshot: XlsxWorkbookSnapshot, newInputSha256: string): void {
    this.snapshot = newSnapshot;
    this.inputSha256 = newInputSha256;
    this.pending.clear();
    this.structural.clear();
    this.filters.clear();
    this.pageSetups.clear();
    this.sheetStates = newSnapshot.sheets.map((sheet) => ({
      key: sheet.name,
      originalName: sheet.name,
      name: sheet.name,
      hidden: false,
      hiddenTouched: false,
      added: false,
    }));
    this.removedOriginals = [];
    this.sheetOrderChanged = false;
    this.sheetOpsApplied = 0;
    this.addedSheetSequence = 0;
    this.touched = false;
    this.modelRevision += 1;
  }
}

export function createXlsxSessionModel(imported: XlsxWorkbookSnapshot, inputSha256: string): XlsxSessionModel {
  return new XlsxSessionModel(imported, inputSha256);
}
