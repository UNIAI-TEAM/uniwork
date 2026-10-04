import { Editor, type JSONContent } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";
import { docxExtensions } from "../docx-schema";
import { EMPTY_PARAGRAPH_FORMAT_STATE } from "../paragraph/paragraph-format";
import { createParagraphCommands } from "./paragraph";

const editors: Editor[] = [];

function paragraph(text: string, attrs: Record<string, unknown> = {}): JSONContent {
  return { type: "docParagraph", attrs: { docxIndex: 0, ...attrs }, content: [{ type: "text", text }] };
}

function heading(text: string, level: number, attrs: Record<string, unknown> = {}): JSONContent {
  return { type: "docHeading", attrs: { docxIndex: 0, level, ...attrs }, content: [{ type: "text", text }] };
}

function listItem(text: string, attrs: Record<string, unknown> = {}): JSONContent {
  return {
    type: "docListItem",
    attrs: { docxIndex: 0, kind: "bullet", numId: "new-list-1", ilvl: 0, ...attrs },
    content: [{ type: "text", text }],
  };
}

function editorWith(content: JSONContent[]): Editor {
  const editor = new Editor({ extensions: docxExtensions(), content: { type: "doc", content } });
  editors.push(editor);
  return editor;
}

function areaWith(editor: Editor | null) {
  return createParagraphCommands({ getEditor: () => editor });
}

function blockAt(editor: Editor, index = 0) {
  return editor.state.doc.child(index);
}

function attrsAt(editor: Editor, index = 0): Record<string, unknown> {
  return blockAt(editor, index).attrs as Record<string, unknown>;
}

function caretInBlock(editor: Editor, index = 0): void {
  let pos = 0;
  for (let i = 0; i < index; i++) pos += blockAt(editor, i).nodeSize;
  editor.commands.setTextSelection(pos + 2);
}

function selectAllBlocks(editor: Editor): void {
  editor.commands.setTextSelection({ from: 1, to: editor.state.doc.content.size - 1 });
}

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

describe("createParagraphCommands: state mapping", () => {
  it("reports the empty state before a document opens", () => {
    const area = areaWith(null);
    expect(area.readState(null)).toEqual(EMPTY_PARAGRAPH_FORMAT_STATE);
    expect(() => {
      area.commands.setParagraphAlign("center");
      area.commands.stepParagraphIndent(1);
      area.commands.setLineSpacing(1.5);
      area.commands.setSpaceBeforePt(12);
      area.commands.setSpaceAfterPt(12);
      area.commands.applyParagraphStyle("heading-1");
    }).not.toThrow();
  });

  it("reads alignment, indents, spacing and the gallery style from the caret's block", () => {
    const editor = editorWith([
      paragraph("hello", { align: "center", indentLeft: 720, lineSpacing: 1.5, spaceBefore: 120, spaceAfter: 240 }),
    ]);
    const area = areaWith(editor);
    caretInBlock(editor);
    expect(area.readState(editor)).toEqual({
      align: "center",
      indentLeftTwips: 720,
      lineSpacing: 1.5,
      spaceBeforeTwips: 120,
      spaceAfterTwips: 240,
      paragraphStyle: "normal",
    });
  });

  it("treats a missing alignment as left so one button is always active", () => {
    const editor = editorWith([paragraph("hello")]);
    const area = areaWith(editor);
    caretInBlock(editor);
    expect(area.readState(editor).align).toBe("left");
    expect(area.readState(editor).paragraphStyle).toBe("normal");
  });

  it("maps headings by level and paragraph styles by id", () => {
    const editor = editorWith([
      heading("one", 3),
      paragraph("title", { styleId: "Title" }),
      paragraph("quote", { styleId: "Quote" }),
      paragraph("custom", { styleId: "MyStyle" }),
      listItem("item"),
    ]);
    const area = areaWith(editor);
    caretInBlock(editor, 0);
    expect(area.readState(editor).paragraphStyle).toBe("heading-3");
    caretInBlock(editor, 1);
    expect(area.readState(editor).paragraphStyle).toBe("title");
    caretInBlock(editor, 2);
    expect(area.readState(editor).paragraphStyle).toBe("quote");
    caretInBlock(editor, 3);
    expect(area.readState(editor).paragraphStyle).toBeNull();
    caretInBlock(editor, 4);
    expect(area.readState(editor).paragraphStyle).toBe("normal");
  });
});

