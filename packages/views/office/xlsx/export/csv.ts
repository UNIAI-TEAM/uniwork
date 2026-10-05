// C2 (UNI-926): CSV export for the active sheet. Pure serialization (no DOM),
// so a host without a DOM (the desktop renderer) can reuse it; the download
// wiring lives in download.ts and runs in the web host only. The values come
// from the LIVE session snapshot (kept current by every edit), not the render
// model: the model host is built once at open and never republished, so it
// would silently omit unsaved in-session edits.
import type { XlsxCellScalar, XlsxCellState } from "@uniwork/office-engine/xlsx";

/** The slice of a sheet the serializer reads: an address-keyed cell map plus
 *  the used-range dimensions. Built from the live session snapshot
 *  (csvSheetFromSnapshot); the render-model shape (XlsxRenderSheet) also
 *  satisfies it. */
export interface XlsxCsvSheet {
  readonly cells: Readonly<Record<string, { readonly v?: XlsxCellScalar | undefined; readonly f?: string | undefined; readonly c?: XlsxCellScalar | undefined }>>;
  readonly rowCount: number;
  readonly columnCount: number;
}

export interface XlsxCsvOptions {
  /** Prepend a UTF-8 BOM so Excel opens Vietnamese text without a codepage
   *  prompt. Default true (Excel on Windows mis-reads un-BOM'd UTF-8). */
  readonly bom?: boolean;
}

/** RFC4180 field: quote when the text carries a delimiter, quote, CR or LF;
 *  escape an embedded quote by doubling it. */
function csvField(text: string): string {
  return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

/** The display text of one cell: a formula cell exports its cached result, a
 *  plain cell its value. Booleans spell TRUE/FALSE (Excel's own CSV text). */
export function csvCellText(cell: { readonly v?: XlsxCellScalar | undefined; readonly f?: string | undefined; readonly c?: XlsxCellScalar | undefined } | undefined): string {
  if (!cell) return "";
  const value = cell.f !== undefined ? cell.c : cell.v;
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  return String(value);
}

/** One cell address for a 0-based row/column (kept local: the CSV module must
 *  not pull the renderer bridge into a DOM-less host). */
function address(row: number, column: number): string {
  let label = "";
  for (let value = column + 1; value > 0; value = Math.floor((value - 1) / 26)) {
    label = String.fromCharCode(65 + ((value - 1) % 26)) + label;
  }
  return label + (row + 1);
}

/** The 0-based row/column of an A1 address, or null (kept local, same reason
 *  as `address`). */
function addressPartsOf(value: string): { row: number; column: number } | null {
  const match = /^([A-Za-z]{1,3})([1-9][0-9]*)$/.exec(value);
  if (!match) return null;
  let column = 0;
  for (const char of match[1]!.toUpperCase()) column = column * 26 + char.charCodeAt(0) - 64;
  return { row: Number(match[2]) - 1, column: column - 1 };
}

/**
 * The CSV slice of one LIVE session snapshot sheet: its used range (the max
 * address any cell occupies) and, per cell, the value, or, for a formula
 * cell, the formula text plus whatever cached result the snapshot carries.
 * The gateway snapshot stores formula cells as `{ value: null, formula }`
 * (no cached <v>), so a formula exports empty unless a recalc has refreshed
 * it; every other in-session edit is current, which the open-time render model
 * was not.
 */
export function csvSheetFromSnapshot(sheet: { readonly cells: Readonly<Record<string, XlsxCellState>> }): XlsxCsvSheet {
  const cells: Record<string, { v?: XlsxCellScalar | undefined; f?: string | undefined; c?: XlsxCellScalar | undefined }> = {};
  let rowCount = 0;
  let columnCount = 0;
  for (const [key, cell] of Object.entries(sheet.cells)) {
    const parts = addressPartsOf(key);
    if (!parts) continue;
    rowCount = Math.max(rowCount, parts.row + 1);
    columnCount = Math.max(columnCount, parts.column + 1);
    if (cell.formula !== undefined) {
      cells[key] = { f: cell.formula, ...(cell.rawValue === undefined ? {} : { c: cell.rawValue }) };
    } else {
      cells[key] = { v: cell.value };
    }
  }
  return { cells, rowCount, columnCount };
}

/**
 * Serialize one sheet to RFC4180 CSV, in grid order, with `\r\n` row
 * separators (RFC4180; Excel and Sheets both accept it). The grid is the
 * sheet's used range (`rowCount` x `columnCount`), so an empty sheet is an
 * empty string. UTF-8 BOM is prepended by default.
 */
export function serializeSheetToCsv(sheet: XlsxCsvSheet, options: XlsxCsvOptions = {}): string {
  const rows: string[] = [];
  for (let row = 0; row < sheet.rowCount; row += 1) {
    const fields: string[] = [];
    for (let column = 0; column < sheet.columnCount; column += 1) {
      fields.push(csvField(csvCellText(sheet.cells[address(row, column)])));
    }
    rows.push(fields.join(","));
  }
  const body = rows.join("\r\n");
  return (options.bom ?? true) ? "\uFEFF" + body : body;
}
