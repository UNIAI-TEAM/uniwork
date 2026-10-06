// UNI-952 (D-xlsx): the print copy of one sheet - a self-contained,
// script-free HTML document (CSP: inline styles and data: images only) whose
// pages are the sheet's pages. Cell text is always escaped; every style value
// passes print-styles' whitelists. Page geometry (@page size and margins,
// scale, breaks) comes from the resolved page setup; see print-layout.
import type { XlsxRenderStyle } from "@uniwork/office-engine/xlsx";
import { PRINT_COPY_CSP } from "../../markdown/wysiwyg/print";
import { columnLabel } from "../xlsx-editor-model";
import { layoutPrintPages, printableArea, type XlsxPrintGeometry, type XlsxPrintPage } from "./print-layout";
import type { XlsxPrintRange, XlsxResolvedPrintSetup } from "./print-setup";
import { cssFontFamily, escapeHtml, horizontalAlignment, round, styleDeclarations, wrapsText } from "./print-styles";

/** One printed cell: its text as displayed and how General aligns it. */
export interface XlsxPrintCell {
  readonly text: string;
  readonly kind: "text" | "number" | "boolean" | "error";
  readonly styleIndex?: number | undefined;
}

/** Everything one print run reads, collected from the live workbook. Lengths
 *  in points. `cells` is keyed `${row}:${column}` (0-based). */
export interface XlsxPrintSheet {
  readonly title: string;
  readonly setup: XlsxResolvedPrintSetup;
  /** The range to print: the print area, else the used range. */
  readonly range: XlsxPrintRange;
  readonly cells: ReadonlyMap<string, XlsxPrintCell>;
  readonly styles: readonly XlsxRenderStyle[];
  readonly columns: ReadonlyMap<number, { readonly width?: number | undefined; readonly hidden?: boolean | undefined }>;
  readonly rows: ReadonlyMap<number, { readonly height?: number | undefined; readonly hidden?: boolean | undefined }>;
  readonly defaultColumnWidth: number;
  readonly defaultRowHeight: number;
  readonly merges: readonly XlsxPrintRange[];
  readonly defaultFont?: { readonly family?: string | undefined; readonly size?: number | undefined } | undefined;
  readonly rightToLeft?: boolean | undefined;
}

type XlsxPrintCopyResult =
  | { readonly ok: true; readonly html: string; readonly pages: number }
  | { readonly ok: false; readonly reason: "print_too_large" };

/** The desktop host refuses a bigger copy; refuse it here first. */
const MAX_COPY_BYTES = 16 * 1024 * 1024;
/** More cells than this cannot make a copy under the byte cap. */
export const MAX_PRINT_CELLS = 400_000;
const GRIDLINE = "0.5pt solid #c0c0c0";
const DEFAULT_FONT_SIZE = 11;

const key = (row: number, column: number): string => `${row}:${column}`;

function geometryOf(sheet: XlsxPrintSheet): XlsxPrintGeometry {
  const { range, setup } = sheet;
  const columns: { index: number; width: number }[] = [];
  for (let index = range.startColumn; index <= range.endColumn; index += 1) {
    const column = sheet.columns.get(index);
    const width = column?.width ?? sheet.defaultColumnWidth;
    if (!column?.hidden && width > 0) columns.push({ index, width });
  }
  const visibleRow = (index: number): { index: number; height: number } | null => {
    const row = sheet.rows.get(index);
    const height = row?.height ?? sheet.defaultRowHeight;
    return row?.hidden || height <= 0 ? null : { index, height };
  };
  const rows: { index: number; height: number }[] = [];
  for (let index = range.startRow; index <= range.endRow; index += 1) {
    const row = visibleRow(index);
    if (row) rows.push(row);
  }
  const titleRows: { index: number; height: number }[] = [];
  if (setup.titleRows) {
    for (let index = setup.titleRows.start; index <= setup.titleRows.end; index += 1) {
      const row = visibleRow(index);
      if (row) titleRows.push(row);
    }
  }
  const digits = String(range.endRow + 1).length;
  return {
    columns,
    rows,
    titleRows,
    headingWidth: setup.headings ? Math.max(24, digits * 7 + 10) : 0,
    headingHeight: setup.headings ? sheet.defaultRowHeight : 0,
  };
}

