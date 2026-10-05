// Wave A / A4 (UNI-926): the bounded read window one find scan may cover.
// The grid streams lazily and the host is read on the main thread, so the
// panel reads used/visible windows only and reports exactly what it read.

import { addressParts } from "../xlsx-editor-model";
import type { RendererRangeCell, RendererRangeResult } from "../xlsx-render-model-bridge";
import type { XlsxSelection } from "../types";

/** Cells one scan read may cover (the status bar's read cap). A bigger
 *  used/selected window is scanned as its first block only and reported as
 *  partial — never presented as a whole-sheet result. */
export const FIND_SCAN_MAX_CELLS = 50_000;

export interface XlsxFindScanRange {
  startRow: number;
  endRow: number;
  startColumn: number;
  endColumn: number;
}

export interface XlsxFindScanRequest {
  /** The rectangle actually read: clipped to the sheet's used bounds and to
   *  the cell cap (whole rows). */
  range: XlsxFindScanRange;
  /** Rows the scope wanted to scan inside the used bounds, before the cap. */
  totalRows: number;
  /** The cell cap narrowed the window; the scan is partial by construction. */
  windowed: boolean;
}

export type XlsxFindScope = "selection" | "sheet";

/** The selection normalized to a rectangle; null when an address is malformed. */
export function selectionRange(selection: XlsxSelection): XlsxFindScanRange | null {
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

/** Clip a wanted rectangle to the sheet's declared used bounds and cap it to
 *  one read window. `null` means the wanted window holds no used cell at all,
 *  so the scan reads nothing and says so instead of reporting a fake zero. */
export function scanWindow(
  wanted: XlsxFindScanRange,
  sheet: { rowCount: number; columnCount: number },
  maxCells = FIND_SCAN_MAX_CELLS,
): XlsxFindScanRequest | null {
  const lastRow = sheet.rowCount > 0 ? sheet.rowCount - 1 : -1;
  const lastColumn = sheet.columnCount > 0 ? sheet.columnCount - 1 : -1;
  const clipped: XlsxFindScanRange = {
    startRow: wanted.startRow,
    endRow: Math.min(wanted.endRow, lastRow),
    startColumn: wanted.startColumn,
    endColumn: Math.min(wanted.endColumn, lastColumn),
  };
  if (clipped.endRow < clipped.startRow || clipped.endColumn < clipped.startColumn) return null;
  const rows = clipped.endRow - clipped.startRow + 1;
  const columns = clipped.endColumn - clipped.startColumn + 1;
  const rowsPerBlock = Math.max(1, Math.floor(maxCells / columns));
  const windowed = rows > rowsPerBlock;
  return {
    range: { ...clipped, endRow: windowed ? clipped.startRow + rowsPerBlock - 1 : clipped.endRow },
    totalRows: rows,
    windowed,
  };
}

/** The read request for a scope: the current selection clipped to the sheet's
 *  used bounds, or the whole used sheet. */
export function findScanRange(
  scope: XlsxFindScope,
  selection: XlsxSelection | null,
  sheet: { rowCount: number; columnCount: number },
): XlsxFindScanRequest | null {
  if (scope === "selection") {
    const range = selection ? selectionRange(selection) : null;
    return range ? scanWindow(range, sheet) : null;
  }
  return scanWindow(
    { startRow: 0, endRow: sheet.rowCount - 1, startColumn: 0, endColumn: sheet.columnCount - 1 },
    sheet,
  );
}

export interface XlsxFindScanResult {
  cells: RendererRangeCell[];
  /** Rows of the request the host actually served (confirmed indexed rows). */
  scannedRows: number;
  /** Rows the scope wanted inside the used bounds, before the cap. */
  totalRows: number;
  /** Rows outside the served window exist; the counts cover the read only. */
  partial: boolean;
}

/** Keep the request's rectangle and drop everything a partial host has not
 *  indexed yet (`indexingComplete` / `indexedThroughRow`, the status bar's
 *  rule); a host that omits the fields is trusted as complete. */
export function clipScanResult(
  result: RendererRangeResult | null | undefined,
  request: XlsxFindScanRequest,
): XlsxFindScanResult {
  const { range } = request;
  const indexedThroughRow = typeof result?.indexedThroughRow === "number" ? result.indexedThroughRow : null;
  const unindexed = result?.indexingComplete === false &&
    (indexedThroughRow === null || indexedThroughRow < range.endRow);
  const confirmedEnd = unindexed
    ? (indexedThroughRow === null ? range.startRow - 1 : Math.min(indexedThroughRow, range.endRow))
    : range.endRow;
  let cells: RendererRangeCell[] = Array.isArray(result?.cells)
    ? result.cells.filter(
        (cell) =>
          cell.row >= range.startRow && cell.row <= range.endRow &&
          cell.column >= range.startColumn && cell.column <= range.endColumn,
      )
    : [];
  if (unindexed) cells = cells.filter((cell) => cell.row <= confirmedEnd);
  return {
    cells,
    scannedRows: Math.max(0, confirmedEnd - range.startRow + 1),
    totalRows: request.totalRows,
    partial: request.windowed || unindexed,
  };
}
