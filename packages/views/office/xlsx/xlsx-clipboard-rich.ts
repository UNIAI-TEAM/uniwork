// Rich paste: an HTML table on the clipboard (Excel, Google Sheets, a web
// page) carries bold, fill and number formats that the plain-text twin loses.
// This module reads those three formats out of the table and plans the
// `sheet.command.set-range-values` / numfmt writes that apply them after the
// values land. Values always come from the plain text, so the existing
// coercion rules stay the single source of cell content.

import { XLSX_CLIENT_MAX_EDIT_OPS } from "./xlsx-clipboard";
import { XLSX_CUSTOM_FORMAT_MAX_LENGTH, XLSX_NUMBER_FORMAT_COMMANDS, numberFormatCommandParams } from "./number-format/catalog";
import type { XlsxToolbarCommands } from "./toolbar/types";

export interface XlsxRichCell {
  readonly text: string;
  readonly bold: boolean;
  /** Lower-case `#rrggbb`, or null for no (or white) fill. */
  readonly fill: string | null;
  /** An OOXML format code, or null for General / unreadable. */
  readonly numberFormat: string | null;
}

export interface XlsxRichPastePlan {
  /** `{ [row]: { [column]: { s } } }` for `sheet.command.set-range-values`:
   *  only cells that carry bold or a fill appear. */
  readonly style: Record<number, Record<number, { s: Record<string, unknown> }>>;
  /** Cells per format code, each group one numfmt command. */
  readonly numberFormats: ReadonlyMap<string, readonly { row: number; column: number }[]>;
  /** Distinct cells that carry any format (one extra op each at save time). */
  readonly styledCells: number;
}

const EXCEL_FORMAT_KEYWORDS: Record<string, string | null> = {
  general: null,
  percent: "0%",
  fixed: "0.00",
  standard: "#,##0.00",
};

function declaration(style: string, property: string): string | null {
  const match = new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`, "i").exec(style);
  return match ? match[1]!.trim() : null;
}

function excelNumberFormat(style: string): string | null {
  const match = /mso-number-format\s*:\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^;]+)/i.exec(style);
  if (!match) return null;
  const raw = match[1]!.trim();
  const quoted = /^["'](.*)["']$/s.exec(raw);
  if (!quoted) return EXCEL_FORMAT_KEYWORDS[raw.toLowerCase()] ?? null;
  return quoted[1]!.replace(/\\(.)/g, "$1");
}

function sheetsNumberFormat(cell: Element): string | null {
  const raw = cell.getAttribute("data-sheets-numberformat");
  if (!raw) return null;
  try {
    const pattern = (JSON.parse(raw) as { 2?: unknown })[2];
    return typeof pattern === "string" ? pattern : null;
  } catch {
    return null;
  }
}

function usableFormat(pattern: string | null): string | null {
  if (pattern === null || pattern === "" || pattern.toLowerCase() === "general") return null;
  // eslint-disable-next-line no-control-regex -- control characters never belong in a format code
  return pattern.length <= XLSX_CUSTOM_FORMAT_MAX_LENGTH && !/[\u0000-\u001f]/.test(pattern) ? pattern : null;
}

function hex(value: number): string {
  return value.toString(16).padStart(2, "0");
}

/** `#rgb`, `#rrggbb` or `rgb(r, g, b)` as `#rrggbb`; white is "no fill". */
function fillColor(value: string | null): string | null {
  if (!value) return null;
  let color: string | null = null;
  const hexMatch = /#([0-9a-f]{3}|[0-9a-f]{6})\b/i.exec(value);
  if (hexMatch) {
    const digits = hexMatch[1]!.toLowerCase();
    color = `#${digits.length === 3 ? [...digits].map((digit) => digit + digit).join("") : digits}`;
  } else {
    const rgb = /rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)/i.exec(value);
    if (rgb) color = `#${[rgb[1], rgb[2], rgb[3]].map((part) => hex(Math.min(255, Number(part)))).join("")}`;
  }
  return color === "#ffffff" ? null : color;
}

function classRules(doc: Document): Map<string, string> {
  const rules = new Map<string, string>();
  for (const sheet of Array.from(doc.querySelectorAll("style"))) {
    for (const rule of (sheet.textContent ?? "").matchAll(/\.([\w-]+)\s*\{([^}]*)\}/g)) {
      rules.set(rule[1]!, `${rules.get(rule[1]!) ?? ""};${rule[2]!}`);
    }
  }
  return rules;
}

function collapsed(text: string | null): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

