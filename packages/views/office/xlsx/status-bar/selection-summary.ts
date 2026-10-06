import type { XlsxWorkbookSnapshot } from "@uniwork/office-engine/xlsx";
import { addressParts } from "../xlsx-editor-model";
import { toA1Address, type RendererRangeCell } from "../xlsx-render-model-bridge";
import type { XlsxSelection } from "../types";

/** Row/column window one status-bar read may cover. The host is read on the
 *  main thread, so an oversized selection is summarized over its first block
 *  and reported as partial — never presented as a total over the selection. */
export const SUMMARY_READ_MAX_CELLS = 50_000;

export interface XlsxSummaryRange {
  startRow: number;
  endRow: number;
  startColumn: number;
  endColumn: number;
}

export interface XlsxSummaryRequest {
  range: XlsxSummaryRange;
  /** The selection is larger than the read window; `range` is its first block. */
  windowed: boolean;
}

export interface XlsxSummarySheetBounds {
  rowCount?: number;
  columnCount?: number;
}

/** Values over the cells a read returned, Excel-style: a selection holding at
 *  least one number gets the aggregate over its numbers (sum, average) next to
 *  the count of ALL values, text included; a text-only selection has the count
 *  only. */
export type XlsxSelectionSummary =
  | { kind: "empty" }
  | { kind: "count"; nonEmptyCount: number }
  | {
      kind: "numeric";
      nonEmptyCount: number;
      numericCount: number;
      sum: number;
      average: number;
      min: number;
      max: number;
    };

export interface XlsxSummaryRead {
  summary: XlsxSelectionSummary;
  /** The host confirmed only part of the requested rows are indexed. */
  partial: boolean;
}

/** The read fields the summary needs; every field optional so a host (or a
 *  test double) that predates them still degrades instead of throwing. */
interface XlsxSummaryReadPayload {
  cells?: readonly RendererRangeCell[];
  indexingComplete?: boolean;
  indexedThroughRow?: number | null;
}

/** Excel's status bar counts cells that hold a value; a blank cell is absent
 *  from the read payload, so every returned cell is a value except `null` and
 *  the empty string (a formula with no cached result). */
function holdsValue(value: RendererRangeCell["value"]): value is Exclude<RendererRangeCell["value"], null> {
  return value !== null && value !== undefined && value !== "";
}

export function summarizeCells(cells: readonly Pick<RendererRangeCell, "value">[]): XlsxSelectionSummary {
  let numericCount = 0;
  let nonEmptyCount = 0;
  let sum = 0;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const cell of cells) {
    const value = cell?.value;
    if (!holdsValue(value)) continue;
    if (typeof value === "number") {
      // A NaN or infinity cannot be shown or summed; it is not a value.
      if (!Number.isFinite(value)) continue;
      nonEmptyCount += 1;
      numericCount += 1;
      sum += value;
      min = Math.min(min, value);
      max = Math.max(max, value);
      continue;
    }
    nonEmptyCount += 1;
  }
  if (nonEmptyCount === 0) return { kind: "empty" };
  if (numericCount === 0) return { kind: "count", nonEmptyCount };
  return { kind: "numeric", nonEmptyCount, numericCount, sum, average: sum / numericCount, min, max };
}

function rangeFromSelection(selection: XlsxSelection): XlsxSummaryRange | null {
  const start = addressParts(selection.address);
  if (!start) return null;
  const end = selection.endAddress ? addressParts(selection.endAddress) : start;
  if (!end) return null;
  return {
    startRow: Math.min(start.row, end.row),
    endRow: Math.max(start.row, end.row),
    startColumn: Math.min(start.column, end.column),
    endColumn: Math.max(start.column, end.column),
  };
}

/**
 * The range one read asks the host for: the selection normalized to a
 * rectangle, clipped to the sheet's declared used bounds (nothing outside them
 * can hold data), then capped to the read window. `null` means the selection
 * cannot hold any value.
 */
