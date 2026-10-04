/**
 * Selective Markdown escaping for the WYSIWYG serializer.
 *
 * The stock `@tiptap/markdown` serializer escapes every character in
 * `[\\`*_[\]~]` unconditionally (MarkdownManager.escapeMarkdownSyntax). That is
 * safe but it destroys text the document already had: `snake_case_name`,
 * `2 * 3`, `50% off` and a literal `[^1]` footnote marker all come back with
 * backslashes the author never typed, which breaks the byte round-trip this
 * lane is built on (G3-08: the saved source is the raw text).
 *
 * The rule here is the narrow one: escape a delimiter ONLY when it would
 * actually open/close Markdown syntax in this text. Concretely, escape every
 * occurrence of a character whose class has a *complete* delimiter pair in the
 * same text node:
 *
 *   - `\`  always (a literal backslash is always a potential escape)
 *   - `` ` `` always (a single backtick opens a code span)
 *   - `*`  only with a `*…*` or `**…**` pair around non-space content
 *   - `_`  only with an `_…_` pair that is NOT intraword (CommonMark forbids
 *          intraword `_` emphasis, which is what keeps `snake_case_name` clean)
 *   - `~`  only with a `~~…~~` pair (GFM strikethrough)
 *   - `[`  only when it starts a `[…](` link/image label; `]` never on its own
 *
 * `#`, `>`, `-`, `+` and `1.` are block-level openers, not inline ones: a text
 * node never starts a line at block level in this pipeline (a `# ` typed into a
 * paragraph is an input rule that turns the block into a heading), so they are
 * deliberately left alone.
 *
 * Over-escaping is not a corruption risk in this pipeline — it only makes a
 * block fail the representability check in `serialize.ts` and stay an opaque
 * raw node. Under-escaping is the risk, so every rule below errs toward
 * escaping when a pair is present.
 */

const BACKSLASH = "\\";
const BACKTICK = "`";
const ASTERISK = "*";
const UNDERSCORE = "_";
const TILDE = "~";
const OPEN_BRACKET = "[";

/** A `*…*` / `**…**` emphasis or strong pair around non-space content. */
const ASTERISK_PAIR = /\*{1,2}[^\s*](?:[\s\S]*?[^\s*])?\*{1,2}/;
/** An `_…_` pair that is not intraword (word characters on both sides). */
const UNDERSCORE_PAIR = /(?<![\w_])_[^\s_][^_]*_(?![\w_])/;
/** A GFM `~~…~~` strikethrough pair. */
const TILDE_PAIR = /~~[^\s~](?:[^~]*[^\s~])?~~/;
/** A `[label](` link or image opener. */
const LINK_OPENER = /\[[^\]]*\]\(/;

function needsEscaping(character: string, text: string): boolean {
  switch (character) {
    case BACKSLASH:
    case BACKTICK:
      return true;
    case ASTERISK:
      return ASTERISK_PAIR.test(text);
    case UNDERSCORE:
      return UNDERSCORE_PAIR.test(text);
    case TILDE:
      return TILDE_PAIR.test(text);
    case OPEN_BRACKET:
      return LINK_OPENER.test(text);
    default:
      return false;
  }
}

const ESCAPABLE = new Set([BACKSLASH, BACKTICK, ASTERISK, UNDERSCORE, TILDE, OPEN_BRACKET]);

/**
 * Above this length the pair probes are skipped and every escapable character
 * is escaped. The pair probes are linear on ordinary text but a pathological
 * run of delimiters could make them quadratic; over-escaping is never a
 * corruption (it only sends that block to the opaque raw node, which preserves
 * it byte-identically), so the bound costs nothing and removes the tail risk.
 */
const SELECTIVE_ESCAPE_SCAN_LIMIT = 8 * 1024;

/**
 * Escape only the Markdown-significant characters that would otherwise change
 * the meaning of `text`. Byte-stable for text with no live delimiter pair, so a
 * paragraph the user never touched serialises back exactly as it was read.
 */
export function escapeSelectiveMarkdownText(text: string): string {
  const selective = text.length <= SELECTIVE_ESCAPE_SCAN_LIMIT;
  let escaped = "";
  for (const character of text) {
    if (ESCAPABLE.has(character) && (!selective || needsEscaping(character, text))) {
      escaped += BACKSLASH + character;
    } else {
      escaped += character;
    }
  }
  return escaped;
}