function richCell(cell: Element, rules: Map<string, string>): XlsxRichCell {
  const classes = (cell.getAttribute("class") ?? "").split(/\s+/).filter(Boolean);
  // Inline declarations come last so they win over a class rule.
  const style = [...classes.map((name) => rules.get(name) ?? ""), cell.getAttribute("style") ?? ""].join(";");
  const weight = declaration(style, "font-weight");
  const wrapped = cell.querySelector("b, strong");
  const text = collapsed(cell.textContent);
  const bold = (weight !== null && /^(bold|bolder|[6-9]00)$/i.test(weight)) ||
    (wrapped !== null && text !== "" && collapsed(wrapped.textContent) === text);
  const fill = fillColor(declaration(style, "background-color") ?? declaration(style, "background") ?? cell.getAttribute("bgcolor"));
  const numberFormat = usableFormat(excelNumberFormat(style) ?? sheetsNumberFormat(cell));
  return { text, bold, fill, numberFormat };
}

/** The first `<table>` of a clipboard HTML payload as rows of formatted cells;
 *  null when there is no table. `colspan` expands into empty cells so the grid
 *  lines up with the plain-text twin (`rowspan` is not expanded: a shape
 *  mismatch falls back to the plain paste). */
export function parseClipboardHtmlTable(html: string): XlsxRichCell[][] | null {
  if (html.trim() === "" || typeof DOMParser === "undefined") return null;
  const doc = new DOMParser().parseFromString(html, "text/html");
  const table = doc.querySelector("table");
  if (!table) return null;
  const rules = classRules(doc);
  const rows = Array.from(table.querySelectorAll("tr")).map((row) =>
    Array.from(row.children)
      .filter((child) => child.tagName === "TD" || child.tagName === "TH")
      .flatMap((cell) => {
        const span = Math.min(Math.max(Number.parseInt(cell.getAttribute("colspan") ?? "1", 10) || 1, 1), 16_384);
        return [richCell(cell, rules), ...Array.from({ length: span - 1 }, (): XlsxRichCell => ({ text: "", bold: false, fill: null, numberFormat: null }))];
      }),
  );
  return rows.length > 0 ? rows : null;
}

/** Plans the format writes for a paste anchored at `start`. null: nothing in
 *  the table is formatted, or its grid does not match the plain text (a stale
 *  or foreign HTML payload) - paste values only. "over-limit": values plus
 *  formatted cells would exceed the edit-op bound - paste values only and say
 *  so. */
export function planRichPaste(
  start: { row: number; column: number },
  table: readonly (readonly XlsxRichCell[])[],
  plainRows: readonly (readonly string[])[],
): XlsxRichPastePlan | "over-limit" | null {
  if (table.length !== plainRows.length || table.some((row, index) => row.length !== plainRows[index]!.length)) return null;
  const style: XlsxRichPastePlan["style"] = {};
  const numberFormats = new Map<string, { row: number; column: number }[]>();
  let styledCells = 0;
  let values = 0;
  table.forEach((cells, rowIndex) => {
    cells.forEach((cell, columnIndex) => {
      values += 1;
      const row = start.row + rowIndex;
      const column = start.column + columnIndex;
      const s: Record<string, unknown> = {};
      if (cell.bold) s.bl = 1;
      if (cell.fill) s.bg = { rgb: cell.fill };
      if (Object.keys(s).length > 0) (style[row] ??= {})[column] = { s };
      if (cell.numberFormat) {
        const group = numberFormats.get(cell.numberFormat) ?? [];
        group.push({ row, column });
        numberFormats.set(cell.numberFormat, group);
      }
      if (cell.bold || cell.fill || cell.numberFormat) styledCells += 1;
    });
  });
  if (styledCells === 0) return null;
  return values + styledCells > XLSX_CLIENT_MAX_EDIT_OPS ? "over-limit" : { style, numberFormats, styledCells };
}

/** The clipboard's `text/html` flavour; "" when the async clipboard is denied
 *  or absent (an insecure context, a refused permission). */
export async function readClipboardHtml(): Promise<string> {
  const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard;
  if (!clipboard?.read) return "";
  try {
    for (const item of await clipboard.read()) {
      if (item.types.includes("text/html")) return await (await item.getType("text/html")).text();
    }
  } catch {
    // Denied or unsupported: the plain-text paste still works.
  }
  return "";
}

/** Runs the planned writes: one set-range-values for bold/fill, one numfmt
 *  command per format code. false when the renderer refused any of them (the
 *  values are already in; the caller says the formats were not kept). */
export async function applyRichPaste(
  commands: XlsxToolbarCommands,
  unitId: string,
  subUnitId: string,
  plan: XlsxRichPastePlan,
): Promise<boolean> {
  let applied = true;
  if (Object.keys(plan.style).length > 0) {
    applied = (await commands.execute("sheet.command.set-range-values", { unitId, subUnitId, value: plan.style })) && applied;
  }
  for (const [pattern, cells] of plan.numberFormats) {
    applied = (await commands.execute(XLSX_NUMBER_FORMAT_COMMANDS.set, numberFormatCommandParams(cells, pattern))) && applied;
  }
  return applied;
}
