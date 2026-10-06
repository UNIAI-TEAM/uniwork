// UNI-952 (D-xlsx): the print copy of one sheet - a self-contained,
// script-free HTML document (CSP: inline styles and data: images only) whose
// pages are the sheet's pages. Cell text is always escaped; every style value
// passes print-styles' whitelists. Page geometry (@page size and margins,
// scale, breaks) comes from the resolved page setup; see print-layout.
// D2: each area of a multi-area print area starts on a page of its own, in
// order, at one shared scale; title columns repeat beside title rows; the
// header/footer sits in the page margin boxes (print-header-footer); pictures
// (when the collector supplies them) are placed absolutely by their anchor.
// D3: data bars and icons (print-marks) print inside their cells.
import type { XlsxRenderStyle } from "@uniwork/office-engine/xlsx";
import { PRINT_COPY_CSP } from "../../markdown/wysiwyg/print";
import { columnLabel } from "../xlsx-editor-model";
import { CELL_PADDING, renderRows } from "./print-cells";
import { headerFooterRules, type XlsxPrintHeaderContext } from "./print-header-footer";
import { markRules, type XlsxPrintMark } from "./print-marks";
import { effectiveScale, layoutPrintPages, printableArea, type XlsxPrintGeometry, type XlsxPrintPage } from "./print-layout";
import type { XlsxPrintRange, XlsxResolvedPrintSetup } from "./print-setup";
import { cssFontFamily, escapeHtml, round, rotationDeclarations, styleDeclarations } from "./print-styles";

/** One printed cell: its text as displayed and how General aligns it. */
export interface XlsxPrintCell {
  readonly text: string;
  readonly kind: "text" | "number" | "boolean" | "error";
  readonly styleIndex?: number | undefined;
}

/** A picture placed over the grid: its top-left cell (0-based), the offset
 *  inside that cell and its size, in points at 100%. `src` must be a base64
 *  `data:image/...` URL; anything else is not printed. */
export interface XlsxPrintPicture {
  readonly row: number;
  readonly column: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly width: number;
  readonly height: number;
  readonly src: string;
}

/** Everything one print run reads, collected from the live workbook. Lengths
 *  in points. `cells` is keyed `${row}:${column}` (0-based). */
