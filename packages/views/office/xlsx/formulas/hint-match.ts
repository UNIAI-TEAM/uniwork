// Wave A / A8 (UNI-926): the formula-bar hint token rule. Pure, renderer-free
// logic so the hints component and its tests share exactly one rule set.

/** The function-name token the caret currently sits in. `prefix` is the
 *  typed name fragment (never empty: a bare `=` has no name token). */
export interface XlsxFunctionToken {
  readonly prefix: string;
  /** Offsets in the draft: `[start, end)`. */
  readonly start: number;
  readonly end: number;
}

const NAME_CHAR = /[A-Za-z0-9_.]/;
const NAME_START = /[A-Za-z]/;

/** Positions where a function name may begin: the formula start, an opening
 *  paren (nested calls), an argument separator, or an operator. */
const OPENERS = new Set(["(", ",", ";", "+", "-", "*", "/", "^", "&", "=", "<", ">", "%"]);

/** Whether the caret sits inside a double-quoted string literal. Excel escapes
 *  a quote by doubling it, so `""` never closes the literal. */
function insideStringLiteral(draft: string, caret: number): boolean {
  let inString = false;
  for (let index = 1; index < caret; index += 1) {
    const char = draft[index];
    if (!inString) {
      if (char === '"') inString = true;
      continue;
    }
    if (char === '"') {
      if (draft[index + 1] === '"') {
        index += 1;
        continue;
      }
      inString = false;
    }
  }
  return inString;
}

/**
 * The function-name token containing `caret`, or null when the caret is not in
 * one: the draft must be a formula, the caret must not sit inside a string
 * literal, the token must start with a letter, and it must not already be
 * followed by `(` (a complete call shows no hints).
 */
export function functionTokenAt(draft: string, caret: number): XlsxFunctionToken | null {
  if (!draft.startsWith("=")) return null;
  const position = Math.max(1, Math.min(caret, draft.length));
  if (insideStringLiteral(draft, position)) return null;

  let start = position;
  while (start > 1 && NAME_CHAR.test(draft[start - 1]!)) start -= 1;
  const prefix = draft.slice(start, position);
  if (prefix.length === 0 || !NAME_START.test(prefix[0]!)) return null;

  // Skip spaces between the opener and the name (`=SUM( A1` is still the
  // argument-start position).
  let openerIndex = start;
  while (openerIndex > 1 && draft[openerIndex - 1] === " ") openerIndex -= 1;
  const opener = openerIndex === 1 ? "=" : draft[openerIndex - 1]!;
  if (!OPENERS.has(opener)) return null;

  let end = position;
  while (end < draft.length && NAME_CHAR.test(draft[end]!)) end += 1;
  // A name followed by "(" is already a complete call: nothing to suggest,
  // however the caret sits inside it.
  if (draft[end] === "(") return null;

  return { prefix, start, end };
}

/** The draft and caret after completing `name` at the token: the typed
 *  fragment is replaced by `NAME(`, and the caret lands after the paren so the
 *  user types arguments next (Excel's own behaviour). */
export function completeFunctionName(
  draft: string,
  token: XlsxFunctionToken,
  name: string,
): { value: string; caret: number } {
  const inserted = `${name.toUpperCase()}(`;
  return {
    value: `${draft.slice(0, token.start)}${inserted}${draft.slice(token.end)}`,
    caret: token.start + inserted.length,
  };
}