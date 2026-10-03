// Wave A / A8 (UNI-926): AutoSum. Pure, renderer-free logic so the group
// button, the editor callback and the tests share exactly one rule set.
//
// The rule (stated in the report): a multi-cell selection is summed as-is
// (`=SUM(<selection>)`, placed below it, or to its right for a single row); a
// single cell guesses the contiguous block of numeric cells directly ABOVE it
// (falling back to the LEFT), bounded by `XLSX_AUTOSUM_GUESS_MAX` rows/columns.
// When nothing numeric is found the action does nothing at all - it never
// inserts a truncated or empty sum.

import { addressParts, columnLabel } from "../xlsx-editor-model";
import type { RendererRangeCell } from "../xlsx-render-model-bridge";
import type { XlsxSelection } from "../types";

/** The one allowlisted cell-edit command AutoSum writes through; the renderer
 *  policy and the existing journal -> set_cell save path are unchanged. */
export const XLSX_AUTOSUM_COMMAND = "sheet.command.set-range-values";

/** Rows/columns a single-cell guess may walk in one direction. */
export const XLSX_AUTOSUM_GUESS_MAX = 1000;

export interface XlsxAutoSumRange {
  /** The summed rectangle (0-based, inclusive). */
  readonly startRow: number;
  readonly endRow: number;
  readonly startColumn: number;
  readonly endColumn: number;
  /** Where `=SUM(...)` is written (0-based). */
  readonly targetRow: number;
  readonly targetColumn: number;
  /** How the range was chosen; surfaced for the report and the tests. */
  readonly kind: "selection" | "guess-above" | "guess-left";
}

/** The minimal cell shape the guess reads (the renderer range payload). */
export type XlsxAutoSumCell = Pick<RendererRangeCell, "row" | "column" | "value">;

/** SUM ignores text and blanks; only a finite number (a typed value or a
 *  formula's cached numeric result) extends a contiguous block. */
export function isNumericCellValue(value: RendererRangeCell["value"]): boolean {
  return typeof value === "number" && Number.isFinite(value);
}

/** The selection normalized to a rectangle; null when an address is malformed. */
export function autoSumSelectionRange(selection: XlsxSelection): {
  startRow: number;
  endRow: number;
  startColumn: number;
  endColumn: number;
} | null {
  const start = addressParts(selection.address);
  const end = selection.endAddress ? addressParts(selection.endAddress) : start;
  if (!start || !end) return null;
  return {
    startRow: Math.min(start.row, end.row),
    endRow: Math.max(start.row, end.row),
    startColumn: Math.min(start.column, end.column),
    endColumn: Math.max(start.column, end.column),
  };
}

/** The numeric cells as a lookup, so a guess is O(block) not O(read). */
function numericIndex(cells: readonly XlsxAutoSumCell[]): Set<string> {
  const index = new Set<string>();
  for (const cell of cells) {
    if (isNumericCellValue(cell.value)) index.add(`${cell.row}:${cell.column}`);
  }
  return index;
}

/** The contiguous run of numeric cells at `column` ending just above `row`. */
function contiguousAbove(
  numeric: ReadonlySet<string>,
  row: number,
  column: number,
  minRow: number,
): { startRow: number; endRow: number } | null {
  let top = row - 1;
  let found = false;
  while (top >= minRow && top >= row - XLSX_AUTOSUM_GUESS_MAX && numeric.has(`${top}:${column}`)) {
    found = true;
    top -= 1;
  }
  return found ? { startRow: top + 1, endRow: row - 1 } : null;
}

/** The contiguous run of numeric cells at `row` ending just left of `column`. */
function contiguousLeft(
  numeric: ReadonlySet<string>,
  row: number,
  column: number,
  minColumn: number,
): { startColumn: number; endColumn: number } | null {
  let left = column - 1;
  let found = false;
  while (left >= minColumn && left >= column - XLSX_AUTOSUM_GUESS_MAX && numeric.has(`${row}:${left}`)) {
    found = true;
    left -= 1;
  }
  return found ? { startColumn: left + 1, endColumn: column - 1 } : null;
}

/**
 * The range one AutoSum press sums, or null when there is nothing to sum.
 * `cells` must be the read window covering the selection and the guess area
 * (see `autoSumReadWindow`); `bounds` is the sheet's declared used extent.
 */
