// Cell style decoding for the rich-paste reader (xlsx-clipboard-rich.ts): the
// CSS an Excel / Google Sheets / web table carries on a cell, read into the
// renderer's cell style shape (Univer IStyleData keys), which is also what
// the grid journal sends as a set_cell `style`.

import { cssColor, excelNumberFormat, fillColor, usableFormat } from "./xlsx-clipboard-formats";

interface XlsxPasteBorder {
  /** Univer BorderStyleTypes: 1 thin, 2 hair, 3 dotted, 4 dashed, 5 dash-dot,
   *  6 dash-dot-dot, 7 double, 8 medium, 9 medium dashed, 13 thick. */
  readonly s: number;
  readonly cl: { readonly rgb: string };
}

export type XlsxPasteBorderSide = "t" | "b" | "l" | "r";

export interface XlsxPasteStyle {
  bl?: 1;
  it?: 1;
  ul?: { s: 1 };
  st?: { s: 1 };
  ff?: string;
  fs?: number;
  cl?: { rgb: string };
  bg?: { rgb: string };
  bd?: Partial<Record<XlsxPasteBorderSide, XlsxPasteBorder>>;
  n?: { pattern: string };
}

export function declaration(style: string, property: string): string | null {
  let found: string | null = null;
  // The last declaration wins, as in CSS (inline style follows the class rule).
  for (const match of style.matchAll(new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`, "gi"))) found = match[1]!.trim();
  return found;
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

export function collapsed(text: string | null): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

/** True when a `<b>`/`<i>`/`<u>`-like wrapper holds the cell's whole text. */
function wrapsText(cell: Element, selector: string, text: string): boolean {
  const wrapped = cell.querySelector(selector);
  return wrapped !== null && text !== "" && collapsed(wrapped.textContent) === text;
}

const GENERIC_FAMILIES = new Set(["serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui", "inherit", "initial"]);

function fontFamily(value: string | null): string | null {
  const first = value?.split(",")[0]?.trim().replace(/^(["'])(.*)\1$/, "$2").trim();
  return first && first.length <= 64 && !GENERIC_FAMILIES.has(first.toLowerCase()) ? first : null;
}

/** `11pt`, `11.0pt` or `14.6667px` as points (half-point steps), 1..409. */
function fontSize(value: string | null): number | null {
  const match = value ? /^(\d+(?:\.\d+)?|\.\d+)\s*(pt|px)$/i.exec(value.trim()) : null;
  if (!match) return null;
  const points = Number(match[1]) * (match[2]!.toLowerCase() === "px" ? 0.75 : 1);
  const rounded = Math.round(points * 2) / 2;
  return rounded >= 1 && rounded <= 409 ? rounded : null;
}

/** Width in points: `.5pt`, `1px`, or the CSS keywords. */
function borderWidth(token: string): number | null {
  const keyword = { thin: 0.75, medium: 1, thick: 1.5 }[token.toLowerCase()];
  if (keyword !== undefined) return keyword;
  const match = /^(\d+(?:\.\d+)?|\.\d+)(pt|px)$/i.exec(token);
  return match ? Number(match[1]) * (match[2]!.toLowerCase() === "px" ? 0.75 : 1) : null;
}

const LINE_STYLES = new Set(["none", "hidden", "solid", "dashed", "dotted", "double", "hairline", "dot-dash", "dot-dot-dash", "groove", "ridge", "inset", "outset"]);

/** One CSS border shorthand (`.5pt solid windowtext`, `1px solid #000000`). */
function border(value: string | null): XlsxPasteBorder | null {
  if (!value) return null;
  const tokens = value.trim().split(/\s+(?![^(]*\))/);
  const line = tokens.find((token) => LINE_STYLES.has(token.toLowerCase()))?.toLowerCase();
  const width = tokens.map(borderWidth).find((points) => points !== null) ?? 0.75;
  if (!line || line === "none" || line === "hidden" || width <= 0) return null;
  const color = cssColor(tokens.filter((token) => !LINE_STYLES.has(token.toLowerCase()) && borderWidth(token) === null).join(" ")) ?? "#000000";
  let s: number;
  if (line === "double") s = 7;
  else if (line === "hairline") s = 2;
  else if (line === "dotted") s = 3;
  else if (line === "dot-dash") s = 5;
  else if (line === "dot-dot-dash") s = 6;
  else if (line === "dashed") s = width > 0.75 ? 9 : 4;
  else s = width <= 0.75 ? 1 : width <= 1.25 ? 8 : 13;
  return { s, cl: { rgb: color } };
}

const SIDES: readonly [XlsxPasteBorderSide, string][] = [["t", "top"], ["b", "bottom"], ["l", "left"], ["r", "right"]];

function borders(style: string): XlsxPasteStyle["bd"] | null {
  const all = declaration(style, "border");
  const result: Partial<Record<XlsxPasteBorderSide, XlsxPasteBorder>> = {};
  for (const [side, name] of SIDES) {
    const value = border(declaration(style, `border-${name}`) ?? all);
    if (value) result[side] = value;
  }
  return Object.keys(result).length > 0 ? result : null;
}

/** The pasted cell's style; `{}` for an unformatted cell. Black text is the
 *  default colour and is left out, as is a white fill. */
export function cellPasteStyle(cell: Element, style: string, text: string): XlsxPasteStyle {
  const result: XlsxPasteStyle = {};
  const weight = declaration(style, "font-weight");
  if ((weight !== null && /^(bold|bolder|[6-9]00)$/i.test(weight)) || wrapsText(cell, "b, strong", text)) result.bl = 1;
  if (/^(italic|oblique)/i.test(declaration(style, "font-style") ?? "") || wrapsText(cell, "i, em", text)) result.it = 1;
  const decoration = `${declaration(style, "text-decoration") ?? ""} ${declaration(style, "text-decoration-line") ?? ""}`;
  const underlineStyle = declaration(style, "text-underline-style");
  if (/underline/i.test(decoration) || (underlineStyle !== null && !/^none$/i.test(underlineStyle)) || wrapsText(cell, "u", text)) result.ul = { s: 1 };
  if (/line-through/i.test(decoration) || wrapsText(cell, "s, strike, del", text)) result.st = { s: 1 };
  const family = fontFamily(declaration(style, "font-family"));
  if (family) result.ff = family;
  const size = fontSize(declaration(style, "font-size"));
  if (size !== null) result.fs = size;
  const color = cssColor(declaration(style, "color"));
  if (color && color !== "#000000") result.cl = { rgb: color };
  const fill = fillColor(declaration(style, "background-color") ?? declaration(style, "background") ?? cell.getAttribute("bgcolor"));
  if (fill) result.bg = { rgb: fill };
  const bd = borders(style);
  if (bd) result.bd = bd;
  const pattern = usableFormat(excelNumberFormat(style) ?? sheetsNumberFormat(cell));
  if (pattern) result.n = { pattern };
  return result;
}
