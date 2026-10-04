import { Editor } from "@tiptap/core";
import { beforeEach, describe, expect, it } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import { DEFAULT_FONT_SIZE_PT } from "../character/font-size";
import { docxExtensions } from "../docx-schema";
import { docxDefaultFontSizePt, docxFontSizeDisplay } from "./font-size-display";

initI18n();

beforeEach(async () => {
  await setLocale("en");
});

const editors: Editor[] = [];

function editorWith(text: string): Editor {
  const editor = new Editor({
    extensions: docxExtensions(),
    content: { type: "doc", content: [{ type: "docParagraph", content: [{ type: "text", text }] }] },
  });
  editors.push(editor);
  return editor;
}

function destroyAll(): void {
  for (const editor of editors.splice(0)) editor.destroy();
}

describe("docxFontSizeDisplay", () => {
  it("falls back to the document default for a caret with no explicit size", () => {
    const editor = editorWith("hello world");
    editor.commands.setTextSelection(3);
    try {
      expect(docxFontSizeDisplay(editor, null)).toEqual({ value: DEFAULT_FONT_SIZE_PT, mixed: false });
    } finally {
      destroyAll();
    }
  });

  it("reads the document's own default size from the page root", () => {
    const editor = editorWith("hello world");
    (editor.view.dom as HTMLElement).style.setProperty("--doc-base-fs", "10.5pt");
    try {
      expect(docxDefaultFontSizePt(editor)).toBe(10.5);
      expect(docxFontSizeDisplay(editor, null).value).toBe(10.5);
    } finally {
      destroyAll();
    }
  });

  it("keeps an explicit run size over the document default", () => {
    const editor = editorWith("hello world");
    editor.chain().setTextSelection({ from: 1, to: 6 }).setMark("docTextStyle", { sizeHalfPoints: 28 }).run();
    editor.commands.setTextSelection(3);
    try {
      expect(docxFontSizeDisplay(editor, null)).toEqual({ value: 14, mixed: false });
    } finally {
      destroyAll();
    }
  });

  it("resolves unstyled runs at the default so a mixed selection is mixed", () => {
    const editor = editorWith("hello world");
    editor.chain().setTextSelection({ from: 1, to: 6 }).setMark("docTextStyle", { sizeHalfPoints: 28 }).run();
    editor.commands.setTextSelection({ from: 1, to: 12 });
    try {
      expect(docxFontSizeDisplay(editor, null)).toEqual({ value: null, mixed: true });
    } finally {
      destroyAll();
    }
  });

  it("shows the shared size when every touched run resolves to the same size", () => {
    const editor = editorWith("hello world");
    editor.chain().setTextSelection({ from: 1, to: 6 }).setMark("docTextStyle", { sizeHalfPoints: 28 }).run();
    editor.commands.setTextSelection({ from: 1, to: 5 });
    try {
      expect(docxFontSizeDisplay(editor, null)).toEqual({ value: 14, mixed: false });
    } finally {
      destroyAll();
    }
  });

  it("prefers an explicit caller-supplied default", () => {
    const editor = editorWith("hello world");
    editor.commands.setTextSelection(3);
    try {
      expect(docxFontSizeDisplay(editor, null, 9).value).toBe(9);
    } finally {
      destroyAll();
    }
  });

  it("falls back to Word's built-in size when no editor is mounted", () => {
    expect(docxDefaultFontSizePt(null)).toBe(DEFAULT_FONT_SIZE_PT);
    expect(docxFontSizeDisplay(null, null)).toEqual({ value: null, mixed: false });
  });
});
