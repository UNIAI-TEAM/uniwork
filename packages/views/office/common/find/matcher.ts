/**
 * Pure find/replace matcher shared by every office text surface (plain
 * textarea, TipTap, CodeMirror). It never touches the DOM and never owns the
 * document: the caller hands it the text it is searching and receives ranges
 * back, so one implementation serves every host.
 *
 * Matching is done on a folded copy of the text and every offset is mapped
 * back to the original string:
 *
 * - `fold` composes each base character with its own combining marks (NFC,
 *   unit by unit) and then lowercases that unit. Vietnamese reaches the page
 *   either composed or decomposed - text pasted from macOS files arrives as a
 *   base letter plus combining marks - so both forms compare equal without
 *   normalising the whole document and losing the offsets. Lowercasing unit by
 *   unit is what keeps the map exact: the only length-changing case mapping
 *   (U+0130) is handled because the map is built from the folded length.
 * - Word boundaries read code points, not code units, and treat every Unicode
 *   letter (including accented Vietnamese letters), mark, digit and `_` as a
 *   word character, so `wholeWord` works on "Nguyễn" and "Đường".
 */

/** Input to {@link findMatches}. `regex` is off unless the caller asks for it. */
export interface FindQuery {
  text: string;
  query: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
}

/** A match range in the original `text`, in code units. `end` is exclusive. */
export interface FindMatch {
  readonly start: number;
  readonly end: number;
}

export interface FindResult {
  /** Ordered, non-overlapping matches. */
  readonly matches: readonly FindMatch[];
  /** `matches.length`, kept so a counter does not index the array. */
  readonly count: number;
  /** True when `regex` was on and `query` is not a valid pattern. */
  readonly invalidPattern: boolean;
}

/** One replacement the caller applies to its own document. */
export interface FindReplaceEdit {
  readonly start: number;
  readonly end: number;
  readonly replacement: string;
}

const WORD_CHAR = /[\p{L}\p{M}\p{N}_]/u;
// One base character with the combining marks that follow it, or a run of
// marks with no base. These units tile the string, so folding unit by unit
// keeps a map back to the original offsets.
const COMBINING_UNIT = /\P{M}\p{M}*|\p{M}+/gu;

interface Folded {
  text: string;
  /** Original start of each folded code unit; `null` when folding was identity. */
  starts: number[] | null;
  /** Original end of each folded code unit; `null` when folding was identity. */
  ends: number[] | null;
}

/**
 * Fold for comparison. The mapping is deliberately *simple*, per-unit and
 * asymmetric, and pinned by tests:
 *
 * - Lowercasing unit by unit is what keeps the offset map exact (see above),
 *   but it means a needle is a prefix match: query "i" finds "\u0130" (folded
 *   "i\u0307") while query "\u0130" does not find "i".
 * - Simple folding also misses full-fold pairs such as "\u03c2"/"\u03c3".
 * Both are Unicode-defensible either way; do not "fix" them without new tests,
 * because a length-changing fold is exactly what breaks the offset map.
 */
function fold(raw: string, lower: boolean): Folded {
  let text = "";
  const starts: number[] = [];
  const ends: number[] = [];
  let offset = 0;
  for (const [unit] of raw.matchAll(COMBINING_UNIT)) {
    const start = offset;
    offset += unit.length;
    const composed = unit.normalize("NFC");
    const piece = lower ? composed.toLowerCase() : composed;
    text += piece;
    for (let i = 0; i < piece.length; i += 1) {
      starts.push(start);
      ends.push(offset);
    }
  }
  if (text === raw) return { text: raw, starts: null, ends: null };
  return { text, starts, ends };
}

function isWordChar(char: string): boolean {
  return char !== "" && WORD_CHAR.test(char);
}

/** The whole code point that ends at `index`, or "" at the start of the text. */
function charBefore(text: string, index: number): string {
  if (index <= 0) return "";
  const previous = text.charCodeAt(index - 1);
  const isLowSurrogate = previous >= 0xdc00 && previous <= 0xdfff;
  return text.slice(isLowSurrogate && index >= 2 ? index - 2 : index - 1, index);
}

/** The whole code point that starts at `index`, or "" at the end of the text. */
function charAt(text: string, index: number): string {
  if (index >= text.length) return "";
  const code = text.codePointAt(index);
  return code === undefined ? "" : String.fromCodePoint(code);
}

/**
 * True when the range is not inside a longer word: the code point before the
 * start and the one after the end are both non-word characters (or absent).
 */
