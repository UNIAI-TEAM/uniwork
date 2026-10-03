import type { Editor } from "@tiptap/core";

/** One hit in the document. `from` is inclusive, `to` exclusive — the same
 * half-open convention ProseMirror uses for text ranges. */
export interface FindMatch {
  from: number;
  to: number;
}

export interface FindOptions {
  matchCase: boolean;
  wholeWord: boolean;
}

export const DEFAULT_FIND_OPTIONS: FindOptions = { matchCase: false, wholeWord: false };

/** Hits inside one string, as offsets into that string. */
export interface TextRange {
  start: number;
  end: number;
}

const WORD_CHAR = /[\p{L}\p{N}_]/u;

/** Inline leaves that are not text (a hard break, an inline image, a note
 * reference) occupy one character that can never match a query. */
const LEAF_PLACEHOLDER = "\u0000";

/** Lowercase that never changes a string's length: a character whose lowercase
 * grows ("İ" → "i̇") keeps its original form, so match offsets stay aligned
 * with the source text. */
export function foldCase(value: string): string {
  let folded = "";
  for (const char of value) {
    const lower = char.toLowerCase();
    folded += lower.length === char.length ? lower : char;
  }
  return folded;
}

export function isFindWordChar(char: string | undefined): boolean {
  return typeof char === "string" && WORD_CHAR.test(char);
}

/** Non-overlapping hits of `query` in one block's flattened text. */
export function findTextRanges(text: string, query: string, options: FindOptions): TextRange[] {
  const ranges: TextRange[] = [];
  if (query.length === 0) return ranges;
  const haystack = options.matchCase ? text : foldCase(text);
  const needle = options.matchCase ? query : foldCase(query);
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    const isWholeWord =
      !options.wholeWord || (!isFindWordChar(text[index - 1]) && !isFindWordChar(text[index + needle.length]));
    if (isWholeWord) {
      ranges.push({ start: index, end: index + needle.length });
      index = haystack.indexOf(needle, index + needle.length);
    } else {
      index = haystack.indexOf(needle, index + 1);
    }
  }
  return ranges;
}

/** Every hit of `query` inside the editor's textblocks, in document order.
 * Each block is flattened first so a query can span the inline nodes of one
 * paragraph (a run split by a mark) but never two blocks. */
export function findMatches(editor: Editor, query: string, options: FindOptions): FindMatch[] {
  const matches: FindMatch[] = [];
  if (query.length === 0) return matches;
  editor.state.doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    let text = "";
    const positions: number[] = [];
    node.forEach((child, offset) => {
      if (child.isText && child.text) {
        for (let index = 0; index < child.text.length; index += 1) {
          positions.push(pos + 1 + offset + index);
        }
        text += child.text;
      } else {
        positions.push(pos + 1 + offset);
        text += LEAF_PLACEHOLDER;
      }
    });
    for (const range of findTextRanges(text, query, options)) {
      const from = positions[range.start];
      const last = positions[range.end - 1];
      if (from === undefined || last === undefined) continue;
      matches.push({ from, to: last + 1 });
    }
    return false;
  });
  return matches;
}

/** The next active index in `direction`, wrapping around; 0 when there is
 * nothing to step through. */
export function stepMatchIndex(current: number, count: number, direction: 1 | -1): number {
  if (count <= 0) return 0;
  return ((current + direction) % count + count) % count;
}

/** Keep an index valid when the result set shrinks or grows. */
export function clampMatchIndex(index: number, count: number): number {
  if (count <= 0) return 0;
  return Math.min(Math.max(index, 0), count - 1);
}

/** Replace every hit in one transaction, last-to-first so earlier offsets stay
 * valid while the document changes under them. Returns how many were replaced.
 * A read-only editor is left untouched. */
export function replaceMatches(editor: Editor, matches: readonly FindMatch[], replacement: string): number {
  if (matches.length === 0 || !editor.isEditable) return 0;
  const ordered = [...matches].sort((left, right) => right.from - left.from);
  editor.commands.command(({ tr }) => {
    for (const match of ordered) tr.insertText(replacement, match.from, match.to);
    return true;
  });
  return matches.length;
}

/** The DOM element that carries a hit; null when the position cannot be
 * resolved to an element (a detached view). */
export function matchElement(editor: Editor, match: FindMatch): HTMLElement | null {
  const { node } = editor.view.domAtPos(match.from);
  return node instanceof HTMLElement ? node : node.parentElement;
}

/** Select a hit and bring it to the middle of the scroll container. */
export function revealMatch(editor: Editor, match: FindMatch): void {
  editor.commands.setTextSelection({ from: match.from, to: match.to });
  matchElement(editor, match)?.scrollIntoView({ block: "center" });
}
