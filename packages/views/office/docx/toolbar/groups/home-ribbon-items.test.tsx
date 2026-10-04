// Typed Home-tab items (R7): the Clipboard group's paste/cut/copy and the Font
// group's combos/toggles/dropdown must call exactly the commands the pre-typed
// controls called, and the size combo must show the effective size or the mixed
// placeholder. The items are pure data, so the test reads them straight off the
// two `ribbonItems` factories with a real command runtime over a TipTap editor.
import { Editor } from "@tiptap/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import type { RibbonItem } from "../../../ribbon";
import { createDocxCommandRuntime, type DocxCommandRuntime } from "../../commands";
import { docxExtensions } from "../../docx-schema";
import { publishDocxEditor } from "../../editor-store";
import type { DocxToolbarGroupContext } from "../types";
import { homeClipboardRibbonItems } from "./home-clipboard";
import { homeFontRibbonItems } from "./home-font";

initI18n();

beforeEach(async () => {
  await setLocale("en");
});

const editors: Editor[] = [];

function editorWith(text: string): Editor {
  const editor = new Editor({
    extensions: docxExtensions(),
    content: { type: "doc", content: [{ type: "docParagraph", content: [{ type: "text", text }] }] },
  });
  editors.push(editor);
  return editor;
}

function context(editor: Editor, runtime: DocxCommandRuntime, overrides: Partial<DocxToolbarGroupContext> = {}): DocxToolbarGroupContext {
  return {
    editor: { format: "docx", selection: { getSelection: () => null, subscribe: () => () => undefined } } as unknown as DocxToolbarGroupContext["editor"],
    coordinator: { getState: vi.fn(), subscribe: () => () => undefined, save: vi.fn() } as unknown as DocxToolbarGroupContext["coordinator"],
    format: runtime.getState(),
    commands: runtime,
    selection: null,
    readOnly: false,
    saving: false,
    dirty: false,
    canUndo: true,
    canRedo: true,
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    ...overrides,
  };
}

function item(items: readonly RibbonItem[], id: string): RibbonItem {
  const found = items.find((entry) => entry.id === id);
  if (!found) throw new Error(`missing item ${id}`);
  return found;
}

describe("Home clipboard typed items", () => {
  it("exposes Paste as a large split with a plain-text menu entry", () => {
    const editor = editorWith("hello");
    const runtime = createDocxCommandRuntime(() => editor);
    const items = homeClipboardRibbonItems(context(editor, runtime));

    const paste = item(items, "docx-clipboard-paste");
    expect(paste.kind).toBe("split");
    if (paste.kind !== "split") throw new Error("not a split");
    expect(paste.size).toBe("large");
    expect(paste.menu.map((entry) => entry.labelKey)).toEqual(["office.docx.contextMenu.pastePlain"]);

    expect(item(items, "docx-clipboard-cut").kind).toBe("button");
    expect(item(items, "docx-clipboard-copy").kind).toBe("button");
  });

  it("disables every clipboard item while read-only", () => {
    const editor = editorWith("hello");
    const runtime = createDocxCommandRuntime(() => editor);
    const items = homeClipboardRibbonItems(context(editor, runtime, { readOnly: true }));
    expect(items.every((entry) => entry.disabled === true)).toBe(true);
  });

  it("runs Paste through readClipboardPayload + insertPastePayload", async () => {
    const editor = editorWith("hello");
    const runtime = createDocxCommandRuntime(() => editor);
    publishDocxEditor(editor);
    const clipboardActions = await import("../../context-menu/clipboard-actions");
    const read = vi.spyOn(clipboardActions, "readClipboardPayload").mockResolvedValue({ html: "", text: "world" });
    const insert = vi.spyOn(clipboardActions, "insertPastePayload").mockReturnValue(true);
    const items = homeClipboardRibbonItems(context(editor, runtime));
    const paste = item(items, "docx-clipboard-paste");
    if (paste.kind !== "split") throw new Error("not a split");

    try {
      paste.onExecute();
      await vi.waitFor(() => expect(read).toHaveBeenCalled());
      expect(insert).toHaveBeenCalledWith(editor, { html: "", text: "world" });
    } finally {
      read.mockRestore();
      insert.mockRestore();
    }
  });
});

