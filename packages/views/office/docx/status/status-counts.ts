import type { Editor } from "@tiptap/core";

/** The figures the status bar mirrors; every value is a whole number. */
export interface DocxTextCounts {
  /** Whitespace-separated tokens that carry at least one letter or number. */
  words: number;
  /** Unicode code points except line breaks; spaces count. */
  characters: number;
  /** Unicode code points that are not whitespace. */
  charactersWithoutSpaces: number;
}

// A token counts as a word when it carries at least one Unicode letter or
// number, so punctuation-only tokens ("—", "…") never inflate the figure.
// Tokens are whitespace-separated: Vietnamese writes syllables separated by
// spaces, so each syllable counts as a word, exactly like Latin-script words.
const WORD_CHAR_RE = /[\p{L}\p{N}]/u;
// Block boundaries keep words from merging across paragraphs; the separator
// itself is layout, not content a reader sees, so it is never a character.
const LINE_BREAK_RE = /[\n\r\u2028\u2029]/u;
const WHITESPACE_RE = /\s/u;

/** Counts one plain-text body (the text a reader sees, not the package). */
export function countDocxText(text: string): DocxTextCounts {
  const codePoints = [...text];
  return {
    words: text.split(/\s+/u).filter((token) => WORD_CHAR_RE.test(token)).length,
    characters: codePoints.filter((char) => !LINE_BREAK_RE.test(char)).length,
    charactersWithoutSpaces: codePoints.filter((char) => !WHITESPACE_RE.test(char)).length,
  };
}

/**
 * Plain text of one editor document at call time: blocks join with a newline
 * and leaf nodes (hard breaks, images) contribute a break, so two blocks never
 * merge into one word.
 */
function docxEditorText(editor: Editor): string {
  const { doc } = editor.state;
  return doc.textBetween(0, doc.content.size, "\n", "\n");
}

/**
 * Counts the live editor document. The bar re-renders when its parent does, so
 * the wiring either re-renders on editor transactions or passes `counts` it
 * already owns.
 */
export function docxEditorCounts(editor: Editor): DocxTextCounts {
  return countDocxText(docxEditorText(editor));
}