interface Span {
  readonly rowSpan: number;
  readonly colSpan: number;
  /** The merge's anchor cell, whose style (and, when shown, text) it carries. */
  readonly anchor: string;
  readonly showText: boolean;
}

/** Merge spans for one row segment of one page; covered cells are skipped. */
function spansFor(sheet: XlsxPrintSheet, rows: readonly number[], columns: readonly number[]): { spans: Map<string, Span>; covered: Set<string> } {
  const spans = new Map<string, Span>();
  const covered = new Set<string>();
  for (const merge of sheet.merges) {
    const inRows = rows.filter((row) => row >= merge.startRow && row <= merge.endRow);
    const inColumns = columns.filter((column) => column >= merge.startColumn && column <= merge.endColumn);
    if (inRows.length === 0 || inColumns.length === 0 || (inRows.length === 1 && inColumns.length === 1 && merge.startRow === merge.endRow && merge.startColumn === merge.endColumn)) continue;
    const top = inRows[0]!;
    const left = inColumns[0]!;
    spans.set(key(top, left), {
      rowSpan: inRows.length,
      colSpan: inColumns.length,
      anchor: key(merge.startRow, merge.startColumn),
      showText: top === merge.startRow && left === merge.startColumn,
    });
    for (const row of inRows) for (const column of inColumns) if (row !== top || column !== left) covered.add(key(row, column));
  }
  return { spans, covered };
}

function cellClasses(sheet: XlsxPrintSheet, cell: XlsxPrintCell | undefined, styleIndex: number | undefined, spills: boolean): string {
  const classes: string[] = [];
  const style = styleIndex === undefined ? undefined : sheet.styles[styleIndex];
  if (cell && !horizontalAlignment(style)) {
    if (cell.kind === "number") classes.push("n");
    else if (cell.kind === "boolean" || cell.kind === "error") classes.push("c");
  }
  if (spills) classes.push("sp");
  if (styleIndex !== undefined && style) classes.push(`s${styleIndex}`);
  return classes.length === 0 ? "" : ` class="${classes.join(" ")}"`;
}

function renderRows(sheet: XlsxPrintSheet, rows: readonly number[], columns: readonly number[], scale: number, usedStyles: Set<number>): string {
  const { spans, covered } = spansFor(sheet, rows, columns);
  const headings = sheet.setup.headings;
  let html = "";
  for (const row of rows) {
    const height = sheet.rows.get(row)?.height ?? sheet.defaultRowHeight;
    html += `<tr style="height:${round(height * scale)}pt">`;
    if (headings) html += `<th class="rh">${row + 1}</th>`;
    columns.forEach((column, position) => {
      const at = key(row, column);
      if (covered.has(at)) return;
      const span = spans.get(at);
      const source = span ? span.anchor : at;
      const cell = sheet.cells.get(source);
      const text = span && !span.showText ? "" : (cell?.text ?? "");
      const styleIndex = cell?.styleIndex;
      if (styleIndex !== undefined && sheet.styles[styleIndex]) usedStyles.add(styleIndex);
      const style = styleIndex === undefined ? undefined : sheet.styles[styleIndex];
      const next = columns[position + 1];
      const align = horizontalAlignment(style);
      const spills = !span && text !== "" && cell?.kind === "text" && !wrapsText(style) && (align === null || align === "left") &&
        next !== undefined && !covered.has(key(row, next)) && !spans.has(key(row, next)) && (sheet.cells.get(key(row, next))?.text ?? "") === "";
      const spanAttributes = span ? `${span.rowSpan > 1 ? ` rowspan="${span.rowSpan}"` : ""}${span.colSpan > 1 ? ` colspan="${span.colSpan}"` : ""}` : "";
      html += `<td${cellClasses(sheet, cell, styleIndex, spills)}${spanAttributes}>${escapeHtml(text)}</td>`;
    });
    html += "</tr>";
  }
  return html;
}

