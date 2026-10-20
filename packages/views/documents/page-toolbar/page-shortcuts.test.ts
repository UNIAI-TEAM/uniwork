import { Editor, Extension } from "@tiptap/core";
import Image from "@tiptap/extension-image";
import { afterEach, describe, expect, it } from "vitest";
import {
  configureShortcutPlatform,
  createShortcutChord,
  DOCUMENT_EDITOR_SCOPE,
  DOCUMENT_EDITOR_SCOPE_ATTRIBUTE,
  formatShortcut,
  getShortcutPlatform,
  type ShortcutChord,
} from "@uniwork/core/shortcuts";
import { createPageDocumentExtensions } from "../../editor/extensions";
import { PAGE_LINK_REQUEST_EVENT, PAGE_SAVE_REQUEST_EVENT } from "../../editor/extensions/page-events";
import {
  PAGE_SHORTCUTS,
  pageShortcutChords,
  type PageShortcutId,
} from "../../editor/extensions/page-shortcuts";

let editor: Editor | undefined;
afterEach(() => {
  editor?.destroy();
  editor = undefined;
  configureShortcutPlatform(null);
});

function mount(content: string, selectAll = false) {
  editor?.destroy();
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

/** A real keydown on the editor DOM, through the same handlers a keystroke reaches. */
function press(instance: Editor, chord: ShortcutChord, init: KeyboardEventInit = {}): { prevented: boolean } {
  const mac = getShortcutPlatform() === "macos";
  const key = chord.key === "Space" ? " " : chord.modifiers.shift ? chord.key.toUpperCase() : chord.key.toLowerCase();
  const event = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
    metaKey: mac && chord.modifiers.primary,
    ctrlKey: !mac && chord.modifiers.primary,
    shiftKey: chord.modifiers.shift,
    altKey: chord.modifiers.alt,
    ...init,
  });
  return { prevented: !instance.view.dom.dispatchEvent(event) };
}

const mod = (key: string, shift = false) => createShortcutChord(key, { primary: true, shift });

/** What each shortcut does to the editor, so every key in the table is proven against the real page editor. */
const EFFECTS: Record<PageShortcutId, (e: Editor) => boolean> = {
  undo: (e) => e.getText() === "text",
  redo: (e) => e.getText() === "textx",
  bold: (e) => e.isActive("bold"),
  italic: (e) => e.isActive("italic"),
  underline: (e) => e.isActive("underline"),
  strike: (e) => e.isActive("strike"),
  code: (e) => e.isActive("code"),
  link: () => false,
  clearFormatting: (e) => ["bold", "italic", "underline", "strike", "code"].every((mark) => !e.isActive(mark)),
  save: () => false,
  bulletList: (e) => e.isActive("bulletList"),
  orderedList: (e) => e.isActive("orderedList"),
  taskList: (e) => e.isActive("taskList"),
  blockquote: (e) => e.isActive("blockquote"),
  codeBlock: (e) => e.isActive("codeBlock"),
  paragraph: (e) => e.isActive("paragraph"),
  heading1: (e) => e.isActive("heading", { level: 1 }),
  heading2: (e) => e.isActive("heading", { level: 2 }),
  heading3: (e) => e.isActive("heading", { level: 3 }),
};

