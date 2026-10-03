import { Editor, type JSONContent } from "@tiptap/core";
import type { Transaction } from "@tiptap/pm/state";
import { afterEach, describe, expect, it } from "vitest";
import { docxExtensions } from "../docx-schema";
import {
  applyDocxPasteMode,
  changedRangeOf,
  pastePayloadFromDataTransfer,
  plainTextContent,
  readPastePayload,
  stripRunFormatting,
} from "./paste-options";

const editors: Editor[] = [];

function createEditor(content: JSONContent, editable = true): Editor {
  const editor = new Editor({ extensions: docxExtensions(), content, editable });
  editors.push(editor);
  return editor;
}

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

const markedDocument: JSONContent = {
  type: "doc",
  content: [
    {
      type: "docParagraph",
      content: [
        { type: "text", text: "plain" },
        { type: "text", text: "styled", marks: [{ type: "bold" }, { type: "docTextStyle", attrs: { color: "FF0000" } }] },
      ],
    },
  ],
};

function textMarks(editor: Editor, needle: string): string[] {
  const marks: string[] = [];
  editor.state.doc.descendants((node) => {
    if (node.isText && node.text === needle) marks.push(...node.marks.map((mark) => mark.type.name));
    return true;
  });
  return marks;
}

const documentText = (editor: Editor) => editor.state.doc.textBetween(0, editor.state.doc.content.size, "\n");

describe("readPastePayload", () => {
  it("keeps prose payloads and refuses an empty or image-only clipboard", () => {
    expect(readPastePayload({ html: "<p>Hello</p>", text: "Hello" })).toEqual({ html: "<p>Hello</p>", text: "Hello" });
    expect(readPastePayload({ html: "", text: "plain" })).toEqual({ html: "", text: "plain" });
    expect(readPastePayload({ html: "<p>Hello</p>", text: "" })).toEqual({ html: "<p>Hello</p>", text: "" });
    expect(readPastePayload({ html: "", text: "   " })).toBeNull();
    expect(readPastePayload({ html: "<img src=\"x\">", text: "" })).toBeNull();
    expect(readPastePayload(null)).toBeNull();
  });

  it("reads a DataTransfer through getData", () => {
    const data = {
      getData: (type: string) => (type === "text/html" ? "<p>Hi</p>" : "Hi"),
    };
    expect(pastePayloadFromDataTransfer(data)).toEqual({ html: "<p>Hi</p>", text: "Hi" });
    expect(pastePayloadFromDataTransfer(null)).toBeNull();
  });
});

describe("plainTextContent", () => {
  it("builds one paragraph per line and keeps markup characters literal", () => {
    expect(plainTextContent("one\ntwo")).toEqual([
      { type: "docParagraph", content: [{ type: "text", text: "one" }] },
      { type: "docParagraph", content: [{ type: "text", text: "two" }] },
    ]);
    expect(plainTextContent("<b>not html</b>")).toEqual([
      { type: "docParagraph", content: [{ type: "text", text: "<b>not html</b>" }] },
    ]);
    expect(plainTextContent("")).toEqual([{ type: "docParagraph" }]);
  });
});

describe("changedRangeOf", () => {
  it("maps the steps of an insert to the final document range", () => {
    const editor = createEditor({ type: "doc", content: [{ type: "docParagraph", content: [{ type: "text", text: "Hello" }] }] });
    const transactions: Transaction[] = [];
    editor.on("transaction", ({ transaction }) => transactions.push(transaction));
    editor.chain().insertContentAt({ from: 3, to: 3 }, "XY").run();

    const last = transactions.at(-1);
    expect(last).toBeDefined();
    const range = changedRangeOf(last as Transaction);
    expect(range).not.toBeNull();
    expect(editor.state.doc.textBetween(range?.from ?? 0, range?.to ?? 0)).toBe("XY");
  });

  it("returns null when a transaction touched nothing", () => {
    const editor = createEditor({ type: "doc", content: [{ type: "docParagraph", content: [{ type: "text", text: "Hello" }] }] });
    const transactions: Transaction[] = [];
    editor.on("transaction", ({ transaction }) => transactions.push(transaction));
    editor.commands.setTextSelection(3);

    const last = transactions.at(-1);
    expect(last?.docChanged).toBe(false);
    expect(changedRangeOf(last as Transaction)).toBeNull();
  });
});

