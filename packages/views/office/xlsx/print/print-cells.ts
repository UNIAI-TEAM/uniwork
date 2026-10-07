// UNI-952 (D2-xlsx): the table rows of one printed page. Excel's on-screen
// rules the copy keeps: merges are spans (covered cells skipped); text that
// is wider than its cell overflows into EMPTY neighbours - to the right for
// left/General text, to the left for right-aligned text, to both sides for
// centred text - and is clipped at the first neighbour that holds a value; a
// number too wide for its column shows `####` (a General decimal first loses
// fraction digits, as Excel does); rotated text is turned inside its cell.
// Text widths are estimated from the font size (no layout engine here), so
// the decision to overflow or show `####` is close to Excel's, not exact.
// D3: a data bar or icon (print-marks) is placed first in its cell and the
// text rides above it; "show bar/icon only" prints no text. Text spills only
// into the sheet's own neighbours (hidden columns between them aside), never
// from a repeated title column into the page's first body column; on a
// right-to-left sheet the next column is the one on the left.
import type { XlsxRenderStyle } from "@uniwork/office-engine/xlsx";
import type { XlsxPrintCell, XlsxPrintSheet } from "./print-copy";
import { ICON_TEXT_OFFSET, markHtml } from "./print-marks";
import { escapeHtml, horizontalAlignment, round, wrapsText } from "./print-styles";

/** Cell padding at 100%, each side, in points. */
export const CELL_PADDING = 2;
const DEFAULT_FONT_SIZE = 11;

const key = (row: number, column: number): string => `${row}:${column}`;

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