describe("createParagraphCommands: alignment", () => {
  it("sets the alignment on the caret's block and leaves other attrs alone", () => {
    const editor = editorWith([paragraph("hello", { indentLeft: 720 })]);
    const area = areaWith(editor);
    caretInBlock(editor);
    area.commands.setParagraphAlign("justify");
    expect(attrsAt(editor).align).toBe("justify");
    expect(attrsAt(editor).indentLeft).toBe(720);
    expect(area.readState(editor).align).toBe("justify");
  });

  it("keeps the explicit left value when leaving a centre alignment", () => {
    const editor = editorWith([paragraph("hello", { align: "center" })]);
    const area = areaWith(editor);
    caretInBlock(editor);
    area.commands.setParagraphAlign("left");
    expect(attrsAt(editor).align).toBe("left");
  });

  it("does not rewrite a block that already reads as the requested alignment", () => {
    const editor = editorWith([paragraph("hello")]);
    const area = areaWith(editor);
    caretInBlock(editor);
    const before = editor.getJSON();
    area.commands.setParagraphAlign("left");
    expect(editor.getJSON()).toEqual(before);
  });

  it("applies the alignment to every block the selection touches", () => {
    const editor = editorWith([paragraph("one"), heading("two", 2)]);
    const area = areaWith(editor);
    selectAllBlocks(editor);
    area.commands.setParagraphAlign("right");
    expect(attrsAt(editor, 0).align).toBe("right");
    expect(attrsAt(editor, 1).align).toBe("right");
  });
});

describe("createParagraphCommands: indent and outdent", () => {
  it("steps a paragraph by one half-inch stop and back", () => {
    const editor = editorWith([paragraph("hello")]);
    const area = areaWith(editor);
    caretInBlock(editor);
    area.commands.stepParagraphIndent(1);
    expect(attrsAt(editor).indentLeft).toBe(720);
    area.commands.stepParagraphIndent(1);
    expect(attrsAt(editor).indentLeft).toBe(1440);
    area.commands.stepParagraphIndent(-1);
    expect(attrsAt(editor).indentLeft).toBe(720);
  });

  it("does not outdent past the left margin", () => {
    const editor = editorWith([paragraph("hello")]);
    const area = areaWith(editor);
    caretInBlock(editor);
    const before = editor.getJSON();
    area.commands.stepParagraphIndent(-1);
    expect(editor.getJSON()).toEqual(before);
    expect(attrsAt(editor).indentLeft ?? null).toBeNull();
  });

  it("keeps the alignment when stepping the indent", () => {
    const editor = editorWith([paragraph("hello", { align: "center" })]);
    const area = areaWith(editor);
    caretInBlock(editor);
    area.commands.stepParagraphIndent(1);
    expect(attrsAt(editor).align).toBe("center");
  });

  it("changes a list item's level instead of its indent, clamped at one level", () => {
    const editor = editorWith([listItem("one")]);
    const area = areaWith(editor);
    caretInBlock(editor);
    area.commands.stepParagraphIndent(1);
    expect(attrsAt(editor).ilvl).toBe(1);
    expect(attrsAt(editor).indentLeft ?? null).toBeNull();
    area.commands.stepParagraphIndent(-1);
    expect(attrsAt(editor).ilvl).toBe(0);
    const before = editor.getJSON();
    area.commands.stepParagraphIndent(-1);
    expect(editor.getJSON()).toEqual(before);
  });
});

describe("createParagraphCommands: line and paragraph spacing", () => {
  it("sets the w:line multiple and clears an exact rule that would pin the height", () => {
    const editor = editorWith([paragraph("hello", { lineRule: "exact", lineRawTwips: 360 })]);
    const area = areaWith(editor);
    caretInBlock(editor);
    area.commands.setLineSpacing(1.5);
    expect(attrsAt(editor).lineSpacing).toBe(1.5);
    expect(attrsAt(editor).lineRule ?? null).toBeNull();
    expect(attrsAt(editor).lineRawTwips ?? null).toBeNull();
    expect(area.readState(editor).lineSpacing).toBe(1.5);
  });

  it("clamps the multiple and rejects non-positive input", () => {
    const editor = editorWith([paragraph("hello")]);
    const area = areaWith(editor);
    caretInBlock(editor);
    area.commands.setLineSpacing(100);
    expect(attrsAt(editor).lineSpacing).toBe(10);
    area.commands.setLineSpacing(0.1);
    expect(attrsAt(editor).lineSpacing).toBe(0.5);
    area.commands.setLineSpacing(Number.NaN);
    area.commands.setLineSpacing(-1);
    expect(attrsAt(editor).lineSpacing).toBe(0.5);
  });

  it("clears the multiple with null", () => {
    const editor = editorWith([paragraph("hello", { lineSpacing: 2 })]);
    const area = areaWith(editor);
    caretInBlock(editor);
    area.commands.setLineSpacing(null);
    expect(attrsAt(editor).lineSpacing ?? null).toBeNull();
    expect(area.readState(editor).lineSpacing).toBeNull();
  });

  it("writes space before/after as twips and clears with null or zero", () => {
    const editor = editorWith([paragraph("hello")]);
    const area = areaWith(editor);
    caretInBlock(editor);
    area.commands.setSpaceBeforePt(12);
    area.commands.setSpaceAfterPt(6.5);
    expect(attrsAt(editor).spaceBefore).toBe(240);
    expect(attrsAt(editor).spaceAfter).toBe(130);
    expect(area.readState(editor).spaceBeforeTwips).toBe(240);
    expect(area.readState(editor).spaceAfterTwips).toBe(130);
    area.commands.setSpaceBeforePt(0);
    expect(attrsAt(editor).spaceBefore ?? null).toBeNull();
    area.commands.setSpaceAfterPt(null);
    expect(attrsAt(editor).spaceAfter ?? null).toBeNull();
  });

  it("does not rewrite a block whose spacing already matches", () => {
    const editor = editorWith([paragraph("hello", { spaceBefore: 240 })]);
    const area = areaWith(editor);
    caretInBlock(editor);
    const before = editor.getJSON();
    area.commands.setSpaceBeforePt(12);
    expect(editor.getJSON()).toEqual(before);
  });
});

