import { Editor, Extension } from "@tiptap/core";
import Image from "@tiptap/extension-image";
import { afterEach, describe, expect, it } from "vitest";
import { createPageDocumentExtensions } from "../../editor/extensions";

let editor: Editor | undefined;
afterEach(() => { editor?.destroy(); editor = undefined; });

function mount(content: string, selectAll = false) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  editor = new Editor({
    element: host,
    extensions: createPageDocumentExtensions({ image: Image, assetUpload: Extension.create({ name: "testUpload" }) }),
    content,
  });
  if (selectAll) editor.commands.setTextSelection({ from: 1, to: editor.state.doc.content.size - 1 });
  else editor.commands.setTextSelection(editor.state.doc.content.size - 1);
  return editor;
}

function type(instance: Editor, text: string) {
  for (const char of text) {
    const { from, to } = instance.state.selection;
    const handled = instance.view.someProp("handleTextInput", (fn) =>
      fn(instance.view, from, to, char, () => instance.state.tr.insertText(char, from, to)));
    if (!handled) instance.view.dispatch(instance.state.tr.insertText(char, from, to));
  }
}

/** Every chord the help popover and the toolbar tooltips print, proven against the real page editor. */
describe("UniNote keyboard shortcuts shown in the toolbar and help", () => {
  it.each([
    ["Mod-b", (e: Editor) => e.isActive("bold")],
    ["Mod-i", (e: Editor) => e.isActive("italic")],
    ["Mod-Shift-s", (e: Editor) => e.isActive("strike")],
    ["Mod-e", (e: Editor) => e.isActive("code")],
    ["Mod-Shift-8", (e: Editor) => e.isActive("bulletList")],
    ["Mod-Shift-7", (e: Editor) => e.isActive("orderedList")],
    ["Mod-Shift-9", (e: Editor) => e.isActive("taskList")],
    ["Mod-Shift-b", (e: Editor) => e.isActive("blockquote")],
    ["Mod-Alt-c", (e: Editor) => e.isActive("codeBlock")],
    ["Mod-Alt-1", (e: Editor) => e.isActive("heading", { level: 1 })],
    ["Mod-Alt-2", (e: Editor) => e.isActive("heading", { level: 2 })],
    ["Mod-Alt-3", (e: Editor) => e.isActive("heading", { level: 3 })],
  ])("%s", (chord, active) => {
    const instance = mount("<p>text</p>", true);
    instance.commands.keyboardShortcut(chord);
    expect(active(instance)).toBe(true);
  });

  it("Mod-Alt-0 returns a heading to text", () => {
    const instance = mount("<h2>text</h2>");
    instance.commands.keyboardShortcut("Mod-Alt-0");
    expect(instance.isActive("paragraph")).toBe(true);
  });

  it("Mod-z undoes and Mod-Shift-z redoes", () => {
    const instance = mount("<p>text</p>");
    type(instance, "x");
    instance.commands.keyboardShortcut("Mod-z");
    expect(instance.getText()).toBe("text");
    instance.commands.keyboardShortcut("Mod-Shift-z");
    expect(instance.getText()).toBe("textx");
  });

  it("has no link chord: Mod-k stays the app search", () => {
    const instance = mount("<p>text</p>", true);
    instance.commands.keyboardShortcut("Mod-k");
    expect(instance.isActive("link")).toBe(false);
  });
});

describe("UniNote typed patterns shown in the help", () => {
  it.each([
    ["# ", "heading", { level: 1 }],
    ["## ", "heading", { level: 2 }],
    ["### ", "heading", { level: 3 }],
    ["- ", "bulletList", undefined],
    ["1. ", "orderedList", undefined],
    ["[ ] ", "taskList", undefined],
    ["> ", "blockquote", undefined],
    ["``` ", "codeBlock", undefined],
    ["---", "horizontalRule", undefined],
  ])("%j at the start of an empty line makes a %s", (text, node, attrs) => {
    const instance = mount("<p></p>");
    type(instance, text);
    const found = instance.getJSON().content?.some((child) => child.type === node && (!attrs || (child.attrs as { level?: number }).level === attrs.level));
    expect(found).toBe(true);
  });
});
