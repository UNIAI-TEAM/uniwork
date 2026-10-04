import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";
import { docxExtensions } from "../docx-schema";
import { sentenceRangeAt } from "./sentence-range";

const editors: Editor[] = [];

function editorWith(text: string): Editor {
  const editor = new Editor({
    extensions: docxExtensions(),
    content: { type: "doc", content: [{ type: "docParagraph", content: [{ type: "text", text }] }] },
  });
  editors.push(editor);
  return editor;
}

function rangeAt(editor: Editor, pos: number) {
  return sentenceRangeAt(editor.state.doc.resolve(pos));
}

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

describe("sentenceRangeAt", () => {
  it("returns the sentence around the caret, trailing space included", () => {
    const editor = editorWith("Alpha beta. Gamma delta");
    // "Alpha beta. " occupies offsets 0-11; the second sentence starts at 12.
    expect(rangeAt(editor, 3)).toEqual({ from: 1, to: 13 });
    expect(rangeAt(editor, 15)).toEqual({ from: 13, to: 24 });
  });

  it("treats a period before a digit as part of the sentence", () => {
    const editor = editorWith("Version 1.5 is out. Done");
    expect(rangeAt(editor, 3)).toEqual({ from: 1, to: 21 });
    expect(rangeAt(editor, 21)).toEqual({ from: 21, to: 25 });
  });

  it("keeps CJK closers with the sentence they close", () => {
    const editor = editorWith("Đúng。） Tiếp");
    expect(rangeAt(editor, 2)).toEqual({ from: 1, to: 8 });
  });

  it("keeps an opening straight quote inside the brushed sentence", () => {
    const editor = editorWith('Hi. "Next." done');
    // The quote after "Hi." opens the next sentence instead of closing it.
    expect(rangeAt(editor, 7)).toEqual({ from: 5, to: 13 });
  });

  it("collapses to the caret in the empty tail after the last delimiter", () => {
    const editor = editorWith("Done. ");
    expect(rangeAt(editor, 7)).toEqual({ from: 7, to: 7 });
  });

  it("returns null for a position outside a textblock", () => {
    const editor = editorWith("Body");
    expect(sentenceRangeAt(editor.state.doc.resolve(0))).toBeNull();
  });
});