/** Estimated width of `text` in points at `size`pt (Calibri-like metrics). */
function textWidth(text: string, size: number, bold = false): number {
  let em = 0;
  for (const char of text) {
    if (/[ᄀ-ᅟ⺀-꓏가-힣豈-﫿＀-｠]/.test(char)) em += 1;
    else if (/[iljtfI.,:;'!|() ]/.test(char)) em += 0.28;
    else if (/[A-Z]|[mwMW@%]/.test(char)) em += 0.62;
    else em += 0.5;
  }
  return em * size * (bold ? 1.08 : 1);
}

/** The text a number shows in a column `inner` points wide. */
function fittedNumber(text: string, style: XlsxRenderStyle | undefined, size: number, inner: number): string {
  const bold = style?.bold === true;
  if (textWidth(text, size, bold) <= inner) return text;
  const general = !style?.numberFormat || /^general$/i.test(style.numberFormat);
  const decimal = /^-?\d+\.(\d+)$/.exec(text);
  if (general && decimal) {
    for (let digits = decimal[1]!.length - 1; digits >= 0; digits -= 1) {
      const shorter = Number(text).toFixed(digits);
      if (textWidth(shorter, size, bold) <= inner) return shorter;
    }
  }
  return "#".repeat(Math.max(1, Math.floor(inner / textWidth("#", size, bold))));
}

/** Rotated text is wrapped so the style's `.rt` rule can turn it. */
const rotated = (style: XlsxRenderStyle | undefined): boolean => style?.textRotation !== undefined && style.textRotation !== 0;

const JUSTIFY: Readonly<Record<string, string>> = { left: "flex-start", center: "center", right: "flex-end" };
const ALIGN: Readonly<Record<string, string>> = { top: "flex-start", center: "center" };

interface XlsxPrintRowsInput {
  readonly rows: readonly number[];
  /** Printed columns in order (title columns first). */
  readonly columns: readonly number[];
  readonly widths: ReadonlyMap<number, number>;
  readonly scale: number;
  readonly usedStyles: Set<number>;
}

/** The `<tr>`s of one row segment of one page. */
export function renderRows(sheet: XlsxPrintSheet, input: XlsxPrintRowsInput): string {
  const { rows, columns, widths, scale, usedStyles } = input;
  const { spans, covered } = spansFor(sheet, rows, columns);
  const widthOf = (column: number): number => widths.get(column) ?? sheet.defaultColumnWidth;
  const heightOf = (row: number): number => sheet.rows.get(row)?.height ?? sheet.defaultRowHeight;
  const hiddenColumn = (column: number): boolean => {
    const entry = sheet.columns.get(column);
    return entry?.hidden === true || (entry?.width ?? sheet.defaultColumnWidth) <= 0;
  };
  // The printed column at `to` is the sheet neighbour of `from` in direction `step`.
  const neighbours = (from: number, to: number, step: 1 | -1): boolean => {
    if ((to - from) * step <= 0) return false;
    for (let column = Math.min(from, to) + 1; column < Math.max(from, to); column += 1) if (!hiddenColumn(column)) return false;
    return true;
  };
  const baseSize = sheet.defaultFont?.size ?? DEFAULT_FONT_SIZE;
  let html = "";
  for (const row of rows) {
    const height = heightOf(row);
    html += `<tr style="height:${round(height * scale)}pt">`;
    if (sheet.setup.headings) html += `<th class="rh">${row + 1}</th>`;
    // A neighbour is free for overflow when it shows nothing and is no merge.
    const free = (position: number): boolean => {
      const column = columns[position];
      if (column === undefined) return false;
      const at = key(row, column);
      return !covered.has(at) && !spans.has(at) && (sheet.cells.get(at)?.text ?? "") === "";
    };
    const extent = (position: number, step: 1 | -1): number => {
      let total = 0;
      for (let next = position + step; free(next) && neighbours(columns[next - step]!, columns[next]!, step); next += step) total += widthOf(columns[next]!);
      return total;
    };
    columns.forEach((column, position) => {
      const at = key(row, column);
      if (covered.has(at)) return;
      const span = spans.get(at);
      const cell: XlsxPrintCell | undefined = sheet.cells.get(span ? span.anchor : at);
      const styleIndex = cell?.styleIndex;
      const style = styleIndex === undefined ? undefined : sheet.styles[styleIndex];
      if (styleIndex !== undefined && style) usedStyles.add(styleIndex);
      const mark = sheet.marks?.get(span ? span.anchor : at);
      let text = (span && !span.showText) || mark?.hideValue ? "" : (cell?.text ?? "");
      const size = style?.fontSize ?? baseSize;
      const inner = widthOf(column) - 2 * CELL_PADDING;
      const plain = !span && text !== "" && !wrapsText(style) && !rotated(style);
      if (plain && cell?.kind === "number") text = fittedNumber(text, style, size, inner);

      const classes: string[] = [];
      const align = horizontalAlignment(style);
      if (cell && !align) {
        if (cell.kind === "number") classes.push("n");
        else if (cell.kind === "boolean" || cell.kind === "error") classes.push("c");
      }
      let body = escapeHtml(text);
      const flow = align ?? "left";
      if (plain && cell?.kind === "text" && flow in JUSTIFY && textWidth(text, size, style?.bold === true) > inner) {
        const right = flow === "right" ? 0 : extent(position, 1);
        const left = flow === "left" ? 0 : extent(position, -1);
        const [before, after] = flow === "center" ? [Math.min(left, right), Math.min(left, right)] : [left, right];
        // Physical sides: under dir="rtl" the next column sits on the left.
        const [l, r] = sheet.rightToLeft ? [after, before] : [before, after];
        if (l + r > 0) {
          classes.push("ov");
          const vertical = ALIGN[style?.verticalAlignment ?? ""] ?? "flex-end";
          body = `<div class="ox" style="left:${round(-l * scale)}pt;right:${round(-r * scale)}pt;justify-content:${JUSTIFY[flow]};align-items:${vertical}">${body}</div>`;
        }
      } else if (text !== "" && rotated(style)) {
        body = `<span class="rt">${body}</span>`;
      }
      let markup = "";
      let padding = "";
      if (mark) {
        const spanned = <T,>(list: readonly T[], from: number, count: number, size: (item: T) => number): number =>
          list.slice(from, from + count).reduce((total, item) => total + size(item), 0);
        const box = span
          ? { width: spanned(columns, position, span.colSpan, widthOf), height: spanned(rows, rows.indexOf(row), span.rowSpan, heightOf) }
          : { width: widthOf(column), height };
        markup = markHtml(mark, box, scale);
        if (markup !== "") classes.push("cf");
        // Plain (escaped) text gets a positioned wrapper; .ox / .rt already paint above.
        if (markup !== "" && !body.startsWith("<")) body = `<span class="cv">${body}</span>`;
        if (mark.icon) padding = ` style="padding-left:${round((CELL_PADDING + ICON_TEXT_OFFSET) * scale)}pt"`;
      }
      if (styleIndex !== undefined && style) classes.push(`s${styleIndex}`);
      const classAttribute = classes.length === 0 ? "" : ` class="${classes.join(" ")}"`;
      const spanAttributes = span ? `${span.rowSpan > 1 ? ` rowspan="${span.rowSpan}"` : ""}${span.colSpan > 1 ? ` colspan="${span.colSpan}"` : ""}` : "";
      html += `<td${classAttribute}${spanAttributes}${padding}>${markup}${body}</td>`;
    });
    html += "</tr>";
  }
  return html;
}