function isWholeWord(text: string, start: number, end: number): boolean {
  return !isWordChar(charBefore(text, start)) && !isWordChar(charAt(text, end));
}

function mapRange(folded: Folded, start: number, end: number): FindMatch {
  return {
    start: folded.starts?.[start] ?? start,
    end: folded.ends?.[end - 1] ?? end,
  };
}

function findLiteral(input: FindQuery): FindResult {
  const haystack = fold(input.text, !input.caseSensitive);
  const needle = fold(input.query, !input.caseSensitive).text;
  const matches: FindMatch[] = [];
  let from = 0;
  for (;;) {
    const index = haystack.text.indexOf(needle, from);
    if (index === -1) break;
    const end = index + needle.length;
    if (!input.wholeWord || isWholeWord(haystack.text, index, end)) {
      // Folding is not length-preserving (U+0130 lowers to "i\u0307"), so two
      // matches that are disjoint in the folded text can map back onto
      // overlapping ranges in the original. Keep the first and drop the rest
      // so `matches` stays ordered and non-overlapping - otherwise applyEdits
      // silently drops the later edit while the counter still counts it.
      const mapped = mapRange(haystack, index, end);
      const previous = matches[matches.length - 1];
      if (previous === undefined || mapped.start >= previous.end) {
        matches.push(mapped);
      }
    }
    // `needle` is non-empty here, so `from` always advances.
    from = end;
  }
  return { matches, count: matches.length, invalidPattern: false };
}

/** One code point forward, so a zero-length match cannot stall the scan. */
function advance(text: string, index: number): number {
  if (index >= text.length) return index + 1;
  const code = text.codePointAt(index);
  return index + (code !== undefined && code > 0xffff ? 2 : 1);
}

/**
 * Compile `query` as a global pattern, or `null` when it is not a valid one.
 *
 * - `u` keeps `.` (and every other atom) from splitting a surrogate pair; a
 *   half-surrogate match would be written back into the document as a lone
 *   surrogate.
 * - `m` anchors `^` and `$` per line, which is what every editor search does
 *   in a multi-line document.
 */
function compilePattern(input: FindQuery): RegExp | null {
  try {
    return new RegExp(input.query, input.caseSensitive ? "gmu" : "gimu");
  } catch {
    return null;
  }
}

function findPattern(input: FindQuery, pattern: RegExp): FindResult {
  const matches: FindMatch[] = [];
  let match = pattern.exec(input.text);
  while (match !== null) {
    const start = match.index;
    const value = match[0];
    if (value.length === 0) {
      // `^`, `$`, `\b` and lookaheads match without consuming anything; a bare
      // `exec` loop on them never moves `lastIndex`. Step one code point.
      pattern.lastIndex = advance(input.text, pattern.lastIndex);
      match = pattern.exec(input.text);
      continue;
    }
    const end = start + value.length;
    if (!input.wholeWord || isWholeWord(input.text, start, end)) {
      matches.push({ start, end });
    }
    match = pattern.exec(input.text);
  }
  return { matches, count: matches.length, invalidPattern: false };
}

/**
 * Every occurrence of `query` in `text`, in order, or the typed
 * `invalidPattern` state when `regex` is on and the query cannot compile.
 * The pattern is validated before the "cannot match" early-outs, so an invalid
 * pattern reports `invalidPattern` even against an empty query or an empty
 * document. A query that cannot match (empty query, or an empty document)
 * otherwise yields no matches rather than throwing.
 */
export function findMatches(input: FindQuery): FindResult {
  const pattern = input.regex ? compilePattern(input) : null;
  if (input.regex && pattern === null) {
    return { matches: [], count: 0, invalidPattern: true };
  }
  if (input.query.length === 0 || input.text.length === 0) {
    return { matches: [], count: 0, invalidPattern: false };
  }
  return pattern === null ? findLiteral(input) : findPattern(input, pattern);
}

/**
 * Apply replacement edits to `text`. Edits are applied left to right and an
 * edit that overlaps the previous one is skipped rather than corrupting the
 * result, so a caller may pass a list straight from {@link findMatches}.
 */
export function applyEdits(text: string, edits: readonly FindReplaceEdit[]): string {
  if (edits.length === 0) return text;
  const ordered = [...edits].sort((left, right) => left.start - right.start);
  let out = "";
  let cursor = 0;
  for (const edit of ordered) {
    if (edit.start < cursor) continue;
    out += text.slice(cursor, edit.start) + edit.replacement;
    cursor = edit.end;
  }
  return out + text.slice(cursor);
}
