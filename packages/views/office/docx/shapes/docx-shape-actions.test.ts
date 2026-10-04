// B9 (UNI-924): the editor-side shape operations against a real TipTap
// document with the vendored schema. Insert writes a docProtected/genXml node
// (the save plan turns it into an insert_xml row); the panel edits swap node
// attrs only. Ordinary refusals (read-only, no selection, engine refusal) never
// touch the document.
import { Editor, type JSONContent } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";
import type { DocxShapeKind } from "@uniwork/office-engine/docx";
import { docxExtensions } from "../docx-schema";
import { applyDocxShapeEdit, insertDocxShape, selectedDocxShape } from "./docx-shape-actions";

const editors: Editor[] = [];

function editorWith(content: JSONContent[], editable = true): Editor {
  const editor = new Editor({ extensions: docxExtensions(), content: { type: "doc", content }, editable });
  editors.push(editor);
  return editor;
}

function paragraph(text: string): JSONContent {
  return { type: "docParagraph", attrs: { docxIndex: 1 }, content: text === "" ? [] : [{ type: "text", text }] };
}

function caretAtEnd(editor: Editor): void {
  editor.commands.setTextSelection(editor.state.doc.content.size - 1);
}

interface ProtectedAttrs {
  label?: string;
  genXml?: string;
  textboxes?: Array<Record<string, unknown>>;
  imageWrap?: string | null;
  imageOffsetXEmu?: number | null;
  imageOffsetYEmu?: number | null;
}

function protectedAttrs(editor: Editor): ProtectedAttrs[] {
  const out: ProtectedAttrs[] = [];
  editor.state.doc.forEach((node) => {
    if (node.type.name === "docProtected") out.push(node.attrs as ProtectedAttrs);
  });
  return out;
}

function selectProtected(editor: Editor): void {
  let pos: number | null = null;
  editor.state.doc.descendants((node, at) => {
    if (pos === null && node.type.name === "docProtected") pos = at;
    return pos === null;
  });
  if (pos === null) throw new Error("no docProtected node to select");
  editor.commands.setNodeSelection(pos);
}

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

describe("insertDocxShape", () => {
  it("inserts a filled shape as a protected genXml node after the caret block", () => {
    const editor = editorWith([paragraph("")]);
    caretAtEnd(editor);
    expect(insertDocxShape(editor, "rect", "Hình chữ nhật")).toBe(true);
    const nodes = protectedAttrs(editor);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.label).toBe("Hình chữ nhật");
    expect(nodes[0]?.genXml).toContain('a:prstGeom prst="rect"');
    expect(nodes[0]?.genXml).toContain("<mc:Choice Requires=\"wps\">");
    expect(nodes[0]?.genXml).toContain('<wp:extent cx="1800225" cy="1076325"/>');
    expect(nodes[0]?.textboxes?.[0]).toMatchObject({
      fill: "4472C4",
      borderColor: "2F5496",
      widthPx: 189,
      heightPx: 113,
      prst: "rect",
      vAlign: "center",
      textColor: "FFFFFF",
    });
  });

  it("inserts a text box whose display carries no prst", () => {
    const editor = editorWith([paragraph("")]);
    caretAtEnd(editor);
    expect(insertDocxShape(editor, "textBox", "Hộp văn bản")).toBe(true);
    const attrs = protectedAttrs(editor)[0];
    expect(attrs?.genXml).toContain('<wps:cNvSpPr txBox="1"/>');
    expect(attrs?.textboxes?.[0]?.prst).toBeUndefined();
    expect(attrs?.textboxes?.[0]).toMatchObject({ fill: "FFFFFF", borderColor: "000000", widthPx: 189, heightPx: 113 });
  });

  it("inserts a straight line with the 12 px grab band", () => {
    const editor = editorWith([paragraph("")]);
    caretAtEnd(editor);
    expect(insertDocxShape(editor, "arrow", "Mũi tên")).toBe(true);
    const attrs = protectedAttrs(editor)[0];
    expect(attrs?.genXml).toContain('a:prstGeom prst="straightConnector1"');
    expect(attrs?.textboxes?.[0]).toMatchObject({ widthPx: 189, heightPx: 12, prst: "lineArrow", readOnly: true });
    // the display mirrors the parse, so the panel locks the arrow's height
    selectProtected(editor);
    expect(selectedDocxShape(editor)).toMatchObject({ prst: "lineArrow", straight: true, heightPx: 12 });
  });

  it("lands the insert after a selected block instead of replacing it", () => {
    const editor = editorWith([paragraph("one"), paragraph("two")]);
    editor.commands.setNodeSelection(0);
    expect(insertDocxShape(editor, "ellipse", "Oval")).toBe(true);
    const texts: string[] = [];
    editor.state.doc.forEach((node) => {
      if (node.type.name === "docParagraph") texts.push(node.textContent);
    });
    expect(texts).toEqual(["one", "two"]);
    expect(protectedAttrs(editor)).toHaveLength(1);
  });

  it("refuses a read-only document and an unknown kind without writing", () => {
    const readOnly = editorWith([paragraph("")], false);
    caretAtEnd(readOnly);
    expect(insertDocxShape(readOnly, "rect", "Hình chữ nhật")).toBe(false);
    expect(protectedAttrs(readOnly)).toHaveLength(0);

    const editor = editorWith([paragraph("")]);
    caretAtEnd(editor);
    expect(insertDocxShape(editor, "star" as DocxShapeKind, "Ngôi sao")).toBe(false);
    expect(protectedAttrs(editor)).toHaveLength(0);
  });
});

