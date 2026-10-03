// C2 (UNI-926): CSV export for the active sheet. Pure serialization (no DOM),
// so a host without a DOM (the desktop renderer) can reuse it; the download
// wiring lives in download.ts and runs in the web host only. The values come
// from the render model (cached formula results), so a formula exports the way
// the grid shows it.
import type { XlsxCellScalar } from "@uniwork/office-engine/xlsx";

/** The slice of a render-model sheet the serializer reads (XlsxRenderSheet). */
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
