// Wave A / A4 (UNI-926): the find & replace matching core. Pure, renderer-free
// logic so the panel, the hook and the tests share exactly one rule set.

import type { RendererRangeCell } from "../xlsx-render-model-bridge";

/** One cell a scan found, in row-major order. A formula cell is matched on its
 *  displayed value but never replaced: a bare value write would be recomputed
 *  away (the journal keeps the formula), and the pinned renderer's value mode
 *  marks formula hits non-replaceable for the same reason. */
export interface XlsxFindMatch {
  readonly row: number;
  readonly column: number;
  /** The cell's displayed text (numbers as decimal text, booleans as 1/0). */
  readonly text: string;
  readonly replaceable: boolean;
}

/** The server's per-job op budget (`maxOfficeEditOps` in
 *  `server/internal/service/document_office.go`): one replaced cell journals
 *  one `set_cell` op, so a replace-all whose batch exceeds this is refused
 *  before the command runs — never saved truncated. */
export const FIND_REPLACE_OP_LIMIT = 10_000;

/** The pinned renderer trims the query (" a " finds "a"); an empty query never
 *  matches. Case folding happens at each comparison site so the caller's
 *  spelling is preserved for replacement. */
export function normalizeFindQuery(query: string): string | null {
  const trimmed = query.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/** The pinned display-value rule: numbers as decimal text, booleans as 1/0,
 *  strings as-is. An empty or non-text cell has nothing to match. */
export function findCellText(cell: Pick<RendererRangeCell, "value">): string | null {
  const { value } = cell;
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : null;
  if (typeof value === "boolean") return value ? "1" : "0";
  if (typeof value === "string") return value.length === 0 ? null : value;
  return null;
}

/** Every cell whose displayed text contains the query. Reads may arrive in any
 *  order, so the result is sorted: find next/previous and the position line
 *  depend on a stable document order. */
export function findMatches(
  cells: readonly RendererRangeCell[],
  query: string,
  matchCase: boolean,
): XlsxFindMatch[] {
  const needle = normalizeFindQuery(query);
  if (needle === null) return [];
  const comparable = matchCase ? needle : needle.toLowerCase();
  const matches: XlsxFindMatch[] = [];
  for (const cell of cells) {
    const text = findCellText(cell);
    if (text === null) continue;
    const haystack = matchCase ? text : text.toLowerCase();
    if (!haystack.includes(comparable)) continue;
    matches.push({ row: cell.row, column: cell.column, text, replaceable: cell.formula === undefined });
  }
  return matches.sort((left, right) => left.row - right.row || left.column - right.column);
}

const REGEXP_METACHARACTERS = /[.*+?^${}()|[\]\\]/g;

/** Replace every occurrence of the query inside one cell's text, the pinned
 *  renderer's global replace: the query is a literal, never a pattern ("."
 *  replaces a literal dot), and a `$` in the replacement text is literal too. */
export function replaceInCellText(
  text: string,
  query: string,
  replacement: string,
  matchCase: boolean,
): string {
  const needle = normalizeFindQuery(query);
  if (needle === null) return text;
  const pattern = new RegExp(needle.replace(REGEXP_METACHARACTERS, "\\$&"), matchCase ? "g" : "gi");
  return text.replace(pattern, replacement.replace(/\$/g, "$$$$"));
}

/** The `sheet.command.set-range-values` payload for a batch of matches: one
 *  `{ v }` entry per writable match whose text actually changes. A match that
 *  would keep its text is not written (and not counted), so the op count and
 *  the journal stay honest. */
export interface XlsxFindReplacement {
  /** `{ [row]: { [column]: { v } } }` — the record shape the pinned
   *  range-values command passes through to its mutation and the journal. */
  readonly value: Record<string, Record<string, { v: string | number | boolean | null }>>;
  /** Cells this payload writes; one `set_cell` op each at save time. */
  readonly count: number;
}

/** The manual-typing value rule (`cellEditOperation` in `xlsx-editor-model.ts`)
 *  for a replacement: numeric-looking text is stored as a number, TRUE/FALSE
 *  as a boolean, the empty string clears the cell — so replacing "5" with "7"
 *  in a number cell keeps it numeric and inside SUM. A replacement that starts
 *  with "=" stays literal text: find & replace writes values, never new
 *  formulas. */
function coerceReplacementText(text: string): string | number | boolean | null {
  if (text === "") return null;
  if (text === "TRUE") return true;
  if (text === "FALSE") return false;
  const number = Number(text);
  if (text.trim() !== "" && Number.isFinite(number)) return number;
  return text;
}

export function buildFindReplacement(
  matches: readonly XlsxFindMatch[],
  query: string,
  replacement: string,
  matchCase: boolean,
): XlsxFindReplacement {
  const value: XlsxFindReplacement["value"] = {};
  let count = 0;
  for (const match of matches) {
    if (!match.replaceable) continue;
    const next = replaceInCellText(match.text, query, replacement, matchCase);
    if (next === match.text) continue;
    (value[String(match.row)] ??= {})[String(match.column)] = { v: coerceReplacementText(next) };
    count += 1;
  }
  return { value, count };
}

/** Replace-all refuses up front when the batch would exceed the engine's
 *  per-job op bound; nothing partial is ever sent. */
export function exceedsFindReplaceLimit(count: number, limit = FIND_REPLACE_OP_LIMIT): boolean {
  return count > limit;
}
