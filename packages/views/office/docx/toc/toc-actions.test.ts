// B7 (UNI-924): the editor-side TOC/caption/citation operations against a real
// TipTap document with the vendored schema. Outcomes are typed; ordinary
// refusals (no headings, no TOC, read-only) never touch the document.
import { Editor, type JSONContent } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";
import { docxExtensions } from "../docx-schema";
import { docxTocPresent, insertDocxCaption, insertDocxCitation, insertDocxToc, readTocHeadings, updateDocxToc } from "./toc-actions";

const editors: Editor[] = [];

function editorWith(content: JSONContent[], editable = true): Editor {
  const editor = new Editor({ extensions: docxExtensions(), content: { type: "doc", content }, editable });
  editors.push(editor);
  return editor;
}

function heading(text: string, level: number, attrs: Record<string, unknown> = {}): JSONContent {
  return { type: "docHeading", attrs: { docxIndex: 0, level, ...attrs }, content: [{ type: "text", text }] };
}

function paragraph(text: string): JSONContent {
  return { type: "docParagraph", attrs: { docxIndex: 1 }, content: text === "" ? [] : [{ type: "text", text }] };
}

/** Put the caret on the last position of the document (append point). */
function caretAtEnd(editor: Editor): void {
  editor.commands.setTextSelection(editor.state.doc.content.size - 1);
}

interface TocNodeAttrs {
  fieldDisplay?: { kind?: string; left?: string; level?: number };
  genXml?: string;
}

function tocNodesOf(editor: Editor): TocNodeAttrs[] {
  const out: TocNodeAttrs[] = [];
  editor.state.doc.forEach((node) => {
    if (node.type.name !== "docProtected") return;
    const attrs = node.attrs as TocNodeAttrs;
    if (attrs.fieldDisplay?.kind === "tocLine") out.push(attrs);
  });
  return out;
}

const OPTIONS = { maxLevel: 3, pageNumbers: true, hyperlinks: true };

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

describe("insertDocxToc", () => {
  it("writes one protected TOC node per heading entry at the caret", () => {
    const editor = editorWith([heading("One", 1), heading("Two", 2), paragraph("")]);
    caretAtEnd(editor);
    expect(insertDocxToc(editor, OPTIONS)).toEqual({ outcome: "inserted", entries: 2 });
    const nodes = tocNodesOf(editor);
    expect(nodes.map((node) => node.fieldDisplay?.left)).toEqual(["One", "Two"]);
    expect(nodes.map((node) => node.fieldDisplay?.level)).toEqual([1, 2]);
    // the first line carries the field begin, the last the end
    expect(nodes[0]?.genXml).toContain('w:fldCharType="begin" w:dirty="true"');
    expect(nodes[0]?.genXml).toContain('\\o "1-3"');
    expect(nodes[1]?.genXml).toContain('w:fldCharType="end"');
    expect(nodes[1]?.genXml).not.toContain('fldCharType="begin"');
    expect(docxTocPresent(editor)).toBe(true);
  });

  it("reports empty without headings and writes nothing", () => {
    const editor = editorWith([paragraph("")]);
    caretAtEnd(editor);
    expect(insertDocxToc(editor, OPTIONS)).toEqual({ outcome: "empty", entries: 0 });
    expect(tocNodesOf(editor)).toEqual([]);
  });

  it("reports empty when every heading is above the requested depth", () => {
    const editor = editorWith([heading("Deep", 4)]);
    caretAtEnd(editor);
    expect(insertDocxToc(editor, { ...OPTIONS, maxLevel: 2 })).toEqual({ outcome: "empty", entries: 0 });
  });

  it("refuses a read-only document", () => {
    const editor = editorWith([heading("One", 1)], false);
    expect(insertDocxToc(editor, OPTIONS)).toEqual({ outcome: "read_only", entries: 0 });
    expect(tocNodesOf(editor)).toEqual([]);
  });
});

