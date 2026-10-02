import { Editor, Extension } from "@tiptap/core";
import Image from "@tiptap/extension-image";
import { TextSelection, type Plugin } from "@tiptap/pm/state";
import { afterEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { createPageDocumentExtensions } from ".";

const { t } = initI18n();
let editor: Editor | undefined;
let host: HTMLElement | undefined;

afterEach(() => {
  editor?.destroy();
  host?.remove();
  editor = undefined;
  host = undefined;
});

function mount(content = "<p></p>") {
  host = document.createElement("div");
  document.body.appendChild(host);
  editor = new Editor({
    element: host,
    extensions: createPageDocumentExtensions({
      image: Image,
      assetUpload: Extension.create({ name: "testUpload" }),
      slash: { translate: t, chooseImage: vi.fn() },
    }),
    content,
  });
  editor.commands.setTextSelection(editor.state.doc.content.size - 1);
  editor.view.dom.focus();
  return editor;
}

function slashState(instance: Editor) {
  const plugin = instance.state.plugins.find((candidate) =>
    (candidate as Plugin & { key: string }).key.startsWith("pageDocumentSlash$"));
  expect(plugin).toBeDefined();
  return plugin!.getState(instance.state) as { active: boolean; query: string };
}

// ProseMirror consults handleTextInput before inserting a genuine keystroke.
function type(instance: Editor, text: string) {
  for (const char of text) {
    const { from, to } = instance.state.selection;
    const handled = instance.view.someProp("handleTextInput", (fn) =>
      fn(instance.view, from, to, char, () => instance.state.tr.insertText(char, from, to)));
    if (!handled) instance.view.dispatch(instance.state.tr.insertText(char, from, to));
  }
}

function paste(instance: Editor, text: string) {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", { value: { files: [],
    getData: (format: string) => format === "text/plain" ? text : "" } });
  instance.view.dom.dispatchEvent(event);
}

describe("page slash trigger provenance", () => {
  it.each(["/", "x /task"])("opens a deliberately typed %s", (text) => {
    const instance = mount();
    type(instance, text);
    expect(instance.getText()).toBe(text);
    expect(slashState(instance)).toMatchObject({ active: true, query: text.endsWith("task") ? "task" : "" });
  });

  it.each(["/", "x /task"])("leaves a real pasted %s literal without capturing Enter", (text) => {
    const instance = mount();
    paste(instance, text);
    expect(instance.getText()).toBe(text);
    expect(slashState(instance).active).toBe(false);
    instance.commands.enter();
    expect(instance.getJSON().content).toHaveLength(2);
    expect(instance.getJSON().content?.[0]).toMatchObject({ type: "paragraph", content: [{ type: "text", text }] });
  });

  it("does not arm a programmatic insertion with the caret after its slash", () => {
    const instance = mount("<p>x</p>");
    const tr = instance.state.tr.insertText(" /task", 2);
    tr.setSelection(TextSelection.atEnd(tr.doc));
    instance.view.dispatch(tr);
    expect(instance.getText()).toBe("x /task");
    expect(slashState(instance).active).toBe(false);
  });

  it("does not reopen a slash loaded from stored content", () => {
    const instance = mount("<p>/task</p>");
    expect(instance.state.selection.from).toBe(6);
    expect(slashState(instance).active).toBe(false);
  });

  it("does not reopen when real undo and redo restore a previously typed slash", () => {
    const instance = mount();
    type(instance, "/");
    expect(slashState(instance).active).toBe(true);
    expect(instance.commands.undo()).toBe(true);
    expect(instance.getText()).toBe("");
    expect(slashState(instance).active).toBe(false);
    expect(instance.commands.redo()).toBe(true);
    expect(instance.getText()).toBe("/");
    expect(slashState(instance).active).toBe(false);
  });

  it("keeps typing after a pasted slash inert but accepts a newly typed trigger", () => {
    const instance = mount();
    paste(instance, "/");
    type(instance, "task");
    expect(instance.getText()).toBe("/task");
    expect(slashState(instance).active).toBe(false);
    type(instance, " /");
    expect(slashState(instance).active).toBe(true);
  });

  it("keeps a pasted query active after the user deliberately typed the slash", () => {
    const instance = mount();
    type(instance, "/");
    paste(instance, "task");
    expect(slashState(instance)).toMatchObject({ active: true, query: "task" });
  });

  it("preserves the mid-word, code-block and read-only exclusions", () => {
    const instance = mount();
    type(instance, "x/");
    expect(slashState(instance).active).toBe(false);
    instance.commands.setContent("<pre><code></code></pre>");
    instance.commands.setTextSelection(1);
    type(instance, "/");
    expect(slashState(instance).active).toBe(false);
    instance.commands.setContent("<p></p>");
    instance.setEditable(false);
    type(instance, "/");
    expect(slashState(instance).active).toBe(false);
  });
});