describe("selectedDocxShape and applyDocxShapeEdit", () => {
  it("reads the selected shape and applies fill, size and position edits", () => {
    const editor = editorWith([paragraph("")]);
    caretAtEnd(editor);
    insertDocxShape(editor, "rect", "Hình chữ nhật");
    selectProtected(editor);
    expect(selectedDocxShape(editor)).toMatchObject({ prst: "rect", fill: "4472C4", widthPx: 189, heightPx: 113 });

    expect(applyDocxShapeEdit(editor, { kind: "fill", color: "C00000" })).toBe(true);
    expect(applyDocxShapeEdit(editor, { kind: "outline", color: null })).toBe(true);
    expect(applyDocxShapeEdit(editor, { kind: "size", widthPx: 240, heightPx: 120 })).toBe(true);
    expect(applyDocxShapeEdit(editor, { kind: "position", wrap: "square-right", offsetXEmu: 914400, offsetYEmu: 0 })).toBe(true);

    const attrs = protectedAttrs(editor)[0];
    expect(attrs?.textboxes?.[0]).toMatchObject({ fill: "C00000", widthPx: 240, heightPx: 120 });
    expect(attrs?.textboxes?.[0]?.borderColor).toBeUndefined();
    expect(attrs?.imageWrap).toBe("square-right");
    expect(attrs?.imageOffsetXEmu).toBe(914400);
    expect(selectedDocxShape(editor)).toMatchObject({ wrap: "square-right", offsetXEmu: 914400, offsetYEmu: 0 });
  });

  it("refuses edits without a selected shape, on a read-only document and for a bad colour", () => {
    const editor = editorWith([paragraph("")]);
    caretAtEnd(editor);
    insertDocxShape(editor, "rect", "Hình chữ nhật");
    expect(selectedDocxShape(editor)).toBeNull();
    expect(applyDocxShapeEdit(editor, { kind: "fill", color: "C00000" })).toBe(false);

    selectProtected(editor);
    expect(applyDocxShapeEdit(editor, { kind: "fill", color: "red" })).toBe(false);
    expect(protectedAttrs(editor)[0]?.textboxes?.[0]?.fill).toBe("4472C4");

    const readOnly = editorWith([paragraph("")], false);
    expect(applyDocxShapeEdit(readOnly, { kind: "fill", color: null })).toBe(false);
  });
});
