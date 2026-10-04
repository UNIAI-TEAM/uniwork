import { Editor, type JSONContent } from "@tiptap/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { docxExtensions } from "../docx-schema";
import { compileInlineEquation } from "../insert/math";
import { createInsertCommands } from "./insert";

const editors: Editor[] = [];

function editorWith(content: JSONContent, editable = true): Editor {
  const editor = new Editor({ extensions: docxExtensions(), content, editable });
  editors.push(editor);
  return editor;
}

function paragraphDoc(text: string): JSONContent {
  return {
    type: "doc",
    content: [{ type: "docParagraph", ...(text === "" ? {} : { content: [{ type: "text", text }] }) }],
  };
}

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  vi.restoreAllMocks();
});

describe("createInsertCommands", () => {
  it("is inert before a document opens", () => {
    const area = createInsertCommands({ getEditor: () => null });
    expect(area.readState(null)).toEqual({});
    expect(() => area.commands.insertSymbol("€")).not.toThrow();
    expect(area.commands.insertEquation("x^2")).toBe(false);
  });

  it("inserts a symbol at the caret as plain text", () => {
    const editor = editorWith(paragraphDoc("hello"));
    const area = createInsertCommands({ getEditor: () => editor });
    editor.commands.setTextSelection(3);
    area.commands.insertSymbol("€");
    expect(editor.state.doc.textContent).toBe("he€llo");
  });

  it("inserts a symbol into an empty paragraph and trims the input", () => {
    const editor = editorWith(paragraphDoc(""));
    const area = createInsertCommands({ getEditor: () => editor });
    area.commands.insertSymbol("  ₫  ");
    expect(editor.state.doc.textContent).toBe("₫");
  });

  it("ignores a blank symbol", () => {
    const editor = editorWith(paragraphDoc("hello"));
    const area = createInsertCommands({ getEditor: () => editor });
    editor.commands.setTextSelection(3);
    area.commands.insertSymbol("   ");
    expect(editor.state.doc.textContent).toBe("hello");
  });

  it("inserts a compiled equation as the inline math node at the caret", () => {
    const editor = editorWith(paragraphDoc("ab"));
    const area = createInsertCommands({ getEditor: () => editor });
    editor.commands.setTextSelection(2);
    expect(area.commands.insertEquation("x^2")).toBe(true);

    const paragraph = editor.state.doc.firstChild;
    expect(paragraph?.childCount).toBe(3);
    const inline = paragraph?.child(1);
    expect(inline?.type.name).toBe("docInlineMath");
    expect(inline?.attrs).toMatchObject(compileInlineEquation("x^2"));
  });

  it("inserts a compiled equation into an empty paragraph", () => {
    const editor = editorWith(paragraphDoc(""));
    const area = createInsertCommands({ getEditor: () => editor });
    expect(area.commands.insertEquation("\\frac{a}{b}")).toBe(true);
    const paragraph = editor.state.doc.firstChild;
    expect(paragraph?.childCount).toBe(1);
    expect(paragraph?.child(0).type.name).toBe("docInlineMath");
  });

  it("rejects unsupported LaTeX and leaves the document untouched", () => {
    const editor = editorWith(paragraphDoc("ab"));
    const area = createInsertCommands({ getEditor: () => editor });
    editor.commands.setTextSelection(2);
    expect(area.commands.insertEquation("\\nope")).toBe(false);
    expect(editor.state.doc.firstChild?.childCount).toBe(1);
    expect(editor.state.doc.textContent).toBe("ab");
  });

  it("is a no-op on a read-only document", () => {
    const editor = editorWith(paragraphDoc("hello"), false);
    const area = createInsertCommands({ getEditor: () => editor });
    editor.commands.setTextSelection(3);
    area.commands.insertSymbol("€");
    expect(editor.state.doc.textContent).toBe("hello");
    expect(area.commands.insertEquation("x^2")).toBe(false);
  });
});