export interface XlsxPrintSheet {
  readonly title: string;
  readonly setup: XlsxResolvedPrintSetup;
  /** The ranges to print, in order: the print area's areas, else the used range. */
  readonly areas: readonly XlsxPrintRange[];
  readonly cells: ReadonlyMap<string, XlsxPrintCell>;
  readonly styles: readonly XlsxRenderStyle[];
  readonly columns: ReadonlyMap<number, { readonly width?: number | undefined; readonly hidden?: boolean | undefined }>;
  readonly rows: ReadonlyMap<number, { readonly height?: number | undefined; readonly hidden?: boolean | undefined }>;
  readonly defaultColumnWidth: number;
  readonly defaultRowHeight: number;
  readonly merges: readonly XlsxPrintRange[];
  readonly defaultFont?: { readonly family?: string | undefined; readonly size?: number | undefined } | undefined;
  readonly rightToLeft?: boolean | undefined;
  /** The values header/footer field codes print (&A, &F, &D, &T). */
  readonly headerContext?: XlsxPrintHeaderContext | undefined;
  readonly pictures?: readonly XlsxPrintPicture[] | undefined;
  /** Data bars / icons the grid paints, keyed like `cells`. */
  readonly marks?: ReadonlyMap<string, XlsxPrintMark> | undefined;
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
const PICTURE_SRC = /^data:image\/(?:png|jpeg|gif|webp|bmp);base64,[A-Za-z0-9+/]+={0,2}$/;

function geometryOf(sheet: XlsxPrintSheet, range: XlsxPrintRange): XlsxPrintGeometry {
  const { setup } = sheet;
  const visibleColumn = (index: number): { index: number; width: number } | null => {
    const column = sheet.columns.get(index);
    const width = column?.width ?? sheet.defaultColumnWidth;
    return column?.hidden || width <= 0 ? null : { index, width };
  };
  const visibleRow = (index: number): { index: number; height: number } | null => {
    const row = sheet.rows.get(index);
    const height = row?.height ?? sheet.defaultRowHeight;
    return row?.hidden || height <= 0 ? null : { index, height };
  };
  const collect = <T,>(start: number, end: number, visible: (index: number) => T | null): T[] => {
    const out: T[] = [];
    for (let index = start; index <= end; index += 1) {
      const item = visible(index);
      if (item) out.push(item);
    }
    return out;
  };
  const digits = String(range.endRow + 1).length;
  return {
    columns: collect(range.startColumn, range.endColumn, visibleColumn),
    rows: collect(range.startRow, range.endRow, visibleRow),
    titleRows: setup.titleRows ? collect(setup.titleRows.start, setup.titleRows.end, visibleRow) : [],
    titleColumns: setup.titleColumns ? collect(setup.titleColumns.start, setup.titleColumns.end, visibleColumn) : [],
    headingWidth: setup.headings ? Math.max(24, digits * 7 + 10) : 0,
    headingHeight: setup.headings ? sheet.defaultRowHeight : 0,
  };
}

/** Absolutely placed pictures whose anchor cell is printed on this page. */
function renderPictures(sheet: XlsxPrintSheet, rows: readonly number[], columns: readonly number[], widthOf: (column: number) => number, scale: number, geometry: XlsxPrintGeometry): string {
  let html = "";
  for (const picture of sheet.pictures ?? []) {
    const row = rows.indexOf(picture.row);
    const column = columns.indexOf(picture.column);
    if (row === -1 || column === -1 || !PICTURE_SRC.test(picture.src)) continue;
    let x = geometry.headingWidth + picture.offsetX;
    for (const before of columns.slice(0, column)) x += widthOf(before);
    let y = geometry.headingHeight + picture.offsetY;
    for (const before of rows.slice(0, row)) y += sheet.rows.get(before)?.height ?? sheet.defaultRowHeight;
    html += `<img class="pic" alt="" src="${escapeHtml(picture.src)}" style="left:${round(x * scale)}pt;top:${round(y * scale)}pt;` +
      `width:${round(picture.width * scale)}pt;height:${round(picture.height * scale)}pt">`;
  }
  return html;
}

function renderPage(sheet: XlsxPrintSheet, page: XlsxPrintPage, scale: number, geometry: XlsxPrintGeometry, usedStyles: Set<number>): string {
  const widths = new Map([...geometry.columns, ...geometry.titleColumns].map((column) => [column.index, column.width]));
  const widthOf = (column: number): number => widths.get(column) ?? sheet.defaultColumnWidth;
  const columns = [...page.titleColumns, ...page.columns];
  const headings = sheet.setup.headings;
  let colgroup = headings ? `<col style="width:${round(geometry.headingWidth * scale)}pt">` : "";
  let tableWidth = headings ? geometry.headingWidth : 0;
  for (const column of columns) {
    tableWidth += widthOf(column);
    colgroup += `<col style="width:${round(widthOf(column) * scale)}pt">`;
  }
  let head = "";
  if (headings) {
    head += `<tr class="ch" style="height:${round(geometry.headingHeight * scale)}pt"><th></th>`;
    for (const column of columns) head += `<th>${escapeHtml(columnLabel(column))}</th>`;
    head += "</tr>";
  }
  const rowsInput = { columns, widths, scale, usedStyles };
  if (page.titleRows.length > 0) head += renderRows(sheet, { ...rowsInput, rows: page.titleRows });
  const body = renderRows(sheet, { ...rowsInput, rows: page.rows });
  const pictures = renderPictures(sheet, [...page.titleRows, ...page.rows], columns, widthOf, scale, geometry);
  const direction = sheet.rightToLeft ? ` dir="rtl"` : "";
  return `<section class="page"><table${direction} style="width:${round(tableWidth * scale)}pt"><colgroup>${colgroup}</colgroup>` +
    `${head === "" ? "" : `<thead>${head}</thead>`}<tbody>${body}</tbody></table>${pictures}</section>`;
}

function stylesheet(sheet: XlsxPrintSheet, scale: number, usedStyles: ReadonlySet<number>): string {
  const { setup } = sheet;
  const margins = setup.margins;
  const fontSize = round((sheet.defaultFont?.size ?? DEFAULT_FONT_SIZE) * scale);
  const family = cssFontFamily(sheet.defaultFont?.family) ?? "Calibri, Arial, sans-serif";
  const rules = [
    `@page{size:${round(setup.paper.width)}in ${round(setup.paper.height)}in;margin:${round(margins.top)}in ${round(margins.right)}in ${round(margins.bottom)}in ${round(margins.left)}in}`,
    ...headerFooterRules(setup.headerFooter, sheet.headerContext ?? { sheetName: "", fileName: sheet.title, date: "", time: "" }, {
      header: margins.header ?? 0.3,
      footer: margins.footer ?? 0.3,
      scale,
      fontFamily: family,
    }),
    "html,body{margin:0;padding:0;background:#ffffff}",
    "*{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}",
    ".page{position:relative;break-after:page}",
    ".page:last-child{break-after:auto}",
    ".pic{position:absolute}",
    `table{border-collapse:collapse;table-layout:fixed;font-family:${family};font-size:${fontSize}pt;color:#000000}`,
    `td{padding:0 ${round(CELL_PADDING * scale)}pt;overflow:hidden;white-space:nowrap;vertical-align:bottom;line-height:1.15}`,
    "td.ov{position:relative;overflow:visible}",
    `.ox{position:absolute;top:0;bottom:0;display:flex;overflow:hidden;white-space:nowrap;padding:0 ${round(CELL_PADDING * scale)}pt}`,
    "td.n{text-align:right}",
    "td.c{text-align:center}",
    `th{font-weight:400;font-size:${fontSize}pt;text-align:center;background:#f2f2f2;border:0.5pt solid #9e9e9e;overflow:hidden;white-space:nowrap}`,
  ];
  if (setup.horizontalCentered) rules.push("table{margin:0 auto}");
  if (setup.verticalCentered) {
    rules.push(`.page{display:flex;flex-direction:column;justify-content:center;height:${round(printableArea(setup).height - 2)}pt}`);
  }
  if (setup.gridlines) rules.push(`td{border:${GRIDLINE}}`);
  if (sheet.marks && sheet.marks.size > 0) rules.push(...markRules(scale));
  for (const index of [...usedStyles].sort((left, right) => left - right)) {
    const style = sheet.styles[index]!;
    const declarations = styleDeclarations(style, scale);
    if (declarations.length > 0) rules.push(`td.s${index}{${declarations.join(";")}}`);
    const rotation = rotationDeclarations(style);
    if (rotation.length > 0) rules.push(`td.s${index}>.rt{${rotation.join(";")}}`);
  }
  return rules.join("\n");
}

/** Build the print copy of one sheet. */
export function buildXlsxPrintCopy(sheet: XlsxPrintSheet): XlsxPrintCopyResult {
  const geometries = sheet.areas.map((area) => geometryOf(sheet, area));
  const cellCount = geometries.reduce((total, geometry) =>
    total + (geometry.columns.length + geometry.titleColumns.length) * (geometry.rows.length + geometry.titleRows.length), 0);
  if (cellCount > MAX_PRINT_CELLS) return { ok: false, reason: "print_too_large" };
  // One scale for the whole copy (fonts are one stylesheet): the smallest any
  // area needs (a fixed scale is the same for every area).
  const scale = geometries.length === 0 ? 1 : Math.min(...geometries.map((geometry) => effectiveScale(sheet.setup, geometry)));
  const usedStyles = new Set<number>();
  let pageCount = 0;
  let pages = "";
  for (const geometry of geometries) {
    const layout = layoutPrintPages(sheet.setup, geometry, scale);
    pageCount += layout.pages.length;
    pages += layout.pages.map((page) => renderPage(sheet, page, scale, geometry, usedStyles)).join("");
  }
  const html = "<!DOCTYPE html><html><head><meta charset=\"utf-8\">" +
    `<meta http-equiv="Content-Security-Policy" content="${escapeHtml(PRINT_COPY_CSP)}">` +
    `<title>${escapeHtml(sheet.title)}</title><style>${stylesheet(sheet, scale, usedStyles)}</style></head>` +
    `<body>${pages}</body></html>`;
  if (new TextEncoder().encode(html).length > MAX_COPY_BYTES) return { ok: false, reason: "print_too_large" };
  return { ok: true, html, pages: pageCount };
}