export function summaryReadRequest(
  selection: XlsxSelection,
  bounds?: XlsxSummarySheetBounds,
  maxCells = SUMMARY_READ_MAX_CELLS,
): XlsxSummaryRequest | null {
  const range = rangeFromSelection(selection);
  if (!range) return null;
  const lastRow = bounds?.rowCount !== undefined && bounds.rowCount > 0 ? bounds.rowCount - 1 : range.endRow;
  const lastColumn = bounds?.columnCount !== undefined && bounds.columnCount > 0 ? bounds.columnCount - 1 : range.endColumn;
  const clipped: XlsxSummaryRange = {
    startRow: range.startRow,
    endRow: Math.min(range.endRow, lastRow),
    startColumn: range.startColumn,
    endColumn: Math.min(range.endColumn, lastColumn),
  };
  if (clipped.endRow < clipped.startRow || clipped.endColumn < clipped.startColumn) return null;
  const columns = clipped.endColumn - clipped.startColumn + 1;
  const rowsPerBlock = Math.max(1, Math.floor(maxCells / columns));
  const windowed = clipped.endRow - clipped.startRow + 1 > rowsPerBlock;
  return { range: { ...clipped, endRow: windowed ? clipped.startRow + rowsPerBlock - 1 : clipped.endRow }, windowed };
}


/**
 * F2 (UNI-926 FIX-STATUSBAR): the status bar must summarize the LIVE workbook
 * after an edit or a sort. The renderer host's readRange serves the render
 * model captured at open time, which is never refreshed by an edit, so reading
 * through it reports pre-edit values and drops cells the frozen model lacks
 * (edited cells and formula cells added later in the session). The editor
 * already holds the live workbook snapshot; this reads the selection straight
 * from it so the summary tracks the current values. Returns null when the
 * selection address is invalid or its sheet is unknown.
 */
export function summarizeSelectionFromSnapshot(
  snapshot: XlsxWorkbookSnapshot,
  selection: XlsxSelection,
  maxCells = SUMMARY_READ_MAX_CELLS,
): XlsxSummaryRead | null {
  const range = rangeFromSelection(selection);
  if (!range) return null;
  const sheet = snapshot.sheets.find((candidate) => candidate.name === selection.sheet || candidate.id === selection.sheet);
  if (!sheet) return null;
  const columns = range.endColumn - range.startColumn + 1;
  const rowsPerBlock = Math.max(1, Math.floor(maxCells / columns));
  const windowed = range.endRow - range.startRow + 1 > rowsPerBlock;
  const endRow = windowed ? range.startRow + rowsPerBlock - 1 : range.endRow;
  const cells: RendererRangeCell[] = [];
  for (let row = range.startRow; row <= endRow; row += 1) {
    for (let column = range.startColumn; column <= range.endColumn; column += 1) {
      const cell = sheet.cells[toA1Address(row, column)];
      if (!cell) continue;
      cells.push({ row, column, value: cell.value });
    }
  }
  return { summary: summarizeCells(cells), partial: windowed };
}

/**
 * A host reports row coverage with `indexingComplete` / `indexedThroughRow`.
 * When it confirms fewer rows than the request ends on, the summary covers the
 * confirmed rows only and is flagged partial; when it confirms no rows, the
 * payload is treated as covering nothing rather than as a total. A host that
 * omits the fields (an older host) is trusted as complete.
 */
export function summarizeRead(
  result: XlsxSummaryReadPayload | null | undefined,
  range: XlsxSummaryRange,
): XlsxSummaryRead {
  const indexedThroughRow = typeof result?.indexedThroughRow === "number" ? result.indexedThroughRow : null;
  const unindexed = result?.indexingComplete === false && (indexedThroughRow === null || indexedThroughRow < range.endRow);
  let cells: readonly RendererRangeCell[] = Array.isArray(result?.cells) ? result.cells : [];
  if (unindexed) {
    cells = indexedThroughRow === null ? [] : cells.filter((cell) => cell.row <= indexedThroughRow);
  }
  return { summary: summarizeCells(cells), partial: unindexed };
}
