// UNI-926 ribbon polish: Excel's auto-fit approximation for columns the file
// never sized. A file without <cols> (or with a <col> that has no width) is
// shown by Excel at the default width, where a General number such as
// 1250000000 turns into "1.25E+09" and a "#,##0" cell into "########". The
// bridge seeds a content-fitted width for those columns ONLY in the shape the
// renderer consumes: the entries carry no `customWidth`, and the render model
// (the source the save path patches from) is never mutated, so an untouched
// workbook still writes no <cols> it did not have.
import type { XlsxRenderColumn, XlsxRenderSheet, XlsxRenderStyle } from "@uniwork/office-engine/xlsx";

const MAX_FIT_CHARS = 50;
/** Excel's maximum digit width at Calibri 11 (the renderer assumes the same
 *  baseline); a column is `chars + 5px padding` wide. */
const MDW = 7;
const PADDING_CHARS = 1;
/** Room for a table header's filter button, in characters. */
const FILTER_BUTTON_CHARS = 2;
const ADDRESS = /^([A-Z]+)(\d+)$/;

function parseAddress(address: string): { row: number; column: number } | null {
  const match = ADDRESS.exec(address);
  if (!match) return null;
  let column = 0;
  for (const letter of match[1]!) column = column * 26 + (letter.charCodeAt(0) - 64);
  return { row: Number(match[2]) - 1, column: column - 1 };
}

const isDateFormat = (format: string): boolean => /[ymdhs]/i.test(format.replace(/"[^"]*"|\[[^\]]*\]|\./g, "")) && !/general/i.test(format);

export function formatNumberForFit(value: number, format: string | undefined): string {
  const section = (format ?? "General").split(";")[0] ?? "General";
  if (section === "" || /^general$/i.test(section) || section === "@") {
    // General shows full digits as long as the column is wide enough.
    return Number.isInteger(value) ? String(value) : String(Number(value.toPrecision(11)));
  }
  if (isDateFormat(section)) return "0000-00-00 00:00";
  const stripped = section.replace(/"([^"]*)"/g, "$1").replace(/\[[^\]]*\]|\|_.|\*./g, "");
  const decimals = /\.([0#?]+)/.exec(stripped)?.[1]?.length ?? 0;
  const percent = stripped.includes("%");
  const grouped = /[0#?],[0#?]/.test(stripped);
  const scaled = percent ? value * 100 : value;
  const digits = Math.abs(scaled).toFixed(decimals);
  const [integer = "", fraction] = digits.split(".");
  const body = grouped ? integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",") : integer;
  const literal = stripped.replace(/[0#?.,%]/g, "").replace(/E[+-]/i, "");
  return `${scaled < 0 ? "-" : ""}${literal}${body}${fraction === undefined ? "" : `.${fraction}`}${percent ? "%" : ""}`;
}

function defaultChars(sheet: XlsxRenderSheet): number {
  if (sheet.defaultColumnWidth !== undefined) return sheet.defaultColumnWidth;
  return Math.trunc((((sheet.baseColWidth ?? 8) * MDW + 5) / MDW) * 256) / 256;
}

/**
 * The sheet's column spans plus a seeded, content-fitted span for every column
 * that no file span sizes (width or hidden). Widths are in OOXML character
 * units, clamped to [default width, 50]; a column whose content already fits
 * the default gets no span.
 */
export function seedFittedColumnWidths(sheet: XlsxRenderSheet, styles: readonly XlsxRenderStyle[]): XlsxRenderColumn[] {
  const spans = sheet.columnWidths.map((span) => ({ ...span }));
  const sized = (column: number): boolean =>
    spans.some((span) => column >= span.startColumn && column <= span.endColumn && (span.width !== undefined || span.hidden === true));
  const occupied = new Set<string>();
  const parsed = Object.entries(sheet.cells).flatMap(([address, cell]) => {
    const position = parseAddress(address);
    if (!position) return [];
    const value = cell.f !== undefined ? cell.c : cell.v;
    if (value !== null && value !== undefined && value !== "") occupied.add(`${position.row}:${position.column}`);
    return [{ ...position, cell, value }];
  });
  const merged = (row: number, column: number): boolean =>
    sheet.merges.some((m) => row >= m.startRow && row <= m.endRow && column >= m.startColumn && column <= m.endColumn && m.endColumn > m.startColumn);
  // A table header row carries a filter button over the cell's right edge.
  const inHeader = (row: number, column: number): boolean =>
    (sheet.tables ?? []).some(
      (table) => table.headerRow && row === table.area.startRow && column >= table.area.startColumn && column <= table.area.endColumn,
    );
  const fitted = new Map<number, number>();
  for (const { row, column, cell, value } of parsed) {
    if (value === null || value === undefined || value === "" || sized(column) || merged(row, column)) continue;
    const style = cell.s === undefined ? styles[0] : styles[cell.s];
    if (style?.wrapText) continue;
    const header = inHeader(row, column);
    let text: string;
    if (typeof value === "number") text = formatNumberForFit(value, style?.numberFormat);
    else if (typeof value === "boolean") text = value ? "TRUE" : "FALSE";
    else {
      // Text spills into an empty right neighbour in Excel, so it only
      // demands width when something sits next to it.
      if (!header && !occupied.has(`${row}:${column + 1}`)) continue;
      text = value.split("\n").reduce((longest, line) => (line.length > longest.length ? line : longest), "");
    }
    const scale = ((style?.fontSize ?? 11) / 11) * (style?.bold ? 1.1 : 1);
    const chars = Math.ceil((text.length * scale + PADDING_CHARS + (header ? FILTER_BUTTON_CHARS : 0)) * 100) / 100;
    fitted.set(column, Math.max(fitted.get(column) ?? 0, chars));
  }
  const floor = defaultChars(sheet);
  for (const column of [...fitted.keys()].sort((a, b) => a - b)) {
    const width = Math.min(MAX_FIT_CHARS, fitted.get(column)!);
    if (width <= floor) continue;
    spans.push({ startColumn: column, endColumn: column, width });
  }
  return spans;
}