/** Every key the help popover and the toolbar tooltips print comes from this table. */
describe("UniNote keyboard shortcuts shown in the toolbar and help", () => {
  const ids = Object.keys(PAGE_SHORTCUTS) as PageShortcutId[];
  const rows = ids.flatMap((id) => PAGE_SHORTCUTS[id].map((key) => ({ id, key })));

  it("fires every Tiptap key in the table", () => {
    for (const { id, key } of rows) {
      if (!key.pm) continue;
      const instance = mount("<p>text</p>", true);
      if (id === "undo" || id === "redo") {
        instance.commands.setTextSelection(instance.state.doc.content.size - 1);
        type(instance, "x");
        if (id === "redo") instance.commands.undo();
      } else if (id === "paragraph") {
        instance.commands.setHeading({ level: 2 });
      }
      instance.commands.keyboardShortcut(key.pm);
      expect(EFFECTS[id](instance), `${id} ${key.pm}`).toBe(true);
    }
  });

  it.each(["windows", "macos"] as const)("%s: every key the extension owns fires by a real keydown, only where it applies", (platform) => {
    configureShortcutPlatform(platform);
    for (const { id, key } of rows) {
      if (key.pm || id === "save" || id === "link") continue;
      const instance = mount("<p>text</p>", true);
      if (id === "clearFormatting") instance.chain().setBold().setItalic().setUnderline().setCode().run();
      const applies = !key.platform || (key.platform === "mac") === (platform === "macos");
      expect(press(instance, key.chord).prevented, `${id} on ${platform}`).toBe(applies);
      expect(EFFECTS[id](instance), `${id} on ${platform}`).toBe(applies);
    }
  });

  it("prints Word's key first: Ctrl+Y redo, Ctrl+Shift+L bullets, Cmd+Shift+X strikethrough on Mac", () => {
    const shown = (id: PageShortcutId, platform: "windows" | "macos" | "linux") =>
      pageShortcutChords(id, platform).map((chord) => formatShortcut(chord, platform));
    expect(shown("redo", "windows")).toEqual(["Ctrl+Y", "Ctrl+Shift+Z"]);
    expect(shown("redo", "macos")).toEqual(["⌘Y", "⌘⇧Z"]);
    expect(shown("bulletList", "windows")).toEqual(["Ctrl+Shift+L", "Ctrl+Shift+8"]);
    expect(shown("strike", "windows")).toEqual(["Ctrl+Shift+S"]);
    expect(shown("strike", "macos")).toEqual(["⌘⇧X", "⌘⇧S"]);
    expect(shown("link", "windows")).toEqual(["Ctrl+K"]);
    expect(shown("link", "macos")).toEqual(["⌘K"]);
    expect(shown("save", "macos")).toEqual(["⌘S"]);
  });

  it("has Ctrl+Space clear formatting on Windows and Linux and none on Mac, where Control+Space switches the input source", () => {
    expect(pageShortcutChords("clearFormatting", "windows").map((chord) => formatShortcut(chord, "windows"))).toEqual(["Ctrl+Space"]);
    expect(pageShortcutChords("clearFormatting", "linux")).toHaveLength(1);
    expect(pageShortcutChords("clearFormatting", "macos")).toEqual([]);
  });

  it("keeps clear formatting from stripping a link", () => {
    configureShortcutPlatform("windows");
    const instance = mount('<p><a href="https://example.com"><strong>text</strong></a></p>', true);
    expect(instance.isActive("link")).toBe(true);
    press(instance, mod("Space"));
    expect(instance.isActive("link")).toBe(true);
    expect(instance.isActive("bold")).toBe(false);
  });

  it("keeps the old redo and bullet keys as secondary keys", () => {
    const redo = mount("<p>text</p>");
    type(redo, "x");
    redo.commands.undo();
    redo.commands.keyboardShortcut("Mod-Shift-z");
    expect(redo.getText()).toBe("textx");
    const list = mount("<p>text</p>", true);
    list.commands.keyboardShortcut("Mod-Shift-8");
    expect(list.isActive("bulletList")).toBe(true);
  });

  it("marks the editor DOM as a document-editor scope", () => {
    const instance = mount("<p>text</p>");
    expect(instance.view.dom.getAttribute(DOCUMENT_EDITOR_SCOPE_ATTRIBUTE)).toBe(DOCUMENT_EDITOR_SCOPE);
  });
});

describe("Ctrl/Cmd+S and Ctrl/Cmd+K in the page editor", () => {
  function listen(instance: Editor) {
    const events: string[] = [];
    const host = instance.view.dom.parentElement!;
    host.addEventListener(PAGE_SAVE_REQUEST_EVENT, () => events.push("save"));
    host.addEventListener(PAGE_LINK_REQUEST_EVENT, () => events.push("link"));
    return events;
  }
  const save = mod("S");
  const link = mod("K");

  it.each(["windows", "macos"] as const)("%s: Save is prevented and asks the view to flush once", (platform) => {
    configureShortcutPlatform(platform);
    const instance = mount("<p>text</p>");
    const events = listen(instance);
    expect(press(instance, save).prevented).toBe(true);
    expect(events).toEqual(["save"]);
  });

  it.each(["windows", "macos"] as const)("%s: Link asks the toolbar to open its popover, so the app search never sees it", (platform) => {
    configureShortcutPlatform(platform);
    const instance = mount("<p>text</p>", true);
    const events = listen(instance);
    expect(press(instance, link).prevented).toBe(true);
    expect(events).toEqual(["link"]);
    expect(instance.isActive("link")).toBe(false);
  });

  it("swallows a held Save without flushing again, so the browser dialog never opens", () => {
    configureShortcutPlatform("windows");
    const instance = mount("<p>text</p>");
    const events = listen(instance);
    expect(press(instance, save, { repeat: true }).prevented).toBe(true);
    expect(events).toEqual([]);
  });

  it("ignores Save and Link while an IME is composing or the key is typed with AltGr", () => {
    configureShortcutPlatform("windows");
    const instance = mount("<p>text</p>");
    const events = listen(instance);
    for (const chord of [save, link]) {
      expect(press(instance, chord, { isComposing: true }).prevented).toBe(false);
      expect(press(instance, chord, { keyCode: 229 }).prevented).toBe(false);
      expect(press(instance, chord, { altKey: true, modifierAltGraph: true }).prevented).toBe(false);
    }
    expect(events).toEqual([]);
  });

  it("leaves Ctrl+S to the browser in a read-only editor", () => {
    configureShortcutPlatform("windows");
    const instance = mount("<p>text</p>");
    instance.setEditable(false);
    const events = listen(instance);
    expect(press(instance, save).prevented).toBe(false);
    expect(events).toEqual([]);
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
