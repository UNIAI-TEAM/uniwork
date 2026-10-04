import {
  isXlsxFilterOp,
  isXlsxPageSetupOp,
  isXlsxSheetOp,
  isXlsxStructuralOp,
  parseXlsxOps,
  type XlsxCellState,
  type XlsxEditOp,
  type XlsxSheetOp,
  type XlsxWorkbookSnapshot,
  type XlsxWorksheet,
} from "@uniwork/office-engine/xlsx";

/** A gateway value snapshot carries no style fields. Keep serializable deltas
 *  on cells so a host that restores a protected draft can rebuild exactly the
 *  same server edit jobs the live session queued. */
export interface XlsxJournalDraftCell extends XlsxCellState {
  style?: Record<string, unknown>;
  styleReset?: boolean;
}

/** Deterministic id for a sheet added to the client snapshot. The server part
 *  is named by the plan's additions; the local id only keys the tab strip. */
function freshSheetId(sheets: readonly XlsxWorksheet[]): string {
  const used = new Set(sheets.map((sheet) => sheet.id));
  for (let n = 1; ; n += 1) {
    const id = `sheet-added-${n}`;
    if (!used.has(id)) return id;
  }
}

/** Applies one sheet op to the client snapshot, in emission order (the same
 *  ordering rule as the engine session model): a rename makes later ops
 *  address the new name, additions land at their final index and removals
 *  drop the sheet, so the tab strip mirrors what the renderer shows. */
function applySheetOp(sheets: XlsxWorksheet[], op: XlsxSheetOp): void {
  switch (op.kind) {
    case "add_sheet":
      sheets.splice(op.index ?? sheets.length, 0, { id: freshSheetId(sheets), name: op.name, cells: {}, hidden: false });
      return;
    case "duplicate_sheet": {
      const source = sheets.find((sheet) => sheet.name === op.sheetName);
      if (!source) throw new Error("xlsx_edit_unknown_sheet");
      sheets.splice(op.index ?? sheets.length, 0, {
        id: freshSheetId(sheets), name: op.name, cells: structuredClone(source.cells), hidden: false,
      });
      return;
    }
    case "rename_sheet": {
      const index = sheets.findIndex((sheet) => sheet.name === op.sheetName);
      if (index < 0) throw new Error("xlsx_edit_unknown_sheet");
      sheets[index] = { ...sheets[index]!, name: op.newName };
      return;
    }
    case "remove_sheet": {
      const index = sheets.findIndex((sheet) => sheet.name === op.sheetName);
      if (index < 0) throw new Error("xlsx_edit_unknown_sheet");
      sheets.splice(index, 1);
      return;
    }
    case "reorder_sheet": {
      const index = sheets.findIndex((sheet) => sheet.name === op.sheetName);
      if (index < 0) throw new Error("xlsx_edit_unknown_sheet");
      const [sheet] = sheets.splice(index, 1);
      sheets.splice(op.index, 0, sheet!);
      return;
    }
    case "set_sheet_hidden": {
      const index = sheets.findIndex((sheet) => sheet.name === op.sheetName);
      if (index < 0) throw new Error("xlsx_edit_unknown_sheet");
      sheets[index] = { ...sheets[index]!, hidden: op.hidden };
      return;
    }
  }
}

/** Apply one parsed op to the working sheet list. Structural ops reshape
 *  rows/columns, which this cell-content snapshot does not model: they ride
 *  the envelope to the server's structuralOps pass unapplied here (the
 *  renderer grid has already shifted what the user sees, and the server
 *  replays the shift before any cell edit). Filter, page-setup snapshots are
 *  declarative sheet state the snapshot does not carry: they ride the
 *  envelope to the server's filterStates / pageSetupStates passes unapplied. */
