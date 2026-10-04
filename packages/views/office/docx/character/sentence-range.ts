import type { ResolvedPos } from "@tiptap/pm/model";

const END = /[。．！？!?…]/;
const CLOSE = /[”』」）)》〉】'"]/;

/**
 * The sentence containing a position inside its textblock — the range Word's
 * format painter brushes for a plain click; ported from genoffice's
 * `sentenceRangeAt` (Ribbon.tsx) so clicking with an armed brush repaints
 * visible text instead of leaving invisible stored marks. Returns null for a
 * position outside a textblock. The trailing space belongs to the sentence,
 * the leading one to the previous sentence.
 */
export function sentenceRangeAt($pos: ResolvedPos): { from: number; to: number } | null {
  const para = $pos.parent;
  if (!para.isTextblock) return null;
  // Leaf nodes (images, breaks) become one placeholder char so offsets line up.
  const text = para.textBetween(0, para.content.size, undefined, "\uFFFC");
  // "." ends a sentence unless a digit follows (1.5, 3.14 stay intact).
  const at = (index: number): boolean =>
    END.test(text[index] ?? "") || (text[index] === "." && !/\d/.test(text[index + 1] ?? ""));
  // A straight quote counts as a closing quote only when it directly follows a
  // terminator (or another closer, `…。”"`), so the opening quote of `"Hi…`
  // stays inside the brushed range. The CJK/paired closers are unambiguous.
  const closingAt = (index: number): boolean => {
    const char = text[index] ?? "";
    if (!CLOSE.test(char)) return false;
    if (!/['"]/.test(char)) return true;
    return at(index - 1) || (index > 0 && closingAt(index - 1));
  };
  // A click landing in a sentence's trailing closers/spaces belongs to THAT
  // sentence, not the next one: re-anchor on its terminator.
  let anchor = $pos.parentOffset;
  {
    let index = anchor;
    while (index > 0 && (closingAt(index) || /[ \t]/.test(text[index] ?? ""))) index--;
    if (index < anchor && at(index)) anchor = index;
  }
  let start = anchor;
  while (start > 0 && !at(start - 1)) start--;
  while (start < text.length && closingAt(start)) start++;
  while (start < text.length && /\s/.test(text[start] ?? "")) start++;
  let end = anchor;
  while (end < text.length && !at(end)) end++;
  if (end < text.length) end++;
  while (end < text.length && closingAt(end)) end++;
  while (end < text.length && /[ \t]/.test(text[end] ?? "")) end++;
  if (start >= end) {
    // Clicked in the empty tail after the final delimiter (or an empty
    // paragraph): nothing to mark, so the caret stays put.
    start = end = $pos.parentOffset;
  }
  const base = $pos.start();
  return { from: base + start, to: base + end };
}