describe("updateDocxToc", () => {
  it("replaces the whole run with the freshly generated entries", () => {
    const editor = editorWith([heading("Old", 1), heading("New", 2), paragraph("")]);
    caretAtEnd(editor);
    insertDocxToc(editor, OPTIONS);
    expect(tocNodesOf(editor).map((node) => node.fieldDisplay?.left)).toEqual(["Old", "New"]);
    const result = updateDocxToc(editor, { ...OPTIONS, maxLevel: 1 });
    expect(result).toEqual({ outcome: "updated", entries: 1 });
    expect(tocNodesOf(editor).map((node) => node.fieldDisplay?.left)).toEqual(["Old"]);
    // exactly one begin/end pair survives the replacement
    const xml = tocNodesOf(editor).map((node) => node.genXml ?? "").join("");
    expect(xml.match(/fldCharType="begin"/g)).toHaveLength(1);
    expect(xml.match(/fldCharType="end"/g)).toHaveLength(1);
  });

  it("reports missing without a TOC and empty without headings", () => {
    const noToc = editorWith([heading("One", 1)]);
    expect(updateDocxToc(noToc, OPTIONS)).toEqual({ outcome: "missing", entries: 0 });
    const withToc = editorWith([
      {
        type: "docProtected",
        attrs: {
          docxIndex: 2,
          label: "Auto TOC (updates when opened in Word)",
          fieldDisplay: { kind: "tocLine", left: "x", level: 1 },
        },
      },
      paragraph(""),
    ]);
    expect(updateDocxToc(withToc, OPTIONS)).toEqual({ outcome: "empty", entries: 0 });
  });

  it("refuses a read-only document before touching the run", () => {
    const editor = editorWith([heading("One", 1)]);
    expect(updateDocxToc(editor, OPTIONS)).toEqual({ outcome: "read_only", entries: 0 });
  });

  const parsedRun = (endLabel: string): JSONContent[] => [
    heading("One", 1),
    {
      type: "docProtected",
      attrs: { docxIndex: 2, blockType: "passthrough", label: "Auto TOC (updates when opened in Word)", previewText: "" },
    },
    {
      type: "docProtected",
      attrs: {
        docxIndex: 3,
        blockType: "passthrough",
        label: "Auto TOC (updates when opened in Word)",
        previewText: "",
        fieldDisplay: { kind: "tocLine", left: "One", right: "1", level: 1 },
      },
    },
    { type: "docProtected", attrs: { docxIndex: 4, blockType: "passthrough", label: endLabel, previewText: "" } },
    paragraph("after"),
  ];

  it("re-emits the page break a Word field-end paragraph carried", () => {
    const editor = editorWith(parsedRun("Field end marker + page break"));
    expect(updateDocxToc(editor, OPTIONS)).toEqual({ outcome: "updated", entries: 1 });
    expect(editor.state.doc.childCount).toBe(4);
    const kept = editor.state.doc.child(2);
    expect(kept.type.name).toBe("docProtected");
    expect(String(kept.attrs.label)).toBe("Field end marker + page break");
    expect(String(kept.attrs.genXml)).toContain('w:br w:type="page"');
  });

  it("adds no page break when the field-end paragraph had none", () => {
    const editor = editorWith(parsedRun("Field end marker"));
    expect(updateDocxToc(editor, OPTIONS)).toEqual({ outcome: "updated", entries: 1 });
    expect(editor.state.doc.childCount).toBe(3);
    const last = editor.state.doc.child(editor.state.doc.childCount - 1);
    expect(last.type.name).toBe("docParagraph");
  });
});

describe("captions and citations", () => {
  it("inserts a caption paragraph whose number run carries the SEQ field", () => {
    const editor = editorWith([paragraph("")]);
    caretAtEnd(editor);
    expect(insertDocxCaption(editor, "Hình", "Mô tả")).toBe(true);
    const captions: JSONContent[] = [];
    editor.state.doc.forEach((node) => {
      if (node.textContent.startsWith("Hình 1")) captions.push(node.toJSON() as JSONContent);
    });
    expect(captions).toHaveLength(1);
    expect(captions[0]?.content?.[1]?.marks?.[0]).toMatchObject({
      type: "instrField",
      attrs: { instr: ' SEQ "Hình" \\* ARABIC ', dirty: true },
    });
  });

  it("numbers the caption from the document's existing fields", () => {
    const editor = editorWith([
      {
        type: "docParagraph",
        attrs: { docxIndex: 1 },
        content: [
          { type: "text", text: "Hình " },
          { type: "text", text: "1", marks: [{ type: "instrField", attrs: { instr: " SEQ Hình \\* ARABIC ", dirty: true } }] },
        ],
      },
    ]);
    caretAtEnd(editor);
    insertDocxCaption(editor, "Hình", "Hai");
    expect(editor.state.doc.textContent).toContain("Hình 2 Hai");
  });

  it("refuses captions and citations on a read-only document", () => {
    const editor = editorWith([paragraph("body")], false);
    expect(insertDocxCaption(editor, "Hình", "x")).toBe(false);
    expect(insertDocxCitation(editor, "Nguyễn", "2024")).toBe(false);
  });

  it("inserts the bracketed citation text and refuses an empty pair", () => {
    const editor = editorWith([paragraph("")]);
    caretAtEnd(editor);
    expect(insertDocxCitation(editor, " ", " ")).toBe(false);
    expect(insertDocxCitation(editor, "Nguyễn", "2024")).toBe(true);
    expect(editor.state.doc.textContent).toContain("(Nguyễn, 2024)");
  });
});

describe("readTocHeadings", () => {
  it("reads the depth-limited heading list", () => {
    const editor = editorWith([heading("One", 1), heading("Two", 2)]);
    expect(readTocHeadings(editor, 1)).toEqual([{ level: 1, text: "One" }]);
    expect(readTocHeadings(null, 3)).toEqual([]);
  });
});
