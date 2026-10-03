import { Editor } from "@tiptap/core";
import { describe, expect, it } from "vitest";
import { docxExtensions } from "../docx-schema";
import { countDocxText, docxEditorCounts, type DocxTextCounts } from "./index";

describe("DOCX status counts", () => {
  it("counts mixed Vietnamese/English words and characters", () => {
    const counts: DocxTextCounts = countDocxText("Xin chào UniWork team");
    expect(counts).toEqual({ words: 4, characters: 21, charactersWithoutSpaces: 18 });
  });

  it("counts an empty or whitespace-only document as zero words", () => {
    expect(countDocxText("")).toEqual({ words: 0, characters: 0, charactersWithoutSpaces: 0 });
    expect(countDocxText("  \t\n ")).toEqual({ words: 0, characters: 4, charactersWithoutSpaces: 0 });
  });

  it("does not count punctuation-only tokens as words", () => {
    expect(countDocxText("hello, world!")).toEqual({ words: 2, characters: 13, charactersWithoutSpaces: 12 });
    expect(countDocxText("— —")).toEqual({ words: 0, characters: 3, charactersWithoutSpaces: 2 });
  });

  it("collapses multiple spaces and newlines", () => {
    expect(countDocxText("a  b\n\nc")).toEqual({ words: 3, characters: 5, charactersWithoutSpaces: 3 });
  });

  it("reads the text of a TipTap editor document block by block", () => {
    const editor = new Editor({
      extensions: docxExtensions(),
      content: {
        type: "doc",
        content: [
          { type: "docParagraph", content: [{ type: "text", text: "Xin chào" }] },
          { type: "docParagraph", content: [{ type: "text", text: "UniWork team" }] },
        ],
      },
    });
    try {
      expect(docxEditorCounts(editor)).toEqual({ words: 4, characters: 20, charactersWithoutSpaces: 18 });
    } finally {
      editor.destroy();
    }
  });
});