export function buildAutoSumRange(
  cells: readonly XlsxAutoSumCell[],
  selection: XlsxSelection,
  bounds?: { rowCount?: number; columnCount?: number },
): XlsxAutoSumRange | null {
  const range = autoSumSelectionRange(selection);
  if (!range) return null;
  const minRow = 0;
  const minColumn = 0;
  const single = range.startRow === range.endRow && range.startColumn === range.endColumn;

  if (!single) {
    // The whole selection, placed below it; a single-row selection places the
    // result to its right, matching Excel.
    if (range.startRow === range.endRow) {
      const lastColumn = bounds?.columnCount !== undefined && bounds.columnCount > 0
        ? bounds.columnCount - 1
        : Number.MAX_SAFE_INTEGER;
      const targetColumn = Math.min(range.endColumn + 1, lastColumn);
      if (targetColumn <= range.endColumn) return null;
      return { ...range, targetRow: range.startRow, targetColumn, kind: "selection" };
    }
    return { ...range, targetRow: range.endRow + 1, targetColumn: range.startColumn, kind: "selection" };
  }

  const numeric = numericIndex(cells);
  const above = contiguousAbove(numeric, range.startRow, range.startColumn, minRow);
  if (above) {
    return {
      startRow: above.startRow,
      endRow: above.endRow,
      startColumn: range.startColumn,
      endColumn: range.startColumn,
      targetRow: range.startRow,
      targetColumn: range.startColumn,
      kind: "guess-above",
    };
  }
  const left = contiguousLeft(numeric, range.startRow, range.startColumn, minColumn);
  if (left) {
    return {
      startRow: range.startRow,
      endRow: range.startRow,
      startColumn: left.startColumn,
      endColumn: left.endColumn,
      targetRow: range.startRow,
      targetColumn: range.startColumn,
      kind: "guess-left",
    };
  }
  return null;
}

/** The rectangle the editor must read for one AutoSum press: the selection,
 *  padded above/left by the guess bound so a single-cell guess can see its
 *  block. Clipped to the sheet's declared used bounds. */
export function autoSumReadWindow(
  selection: XlsxSelection,
  bounds?: { rowCount?: number; columnCount?: number },
): { startRow: number; endRow: number; startColumn: number; endColumn: number } | null {
  const range = autoSumSelectionRange(selection);
  if (!range) return null;
  const lastRow = bounds?.rowCount !== undefined && bounds.rowCount > 0 ? bounds.rowCount - 1 : Number.MAX_SAFE_INTEGER;
  const lastColumn = bounds?.columnCount !== undefined && bounds.columnCount > 0 ? bounds.columnCount - 1 : Number.MAX_SAFE_INTEGER;
  return {
    startRow: Math.max(0, range.startRow - XLSX_AUTOSUM_GUESS_MAX),
    endRow: Math.min(range.endRow, lastRow),
    startColumn: Math.max(0, range.startColumn - XLSX_AUTOSUM_GUESS_MAX),
    endColumn: Math.min(range.endColumn, lastColumn),
  };
}

/** A sheet name needs quoting in a formula when it is not a bare word. */
export function autoSumSheetPrefix(sheetName: string): string {
  return /^[A-Za-z_][A-Za-z0-9_.]*$/.test(sheetName) ? `${sheetName}!` : `'${sheetName.replace(/'/g, "''")}'!`;
}

/** The formula text `=SUM(<range>)`, sheet-qualified so it stays correct after
 *  the workbook is saved and recalculated. */
export function autoSumFormula(range: XlsxAutoSumRange, sheetName: string): string {
  const start = `${columnLabel(range.startColumn)}${range.startRow + 1}`;
  const end = `${columnLabel(range.endColumn)}${range.endRow + 1}`;
  const area = start === end ? start : `${start}:${end}`;
  return `=SUM(${autoSumSheetPrefix(sheetName)}${area})`;
}

/** The `sheet.command.set-range-values` payload: one formula cell at the
 *  target. The pinned command journals it through the existing path. */
export function buildAutoSumCommand(
  range: XlsxAutoSumRange,
  sheetId: string,
  workbookId: string,
  sheetName: string,
): { id: string; params: { unitId: string; subUnitId: string; value: Record<string, Record<string, { f: string }>> } } {
  return {
    id: XLSX_AUTOSUM_COMMAND,
    params: {
      unitId: workbookId,
      subUnitId: sheetId,
      value: { [String(range.targetRow)]: { [String(range.targetColumn)]: { f: autoSumFormula(range, sheetName) } } },
    },
  };
}