function renderPage(sheet: XlsxPrintSheet, page: XlsxPrintPage, scale: number, geometry: XlsxPrintGeometry, usedStyles: Set<number>): string {
  const widths = new Map(geometry.columns.map((column) => [column.index, column.width]));
  const headings = sheet.setup.headings;
  let colgroup = headings ? `<col style="width:${round(geometry.headingWidth * scale)}pt">` : "";
  let tableWidth = headings ? geometry.headingWidth : 0;
  for (const column of page.columns) {
    const width = widths.get(column) ?? sheet.defaultColumnWidth;
    tableWidth += width;
    colgroup += `<col style="width:${round(width * scale)}pt">`;
  }
  let head = "";
  if (headings) {
    head += `<tr class="ch" style="height:${round(geometry.headingHeight * scale)}pt"><th></th>`;
    for (const column of page.columns) head += `<th>${escapeHtml(columnLabel(column))}</th>`;
    head += "</tr>";
  }
  if (page.titleRows.length > 0) head += renderRows(sheet, page.titleRows, page.columns, scale, usedStyles);
  const body = renderRows(sheet, page.rows, page.columns, scale, usedStyles);
  const direction = sheet.rightToLeft ? ` dir="rtl"` : "";
  return `<section class="page"><table${direction} style="width:${round(tableWidth * scale)}pt"><colgroup>${colgroup}</colgroup>` +
    `${head === "" ? "" : `<thead>${head}</thead>`}<tbody>${body}</tbody></table></section>`;
}

function stylesheet(sheet: XlsxPrintSheet, scale: number, usedStyles: ReadonlySet<number>): string {
  const { setup } = sheet;
  const margins = setup.margins;
  const fontSize = round((sheet.defaultFont?.size ?? DEFAULT_FONT_SIZE) * scale);
  const family = cssFontFamily(sheet.defaultFont?.family) ?? "Calibri, Arial, sans-serif";
  const rules = [
    `@page{size:${round(setup.paper.width)}in ${round(setup.paper.height)}in;margin:${round(margins.top)}in ${round(margins.right)}in ${round(margins.bottom)}in ${round(margins.left)}in}`,
    "html,body{margin:0;padding:0;background:#ffffff}",
    "*{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}",
    ".page{break-after:page}",
    ".page:last-child{break-after:auto}",
    `table{border-collapse:collapse;table-layout:fixed;font-family:${family};font-size:${fontSize}pt;color:#000000}`,
    `td{padding:0 ${round(2 * scale)}pt;overflow:hidden;white-space:nowrap;vertical-align:bottom;line-height:1.15}`,
    "td.sp{overflow:visible}",
    "td.n{text-align:right}",
    "td.c{text-align:center}",
    `th{font-weight:400;font-size:${fontSize}pt;text-align:center;background:#f2f2f2;border:0.5pt solid #9e9e9e;overflow:hidden;white-space:nowrap}`,
  ];
  if (setup.horizontalCentered) rules.push("table{margin:0 auto}");
  if (setup.verticalCentered) {
    rules.push(`.page{display:flex;flex-direction:column;justify-content:center;height:${round(printableArea(setup).height - 2)}pt}`);
  }
  if (setup.gridlines) rules.push(`td{border:${GRIDLINE}}`);
  for (const index of [...usedStyles].sort((left, right) => left - right)) {
    const declarations = styleDeclarations(sheet.styles[index]!, scale);
    if (declarations.length > 0) rules.push(`td.s${index}{${declarations.join(";")}}`);
  }
  return rules.join("\n");
}

/** Build the print copy of one sheet. */
export function buildXlsxPrintCopy(sheet: XlsxPrintSheet): XlsxPrintCopyResult {
  const geometry = geometryOf(sheet);
  if (geometry.columns.length * (geometry.rows.length + geometry.titleRows.length) > MAX_PRINT_CELLS) {
    return { ok: false, reason: "print_too_large" };
  }
  const layout = layoutPrintPages(sheet.setup, geometry);
  const usedStyles = new Set<number>();
  const pages = layout.pages.map((page) => renderPage(sheet, page, layout.scale, geometry, usedStyles)).join("");
  const html = "<!DOCTYPE html><html><head><meta charset=\"utf-8\">" +
    `<meta http-equiv="Content-Security-Policy" content="${escapeHtml(PRINT_COPY_CSP)}">` +
    `<title>${escapeHtml(sheet.title)}</title><style>${stylesheet(sheet, layout.scale, usedStyles)}</style></head>` +
    `<body>${pages}</body></html>`;
  if (new TextEncoder().encode(html).length > MAX_COPY_BYTES) return { ok: false, reason: "print_too_large" };
  return { ok: true, html, pages: layout.pages.length };
}
