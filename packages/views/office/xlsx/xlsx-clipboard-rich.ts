// Rich paste: an HTML table on the clipboard (Excel, Google Sheets, a web
// page) carries fonts, fills, borders, number formats and merged cells that
// the plain-text twin loses. This module reads them out of the table and
// plans one paste: on the live grid one set-range-values (values and styles
// together) plus one merge command per merged area, run as ONE undo step; on
// the fallback surface one edit batch. Values always come from the plain
// text, so the existing coercion rules stay the single source of content.

import { XLSX_CLIENT_MAX_EDIT_OPS } from "./xlsx-clipboard";
import { cellPasteStyle, collapsed, type XlsxPasteBorderSide, type XlsxPasteStyle } from "./xlsx-clipboard-style";

export interface XlsxRichCell {
  readonly text: string;
  readonly style: XlsxPasteStyle;
  /** The number behind a formatted display text (Excel `x:num`, Google
   *  `data-sheets-value`): "50.00%" pastes as 0.5 under its format. */
  readonly number?: number;
}

/** A 0-based inclusive rectangle relative to the table's top-left cell. */
export interface XlsxPasteRange {
  readonly startRow: number;
  readonly endRow: number;
  readonly startColumn: number;
  readonly endColumn: number;
}

export interface XlsxRichTable {
  readonly rows: readonly (readonly XlsxRichCell[])[];
  readonly merges: readonly XlsxPasteRange[];
}

export interface XlsxRichPastePlan {
  /** Style per pasted cell (same grid as the plain text); null = unformatted. */
  readonly styles: readonly (readonly (XlsxPasteStyle | null)[])[];
  /** The source number per pasted cell, when the HTML names one. */
  readonly numbers: readonly (readonly (number | null)[])[];
  /** Absolute merge areas. */
  readonly merges: readonly XlsxPasteRange[];
}

/** F-P4: bounds for a hostile or huge clipboard payload - the HTML as a
 *  whole, one cell's style string and the classes one cell may name. */
const MAX_HTML_LENGTH = 2_000_000;
const MAX_STYLE_LENGTH = 4096;
const MAX_CELL_CLASSES = 16;

/** The tail wins: a later declaration overrides an earlier one in CSS, so a
 *  cap keeps the end of the string. */
function capStyle(style: string): string {
  return style.length > MAX_STYLE_LENGTH ? style.slice(-MAX_STYLE_LENGTH) : style;
}

function classRules(doc: Document): Map<string, string> {
  // A repeated body moves to the end instead of piling up, so the cascade
  // order holds and a class repeated thousands of times stays one rule.
  const bodies = new Map<string, Set<string>>();
  for (const sheet of Array.from(doc.querySelectorAll("style"))) {
    for (const rule of (sheet.textContent ?? "").matchAll(/\.([\w-]+)\s*\{([^}]*)\}/g)) {
      const set = bodies.get(rule[1]!) ?? new Set<string>();
      const body = rule[2]!.trim();
      set.delete(body);
      set.add(body);
      bodies.set(rule[1]!, set);
    }
  }
  return new Map(Array.from(bodies, ([name, set]) => [name, capStyle(Array.from(set).join(";"))]));
}

function richCell(cell: Element, rules: Map<string, string>): XlsxRichCell {
  const classes = (cell.getAttribute("class") ?? "").split(/\s+/).filter(Boolean).slice(0, MAX_CELL_CLASSES);
  // Inline declarations come last so they win over a class rule.
  const style = capStyle([...classes.map((name) => rules.get(name) ?? ""), cell.getAttribute("style") ?? ""].join(";"));
  const text = collapsed(cell.textContent);
  const pasted = cellPasteStyle(cell, style, text);
  // F-P1: the raw number replaces the display text only under a number format
  // that survived; without one (an unmapped named format) the number would
  // show as a bare serial or amount, so the typed display text is pasted.
  const number = pasted.n ? sourceNumber(cell) : null;
  return { text, style: pasted, ...(number === null ? {} : { number }) };
}

function sourceNumber(cell: Element): number | null {
  const excel = cell.getAttribute("x:num");
  if (excel !== null && excel.trim() !== "") return Number.isFinite(Number(excel)) ? Number(excel) : null;
  const sheets = cell.getAttribute("data-sheets-value");
  if (!sheets) return null;
  try {
    const value = (JSON.parse(sheets) as { 1?: unknown; 3?: unknown });
    return value[1] === 3 && typeof value[3] === "number" && Number.isFinite(value[3]) ? value[3] : null;
  } catch {
    return null;
  }
}

/** The anchor's border edges a covered cell of a merged area shows: only the
 *  sides that lie on the area's outline. */