describe("Home font typed items", () => {
  it("keeps every command call identical to the pre-typed group", () => {
    const editor = editorWith("hello world");
    editor.commands.setTextSelection({ from: 1, to: 6 });
    publishDocxEditor(editor);
    const runtime = createDocxCommandRuntime(() => editor);
    const spies = {
      setFontFamily: vi.spyOn(runtime, "setFontFamily"),
      toggleBold: vi.spyOn(runtime, "toggleBold"),
      toggleItalic: vi.spyOn(runtime, "toggleItalic"),
      toggleUnderline: vi.spyOn(runtime, "toggleUnderline"),
      toggleStrike: vi.spyOn(runtime, "toggleStrike"),
      setVerticalAlign: vi.spyOn(runtime, "setVerticalAlign"),
      setTextColor: vi.spyOn(runtime, "setTextColor"),
      setHighlight: vi.spyOn(runtime, "setHighlight"),
      changeCase: vi.spyOn(runtime, "changeCase"),
      clearCharacterFormatting: vi.spyOn(runtime, "clearCharacterFormatting"),
    };
    const items = homeFontRibbonItems(context(editor, runtime));

    const family = item(items, "docx-font-family");
    if (family.kind !== "combo") throw new Error("family not a combo");
    family.onChange("Arial");
    expect(spies.setFontFamily).toHaveBeenCalledWith("Arial");

    for (const [id, spy] of [
      ["docx-bold", spies.toggleBold],
      ["docx-italic", spies.toggleItalic],
      ["docx-underline", spies.toggleUnderline],
      ["docx-strike", spies.toggleStrike],
      ["docx-clear-formatting", spies.clearCharacterFormatting],
    ] as const) {
      const entry = item(items, id);
      if (entry.kind !== "button" && entry.kind !== "toggle") throw new Error(`${id} not executable`);
      entry.onExecute();
      expect(spy).toHaveBeenCalledTimes(1);
    }

    const superscript = item(items, "docx-superscript");
    if (superscript.kind !== "toggle") throw new Error("superscript not a toggle");
    superscript.onExecute();
    expect(spies.setVerticalAlign).toHaveBeenCalledWith("superscript");

    const dropdown = item(items, "docx-change-case");
    if (dropdown.kind !== "dropdown") throw new Error("case not a dropdown");
    dropdown.menu.find((entry) => entry.id === "upper")?.onSelect();
    expect(spies.changeCase).toHaveBeenCalledWith("upper");
  });

  it("shows the effective size in the size combo and null when mixed", () => {
    const editor = editorWith("hello world");
    editor.chain().setTextSelection({ from: 1, to: 6 }).setMark("docTextStyle", { sizeHalfPoints: 28 }).run();
    publishDocxEditor(editor);

    editor.commands.setTextSelection(3);
    const runtime = createDocxCommandRuntime(() => editor);
    const single = item(homeFontRibbonItems(context(editor, runtime)), "docx-font-size");
    if (single.kind !== "combo") throw new Error("size not a combo");
    expect(single.value).toBe("14");
    expect(single.options.length).toBeGreaterThan(0);

    editor.commands.setTextSelection({ from: 1, to: 12 });
    const mixed = item(homeFontRibbonItems(context(editor, runtime)), "docx-font-size");
    if (mixed.kind !== "combo") throw new Error("size not a combo");
    expect(mixed.value).toBeNull();
  });

  it("sets the font size through setFontSizePt", () => {
    const editor = editorWith("hello world");
    editor.commands.setTextSelection({ from: 1, to: 6 });
    publishDocxEditor(editor);
    const runtime = createDocxCommandRuntime(() => editor);
    const setFontSizePt = vi.spyOn(runtime, "setFontSizePt");
    const size = item(homeFontRibbonItems(context(editor, runtime)), "docx-font-size");
    if (size.kind !== "combo") throw new Error("size not a combo");
    size.onChange("18");
    expect(setFontSizePt).toHaveBeenCalledWith(18);
  });
});