function applyOp(sheets: XlsxWorksheet[], op: XlsxEditOp): void {
  if (isXlsxSheetOp(op)) {
    applySheetOp(sheets, op);
    return;
  }
  if (isXlsxStructuralOp(op)) return;
  if (isXlsxFilterOp(op)) return;
  if (isXlsxPageSetupOp(op)) return;
  const cells = sheets.find((sheet) => sheet.name === op.target.sheetName)!.cells as Record<string, XlsxJournalDraftCell>;
  const previous = cells[op.target.address];
  const content: XlsxCellState = op.kind === "clear_cell" ? { value: null } : op.writeValue ? op.cell : previous ?? { value: null };
  const reset = op.kind === "set_cell" && op.styleReset;
  const style = { ...(reset ? {} : previous?.style), ...(op.kind === "set_cell" ? op.style : {}) };
  const cell: XlsxJournalDraftCell = { value: content.value, ...(content.formula === undefined ? {} : { formula: content.formula }), ...(content.rawValue === undefined ? {} : { rawValue: content.rawValue }), ...(Object.keys(style).length ? { style } : {}), ...((reset || previous?.styleReset) ? { styleReset: true } : {}) };
  if (cell.value === null && cell.formula === undefined && !cell.style && !cell.styleReset) delete cells[op.target.address];
  else cells[op.target.address] = cell;
}

function cloneSnapshot(snapshot: XlsxWorkbookSnapshot): XlsxWorkbookSnapshot {
  return structuredClone(snapshot);
}

/** Parse and apply interleaved, in emission order: a sheet rename must take
 *  effect before the next op's target resolves (the resolver is a live view
 *  over the working sheet list), exactly as the engine session model does. */
export function applyXlsxJournalToSnapshot(base: XlsxWorkbookSnapshot, operations: readonly unknown[]): XlsxWorkbookSnapshot {
  const next = cloneSnapshot(base);
  const sheets = next.sheets as XlsxWorksheet[];
  parseXlsxOps([...operations], {
    sheetNames: () => sheets.map((sheet) => sheet.name),
    nameForId: (id) => sheets.find((sheet) => sheet.id === id)?.name,
  }, (op) => applyOp(sheets, op));
  return { revision: base.revision + 1, sheets };
}

function snapshotsEqual(left: XlsxCellState | undefined, right: XlsxCellState | undefined): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return left.value === right.value && left.formula === right.formula && left.rawValue === right.rawValue;
}

/** Convert a recovered full snapshot back to the bounded public edit shape.
 *  The server edit job is the only serializer/recalc path, so restoring a
 *  draft must rebuild its queued edits before the next explicit Save. */
export function diffXlsxSnapshotsToOperations(base: XlsxWorkbookSnapshot, next: XlsxWorkbookSnapshot): unknown[] {
  const operations: unknown[] = [];
  const baseSheets = new Map(base.sheets.map((sheet) => [sheet.name, sheet]));
  for (const sheet of next.sheets) {
    const previous = baseSheets.get(sheet.name);
    const previousCells = previous?.cells ?? {};
    for (const [address, cell] of Object.entries(sheet.cells)) {
      const previousCell = previousCells[address] as XlsxJournalDraftCell | undefined;
      const nextCell = cell as XlsxJournalDraftCell;
      const contentChanged = !snapshotsEqual(previousCell, nextCell);
      const styleChanged = JSON.stringify(previousCell?.style) !== JSON.stringify(nextCell.style) || previousCell?.styleReset !== nextCell.styleReset;
      if (!contentChanged && !styleChanged) continue;
      const attributes = { ...(contentChanged ? cell.formula !== undefined ? { formula: cell.formula } : { value: cell.value } : {}), ...(styleChanged && nextCell.styleReset ? { styleReset: true } : {}) };
      operations.push({
        op: "set_cell",
        target: { sheet: sheet.name, cell: address },
        ...(Object.keys(attributes).length ? { attributes } : {}),
        ...(styleChanged && nextCell.style !== undefined ? { style: nextCell.style } : {}),
      });
    }
    for (const address of Object.keys(previousCells)) {
      if (!(address in sheet.cells)) operations.push({ op: "clear_cell", target: { sheet: sheet.name, cell: address } });
    }
  }
  return operations;
}