function outlineBorders(style: XlsxPasteStyle, area: XlsxPasteRange, row: number, column: number): XlsxPasteStyle {
  if (!style.bd) return {};
  const onEdge: Record<XlsxPasteBorderSide, boolean> = {
    t: row === area.startRow, b: row === area.endRow, l: column === area.startColumn, r: column === area.endColumn,
  };
  const bd = Object.fromEntries(Object.entries(style.bd).filter(([side]) => onEdge[side as XlsxPasteBorderSide]));
  return Object.keys(bd).length > 0 ? { bd } : {};
}

function span(cell: Element, name: string, max: number): number {
  return Math.min(Math.max(Number.parseInt(cell.getAttribute(name) ?? "1", 10) || 1, 1), max);
}

/** The first `<table>` of a clipboard HTML payload as a grid of formatted
 *  cells plus its merged areas; null when there is no table, or when its
 *  expanded grid would be larger than the edit-op bound (the plain text is
 *  refused at that size anyway). `colspan`/`rowspan` expand into covered
 *  cells, so the grid lines up with the plain-text twin; the bound is checked
 *  while expanding, before anything large is allocated. */
export function parseClipboardHtmlTable(html: string): XlsxRichTable | null {
  if (html.trim() === "" || html.length > MAX_HTML_LENGTH || typeof DOMParser === "undefined") return null;
  const doc = new DOMParser().parseFromString(html, "text/html");
  const table = doc.querySelector("table");
  if (!table) return null;
  const rules = classRules(doc);
  const trs = Array.from(table.querySelectorAll("tr"));
  const rows: XlsxRichCell[][] = trs.map(() => []);
  const merges: XlsxPasteRange[] = [];
  let total = 0;
  for (const [rowIndex, tr] of trs.entries()) {
    let column = 0;
    for (const cell of Array.from(tr.children)) {
      if (cell.tagName !== "TD" && cell.tagName !== "TH") continue;
      while (rows[rowIndex]![column]) column += 1;
      const colSpan = span(cell, "colspan", 16_384);
      const rowSpan = span(cell, "rowspan", trs.length - rowIndex);
      total += colSpan * rowSpan;
      if (total > XLSX_CLIENT_MAX_EDIT_OPS) return null;
      const anchor = richCell(cell, rules);
      const area = { startRow: rowIndex, endRow: rowIndex + rowSpan - 1, startColumn: column, endColumn: column + colSpan - 1 };
      if (colSpan > 1 || rowSpan > 1) merges.push(area);
      for (let row = area.startRow; row <= area.endRow; row += 1) {
        for (let at = area.startColumn; at <= area.endColumn; at += 1) {
          rows[row]![at] = row === rowIndex && at === column ? anchor : { text: "", style: outlineBorders(anchor.style, area, row, at) };
        }
      }
      column += colSpan;
    }
  }
  // A row a rowspan skipped over may have holes left of a later cell.
  const dense = rows.map((cells) => Array.from({ length: cells.length }, (_, at) => cells[at] ?? { text: "", style: {} }));
  return dense.length > 0 ? { rows: dense, merges } : null;
}

/** Plans the formats of a paste anchored at `start`. null: nothing in the
 *  table is formatted or merged, or the table is not the plain text's twin
 *  (a different grid, or any cell whose text differs: a stale or foreign
 *  payload) - paste values only. "over-limit": the values plus one op per
 *  merged area would exceed the edit-op bound - paste values only and say
 *  so. A cell's style rides the same edit as its value, so styles add no op. */
export function planRichPaste(
  start: { row: number; column: number },
  table: XlsxRichTable,
  plainRows: readonly (readonly string[])[],
): XlsxRichPastePlan | "over-limit" | null {
  const { rows } = table;
  if (rows.length !== plainRows.length || rows.some((row, index) => row.length !== plainRows[index]!.length)) return null;
  if (rows.some((row, rowIndex) => row.some((cell, column) => cell.text !== collapsed(plainRows[rowIndex]![column]!)))) return null;
  let formatted = table.merges.length > 0;
  const styles = rows.map((row) => row.map((cell) => {
    if (Object.keys(cell.style).length === 0) return null;
    formatted = true;
    return cell.style;
  }));
  if (!formatted) return null;
  const values = plainRows.reduce((sum, row) => sum + row.length, 0);
  if (values + table.merges.length > XLSX_CLIENT_MAX_EDIT_OPS) return "over-limit";
  const merges = table.merges.map((area) => ({
    startRow: start.row + area.startRow, endRow: start.row + area.endRow,
    startColumn: start.column + area.startColumn, endColumn: start.column + area.endColumn,
  }));
  const numbers = rows.map((row) => row.map((cell) => cell.number ?? null));
  return { styles, numbers, merges };
}
