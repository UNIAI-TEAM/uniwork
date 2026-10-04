import { Editor, type JSONContent } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";
import { docxExtensions } from "../docx-schema";
import { createCompareCommands } from "./compare";
import { createDocxCommandRuntime } from "./index";

const editors: Editor[] = [];

function editorWith(content: JSONContent[]): Editor {
  const editor = new Editor({ extensions: docxExtensions(), content: { type: "doc", content } });
  editors.push(editor);
  return editor;
}

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

describe("createCompareCommands", () => {
  it("reports not ready and no texts before a document opens", () => {
    const area = createCompareCommands({ getEditor: () => null });
    expect(area.readState(null)).toEqual({ docxCompareReady: false });
    expect(area.commands.compareDocumentTexts()).toEqual([]);
  });

  it("reads the live document's block texts in order without touching the document", () => {
    const editor = editorWith([
      { type: "docHeading", attrs: { docxIndex: 0, level: 1 }, content: [{ type: "text", text: "Title" }] },
      { type: "docParagraph", attrs: { docxIndex: 1 }, content: [{ type: "text", text: "Body" }] },
    ]);
    const before = editor.getJSON();
    const area = createCompareCommands({ getEditor: () => editor });

    expect(area.readState(editor)).toEqual({ docxCompareReady: true });
    expect(area.commands.compareDocumentTexts()).toEqual(["Title", "Body"]);
    expect(editor.getJSON()).toEqual(before);
  });

  it("is composed into the runtime by commands/index.ts", () => {
    const editor = editorWith([{ type: "docParagraph", attrs: { docxIndex: 0 }, content: [{ type: "text", text: "Alpha" }] }]);
    const runtime = createDocxCommandRuntime(() => editor);

    expect(runtime.compareDocumentTexts()).toEqual(["Alpha"]);
    expect(runtime.getState().docxCompareReady).toBe(true);
  });
});
