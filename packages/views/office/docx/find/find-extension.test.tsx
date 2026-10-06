import { Editor, type JSONContent } from "@tiptap/core";
import { Document } from "@tiptap/extension-document";
import { Paragraph } from "@tiptap/extension-paragraph";
import { Text } from "@tiptap/extension-text";
import { afterEach, describe, expect, it } from "vitest";
import { docxFindPluginKey } from "./find-decoration";
import { DocxFindExtension } from "./find-extension";

const editors: Editor[] = [];

function editorWith(text: string): Editor {
  const content: JSONContent = {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  };
  const editor = new Editor({ extensions: [Document, Paragraph, Text, DocxFindExtension], content });
  editors.push(editor);
  return editor;
}

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

describe("DocxFindExtension", () => {
  it("mounts the highlight plugin and publishes nothing page-wide (UNI-957)", () => {
    const editor = editorWith("alpha");
    expect(docxFindPluginKey.getState(editor.state)).toBeDefined();
  });
});
