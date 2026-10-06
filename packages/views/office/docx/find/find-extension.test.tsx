import { Editor, type JSONContent } from "@tiptap/core";
import { Document } from "@tiptap/extension-document";
import { Paragraph } from "@tiptap/extension-paragraph";
import { Text } from "@tiptap/extension-text";
import { afterEach, describe, expect, it, vi } from "vitest";
import { docxFindPluginKey } from "./find-decoration";
import { DocxFindExtension, getDocxFindEditor, subscribeDocxFindEditor } from "./find-extension";
import { closeDocxFind, isDocxFindOpen, openDocxFind } from "./find-store";

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
  closeDocxFind();
});

describe("DocxFindExtension", () => {
  it("publishes the live editor and mounts the highlight plugin", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeDocxFindEditor(listener);
    const editor = editorWith("alpha");
    expect(getDocxFindEditor()).toBe(editor);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(docxFindPluginKey.getState(editor.state)).toBeDefined();
    unsubscribe();
  });

  it("clears the store when the editor is destroyed", () => {
    const editor = editorWith("alpha");
    expect(getDocxFindEditor()).toBe(editor);
    editor.destroy();
    editors.splice(editors.indexOf(editor), 1);
    expect(getDocxFindEditor()).toBeNull();
  });

  it("closes the find panel when the editor is destroyed", () => {
    const editor = editorWith("alpha");
    openDocxFind();
    expect(isDocxFindOpen()).toBe(true);

    editor.destroy();
    editors.splice(editors.indexOf(editor), 1);
    expect(isDocxFindOpen()).toBe(false);
  });
});
