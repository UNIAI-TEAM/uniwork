import { Editor, type JSONContent } from "@tiptap/core";
import { Document } from "@tiptap/extension-document";
import { Paragraph } from "@tiptap/extension-paragraph";
import { Text } from "@tiptap/extension-text";
import { StarterKit } from "@tiptap/starter-kit";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clampMatchIndex,
  DEFAULT_FIND_OPTIONS,
  findMatches,
  findTextRanges,
  foldCase,
  isFindWordChar,
  matchElement,
  replaceMatches,
  revealMatch,
  stepMatchIndex,
} from "./find-state";

const editors: Editor[] = [];

function docOf(lines: string[]): JSONContent {
  return {
    type: "doc",
    content: lines.map((line) => ({ type: "paragraph", content: [{ type: "text", text: line }] })),
  };
}

function editorWith(lines: string[]): Editor {
  const editor = new Editor({ extensions: [Document, Paragraph, Text], content: docOf(lines) });
  editors.push(editor);
  return editor;
}

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

describe("findTextRanges", () => {
  it("matches case-insensitively by default", () => {
    expect(findTextRanges("Alpha alpha", "alpha", DEFAULT_FIND_OPTIONS)).toEqual([
      { start: 0, end: 5 },
      { start: 6, end: 11 },
    ]);
  });

  it("honours match case", () => {
    expect(findTextRanges("Alpha alpha", "Alpha", { matchCase: true, wholeWord: false })).toEqual([{ start: 0, end: 5 }]);
    expect(findTextRanges("Alpha alpha", "alpha", { matchCase: true, wholeWord: false })).toEqual([{ start: 6, end: 11 }]);
  });

  it("honours whole word over letters, digits and underscores", () => {
    const options = { matchCase: false, wholeWord: true };
    expect(findTextRanges("cat catalog", "cat", options)).toEqual([{ start: 0, end: 3 }]);
    expect(findTextRanges("mèo mèocon", "mèo", options)).toEqual([{ start: 0, end: 3 }]);
    expect(findTextRanges("v2 v20", "v2", options)).toEqual([{ start: 0, end: 2 }]);
    expect(findTextRanges("_cat cat_", "cat", options)).toEqual([]);
  });

  it("advances past each hit without overlapping", () => {
    expect(findTextRanges("aaaa", "aa", DEFAULT_FIND_OPTIONS)).toEqual([{ start: 0, end: 2 }, { start: 2, end: 4 }]);
  });

  it("finds nothing for an empty query", () => {
    expect(findTextRanges("anything", "", DEFAULT_FIND_OPTIONS)).toEqual([]);
  });
});

describe("foldCase / isFindWordChar", () => {
  it("keeps the string length so offsets stay aligned", () => {
    expect(foldCase("ABC")).toBe("abc");
    expect(foldCase("İ")).toHaveLength(1);
  });

  it("treats unicode letters, digits, combining marks and underscore as word characters", () => {
    expect(isFindWordChar("a")).toBe(true);
    expect(isFindWordChar("3")).toBe(true);
    expect(isFindWordChar("_")).toBe(true);
    expect(isFindWordChar("\u0301")).toBe(true);
    expect(isFindWordChar(" ")).toBe(false);
    expect(isFindWordChar(undefined)).toBe(false);
  });
});

describe("findMatches", () => {
  it("returns document positions in order across blocks", () => {
    const editor = editorWith(["Alpha beta", "alpha BETA"]);
    const matches = findMatches(editor, "alpha", DEFAULT_FIND_OPTIONS);
    const secondBlockStart = editor.state.doc.firstChild?.nodeSize ?? 0;
    expect(matches).toEqual([
      { from: 1, to: 6 },
      { from: secondBlockStart + 1, to: secondBlockStart + 6 },
    ]);
  });

  it("spans a run split by a mark", () => {
    const editor = new Editor({ extensions: [StarterKit], content: "<p>alpha <strong>beta</strong></p>" });
    editors.push(editor);
    const matches = findMatches(editor, "alpha beta", DEFAULT_FIND_OPTIONS);
    expect(matches).toHaveLength(1);
    expect(matches[0]).toEqual({ from: 1, to: 11 });
  });

  it("never matches across blocks or an inline leaf", () => {
    const editor = new Editor({ extensions: [StarterKit], content: "<p>cat</p><p>dog</p>" });
    editors.push(editor);
    expect(findMatches(editor, "catdog", DEFAULT_FIND_OPTIONS)).toEqual([]);

    const withBreak = new Editor({ extensions: [StarterKit], content: "<p>cat<br>dog</p>" });
    editors.push(withBreak);
    expect(findMatches(withBreak, "catdog", DEFAULT_FIND_OPTIONS)).toEqual([]);
    expect(findMatches(withBreak, "dog", DEFAULT_FIND_OPTIONS)).toHaveLength(1);
  });

  it("filters partial words when whole word is on", () => {
    const editor = editorWith(["cat", "catalog"]);
    expect(findMatches(editor, "cat", { matchCase: false, wholeWord: false })).toHaveLength(2);
    expect(findMatches(editor, "cat", { matchCase: false, wholeWord: true })).toHaveLength(1);
  });
});

describe("replaceMatches", () => {
  it("replaces every hit in one transaction and reports the count", () => {
    const editor = editorWith(["Alpha beta", "alpha BETA"]);
    const matches = findMatches(editor, "alpha", DEFAULT_FIND_OPTIONS);
    expect(replaceMatches(editor, matches, "X")).toBe(2);
    expect(editor.state.doc.textBetween(0, editor.state.doc.content.size, "\n")).toBe("X beta\nX BETA");
  });

  it("leaves a read-only editor untouched", () => {
    const editor = new Editor({ extensions: [Document, Paragraph, Text], content: docOf(["alpha"]), editable: false });
    editors.push(editor);
    expect(replaceMatches(editor, findMatches(editor, "alpha", DEFAULT_FIND_OPTIONS), "X")).toBe(0);
    expect(editor.state.doc.textContent).toBe("alpha");
  });
});

describe("stepMatchIndex / clampMatchIndex", () => {
  it("wraps in both directions", () => {
    expect(stepMatchIndex(0, 3, -1)).toBe(2);
    expect(stepMatchIndex(2, 3, 1)).toBe(0);
    expect(stepMatchIndex(1, 3, 1)).toBe(2);
    expect(stepMatchIndex(0, 0, 1)).toBe(0);
  });

  it("clamps a stale active index", () => {
    expect(clampMatchIndex(5, 2)).toBe(1);
    expect(clampMatchIndex(-3, 2)).toBe(0);
    expect(clampMatchIndex(3, 0)).toBe(0);
  });
});

describe("revealMatch", () => {
  it("selects the hit and scrolls its element into view", () => {
    const editor = editorWith(["hello world"]);
    const scrollIntoView = vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(() => undefined);
    const match = { from: 7, to: 12 };
    expect(matchElement(editor, match)).not.toBeNull();
    revealMatch(editor, match);
    expect(editor.state.selection.from).toBe(7);
    expect(editor.state.selection.to).toBe(12);
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    scrollIntoView.mockRestore();
  });
});