describe("stripRunFormatting", () => {
  it("drops the source run style and keeps emphasis marks", () => {
    const editor = createEditor(markedDocument);
    const slice = editor.state.doc.slice(6, 12);
    const names: string[][] = [];
    stripRunFormatting(slice.content, editor.state.schema).forEach((node) => {
      if (node.isText) names.push(node.marks.map((mark) => mark.type.name));
    });
    expect(names).toEqual([["bold"]]);
  });

  it("leaves table subtrees untouched", () => {
    const editor = createEditor({
      type: "doc",
      content: [
        {
          type: "docTable",
          content: [
            {
              type: "docTableRow",
              content: [
                {
                  type: "docTableCell",
                  content: [
                    {
                      type: "docParagraph",
                      content: [
                        { type: "text", text: "cell", marks: [{ type: "docTextStyle", attrs: { color: "FF0000" } }] },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
    const slice = editor.state.doc.slice(0, editor.state.doc.content.size);
    const mapped = stripRunFormatting(slice.content, editor.state.schema);
    const marks: string[] = [];
    mapped.forEach((node) => {
      node.descendants((child) => {
        if (child.isText) marks.push(...child.marks.map((mark) => mark.type.name));
        return true;
      });
    });
    expect(marks).toContain("docTextStyle");
  });
});

describe("applyDocxPasteMode", () => {
  it("keeps the paste for source mode", () => {
    const editor = createEditor(markedDocument);
    expect(applyDocxPasteMode(editor, { from: 6, to: 12 }, "source")).toBe(true);
    expect(documentText(editor)).toBe("plainstyled");
    expect(textMarks(editor, "styled")).toEqual(["bold", "docTextStyle"]);
  });

  it("strips every mark for text mode", () => {
    const editor = createEditor(markedDocument);
    expect(applyDocxPasteMode(editor, { from: 6, to: 12 }, "text")).toBe(true);
    expect(documentText(editor)).toBe("plainstyled");
    expect(textMarks(editor, "styled")).toEqual([]);
  });

  it("keeps emphasis but drops the source run style for merge mode", () => {
    const editor = createEditor(markedDocument);
    expect(applyDocxPasteMode(editor, { from: 6, to: 12 }, "merge")).toBe(true);
    expect(documentText(editor)).toBe("plainstyled");
    expect(textMarks(editor, "styled")).toEqual(["bold"]);
  });

  it("replaces a multi-paragraph range with plain paragraphs", () => {
    const editor = createEditor({
      type: "doc",
      content: [
        { type: "docParagraph", content: [{ type: "text", text: "one" }] },
        { type: "docParagraph", content: [{ type: "text", text: "two" }] },
      ],
    });
    const from = 1;
    const to = editor.state.doc.content.size - 1;
    expect(applyDocxPasteMode(editor, { from, to }, "text")).toBe(true);
    expect(documentText(editor)).toBe("one\ntwo");
    expect(editor.state.doc.childCount).toBe(2);
  });

  it("refuses a read-only document and clamps an out-of-range span", () => {
    const readOnly = createEditor(markedDocument, false);
    expect(applyDocxPasteMode(readOnly, { from: 6, to: 12 }, "text")).toBe(false);
    expect(documentText(readOnly)).toBe("plainstyled");

    const editor = createEditor(markedDocument);
    expect(applyDocxPasteMode(editor, { from: -5, to: 5000 }, "text")).toBe(true);
    expect(documentText(editor)).toBe("plainstyled");
  });
});