describe("createParagraphCommands: styles gallery", () => {
  it("turns a paragraph into a heading through the docHeading shape", () => {
    const editor = editorWith([paragraph("hello")]);
    const area = areaWith(editor);
    caretInBlock(editor);
    area.commands.applyParagraphStyle("heading-2");
    expect(blockAt(editor).type.name).toBe("docHeading");
    expect(attrsAt(editor).level).toBe(2);
    expect(attrsAt(editor).styleId ?? null).toBeNull();
    expect(attrsAt(editor).outlineOnly).toBe(false);
    expect(area.readState(editor).paragraphStyle).toBe("heading-2");
  });

  it("does not rewrite the heading that is already active", () => {
    const editor = editorWith([heading("hello", 2)]);
    const area = areaWith(editor);
    caretInBlock(editor);
    const before = editor.getJSON();
    area.commands.applyParagraphStyle("heading-2");
    expect(editor.getJSON()).toEqual(before);
  });

  it("sets Title and Quote as direct paragraph styles", () => {
    const editor = editorWith([paragraph("hello"), paragraph("world")]);
    const area = areaWith(editor);
    caretInBlock(editor, 0);
    area.commands.applyParagraphStyle("title");
    expect(attrsAt(editor, 0).styleId).toBe("Title");
    caretInBlock(editor, 1);
    area.commands.applyParagraphStyle("quote");
    expect(attrsAt(editor, 1).styleId).toBe("Quote");
    expect(area.readState(editor).paragraphStyle).toBe("quote");
  });

  it("converts a heading back to a plain paragraph for Normal", () => {
    const editor = editorWith([heading("hello", 3, { styleId: "Heading3" })]);
    const area = areaWith(editor);
    caretInBlock(editor);
    area.commands.applyParagraphStyle("normal");
    expect(blockAt(editor).type.name).toBe("docParagraph");
    expect(attrsAt(editor).styleId ?? null).toBeNull();
    expect(area.readState(editor).paragraphStyle).toBe("normal");
  });

  it("converts a heading to Title without keeping the heading attributes", () => {
    const editor = editorWith([heading("hello", 3, { outlineOnly: true })]);
    const area = areaWith(editor);
    caretInBlock(editor);
    area.commands.applyParagraphStyle("title");
    expect(blockAt(editor).type.name).toBe("docParagraph");
    expect(attrsAt(editor).styleId).toBe("Title");
    expect(attrsAt(editor).level ?? null).toBeNull();
  });

  it("keeps a list item's numbering when a paragraph style lands on it", () => {
    const editor = editorWith([listItem("one")]);
    const area = areaWith(editor);
    caretInBlock(editor);
    area.commands.applyParagraphStyle("quote");
    expect(blockAt(editor).type.name).toBe("docListItem");
    expect(attrsAt(editor).styleId).toBe("Quote");
    expect(attrsAt(editor).kind).toBe("bullet");
    expect(attrsAt(editor).numId).toBe("new-list-1");
    expect(attrsAt(editor).ilvl).toBe(0);
  });
});

describe("createParagraphCommands: read-only handling", () => {
  it("refuses every command on a read-only editor", () => {
    const editor = editorWith([paragraph("hello"), paragraph("world")]);
    const area = areaWith(editor);
    selectAllBlocks(editor);
    const before = editor.getJSON();
    editor.setEditable(false);
    area.commands.setParagraphAlign("center");
    area.commands.stepParagraphIndent(1);
    area.commands.setLineSpacing(1.5);
    area.commands.setSpaceBeforePt(12);
    area.commands.setSpaceAfterPt(12);
    area.commands.applyParagraphStyle("heading-2");
    expect(editor.getJSON()).toEqual(before);
  });
});
