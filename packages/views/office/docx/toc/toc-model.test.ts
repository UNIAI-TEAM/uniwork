// B7 (UNI-924): the pure TOC/caption model — heading extraction, the TOC node
// run scan (inserted and parsed shapes) and the caption/citation helpers, all
// against real ProseMirror documents so the vendored schema validates them.
import { Editor, type JSONContent } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";
import { docxExtensions } from "../docx-schema";
import {
  countDocxCaptions,
  docxCaptionContent,
  docxCitationText,
  findDocxTocRange,
  readDocxTocHeadings,
  tocNodesForLines,
} from "./toc-model";

const editors: Editor[] = [];

function editorWith(content: JSONContent[]): Editor {
  const editor = new Editor({ extensions: docxExtensions(), content: { type: "doc", content } });
  editors.push(editor);
  return editor;
}

function heading(text: string, level: number, attrs: Record<string, unknown> = {}): JSONContent {
  return { type: "docHeading", attrs: { docxIndex: 0, level, ...attrs }, content: text === "" ? [] : [{ type: "text", text }] };
}

function paragraph(text: string): JSONContent {
  return { type: "docParagraph", attrs: { docxIndex: 1 }, content: text === "" ? [] : [{ type: "text", text }] };
}

function tocEntryNode(left: string, level: number): JSONContent {
  return {
    type: "docProtected",
    attrs: {
      docxIndex: 3,
      blockType: "passthrough",
      label: "Auto TOC (updates when opened in Word)",
      fieldDisplay: { kind: "tocLine", left, right: "1", level },
    },
  };
}

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

describe("readDocxTocHeadings", () => {
  it("collects headings in document order and drops the levels above the depth", () => {
    const editor = editorWith([
      heading("One", 1),
      paragraph("body"),
      heading("Two", 2),
      heading("Deep", 4),
      heading("Three", 3),
    ]);
    expect(readDocxTocHeadings(editor.state.doc, 3)).toEqual([
      { level: 1, text: "One" },
      { level: 2, text: "Two" },
      { level: 3, text: "Three" },
    ]);
    expect(readDocxTocHeadings(editor.state.doc, 1)).toEqual([{ level: 1, text: "One" }]);
  });

  it("uses the Word _Toc hidden bookmark as the hyperlink anchor", () => {
    const editor = editorWith([heading("Intro", 1, { hiddenBookmarks: ["_Toc100"], bookmarks: ["user"] })]);
    expect(readDocxTocHeadings(editor.state.doc, 3)).toEqual([{ level: 1, text: "Intro", anchor: "_Toc100" }]);
  });

  it("skips empty headings and reads nothing without a document", () => {
    const editor = editorWith([heading("", 1), heading("Kept", 2)]);
    expect(readDocxTocHeadings(editor.state.doc, 3)).toEqual([{ level: 2, text: "Kept" }]);
    expect(readDocxTocHeadings(null, 3)).toEqual([]);
  });
});

describe("findDocxTocRange", () => {
  it("finds the contiguous entry run and absorbs the trailing field-end paragraph", () => {
    const editor = editorWith([
      paragraph("before"),
      tocEntryNode("One", 1),
      tocEntryNode("Two", 2),
      { type: "docProtected", attrs: { docxIndex: 4, label: "Field end marker", previewText: "" } },
      paragraph("after"),
    ]);
    const range = findDocxTocRange(editor.state.doc);
    const before = editor.state.doc.child(0);
    const from = before.nodeSize;
    const to = from + editor.state.doc.child(1).nodeSize + editor.state.doc.child(2).nodeSize + editor.state.doc.child(3).nodeSize;
    expect(range).toEqual({ from, to, childIndex: 1 });
  });

  it("returns null without a TOC node and stops at a non-TOC node between runs", () => {
    expect(findDocxTocRange(editorWith([paragraph("only")]).state.doc)).toBeNull();
    const editor = editorWith([tocEntryNode("One", 1), paragraph("gap"), tocEntryNode("Late", 1)]);
    const range = findDocxTocRange(editor.state.doc);
    expect(range).not.toBeNull();
    // the first run is the only one: the range must end before the paragraph
    const firstNode = editor.state.doc.child(0);
    expect(range?.to).toBe(firstNode.nodeSize);
  });
});

describe("tocNodesForLines", () => {
  it("builds docProtected nodes carrying fieldDisplay and the field XML", () => {
    const nodes = tocNodesForLines([
      { xml: "<w:p><w:fldChar w:fldCharType=\"begin\" w:dirty=\"true\"/></w:p>", level: 1, left: "One", right: "3", anchor: "_Toc1" },
      { xml: "<w:p/>", level: 2, left: "Two" },
    ]);
    expect(nodes).toHaveLength(2);
    expect(nodes[0]?.attrs).toMatchObject({
      docxIndex: null,
      blockType: "passthrough",
      label: "Auto TOC (updates when opened in Word)",
      fieldDisplay: { kind: "tocLine", left: "One", right: "3", level: 1, anchor: "_Toc1" },
    });
    expect(String(nodes[0]?.attrs?.genXml)).toContain('w:fldCharType="begin" w:dirty="true"');
    expect(nodes[1]?.attrs?.fieldDisplay).toMatchObject({ left: "Two", right: "", level: 2 });
  });
});

describe("caption helpers", () => {
  it("counts only the inline fields of the requested label", () => {
    const editor = editorWith([
      {
        type: "docParagraph",
        attrs: { docxIndex: 1 },
        content: [
          { type: "text", text: "Figure " },
          {
            type: "text",
            text: "1",
            marks: [{ type: "instrField", attrs: { instr: " SEQ Figure \\* ARABIC ", dirty: true } }],
          },
        ],
      },
      {
        type: "docParagraph",
        attrs: { docxIndex: 2 },
        content: [
          { type: "text", text: "Table " },
          {
            type: "text",
            text: "1",
            marks: [{ type: "instrField", attrs: { instr: " SEQ Table \\* ARABIC ", dirty: true } }],
          },
        ],
      },
    ]);
    expect(countDocxCaptions(editor.state.doc, "Figure")).toBe(1);
    expect(countDocxCaptions(editor.state.doc, "Table")).toBe(1);
    expect(countDocxCaptions(editor.state.doc, "Equation")).toBe(0);
  });

  it("builds caption content whose number run carries the SEQ instruction", () => {
    expect(docxCaptionContent("Figure", 2, "Architecture")).toEqual([
      { type: "text", text: "Figure " },
      {
        type: "text",
        text: "2",
        marks: [
          {
            type: "instrField",
            attrs: { instr: " SEQ Figure \\* ARABIC ", beginXml: null, dirty: true, fieldId: null, fieldPart: null },
          },
        ],
      },
      { type: "text", text: " Architecture" },
    ]);
  });

  it("formats the bracketed reference from the parts it has", () => {
    expect(docxCitationText("Nguyễn", "2024")).toBe("(Nguyễn, 2024)");
    expect(docxCitationText("Nguyễn", "")).toBe("(Nguyễn)");
    expect(docxCitationText("", "2024")).toBe("(2024)");
    expect(docxCitationText(" ", " ")).toBeNull();
  });
});
