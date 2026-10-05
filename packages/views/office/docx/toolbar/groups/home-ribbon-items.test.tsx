// Typed Home-tab items (R7): the Clipboard group's paste/cut/copy and the Font
// group's pickers/toggles must call exactly the commands the pre-typed controls
// called, and the size picker must show the effective size or the mixed
// placeholder. The custom items are exercised through RTL renders with a real
// command runtime over a TipTap editor.
import { Editor } from "@tiptap/core";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

// F12: every test destroys its TipTap editors and clears the published editor,
// so no editor (or live-editor subscription) leaks into the next test.
afterEach(() => {
  publishDocxEditor(null);
  for (const editor of editors.splice(0)) editor.destroy();
});

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

/** Mounts a typed item's rendered node (the custom controls are components). */
function renderItem(entry: RibbonItem): void {
  if (entry.kind !== "custom") throw new Error(`item ${entry.id} is not custom`);
  render(<>{entry.render({ size: "small", inPanel: false })}</>);
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

  it("stacks Cut, Copy and Format painter as three icon rows beside Paste", () => {
    const editor = editorWith("hello");
    const runtime = createDocxCommandRuntime(() => editor);
    const items = homeClipboardRibbonItems(context(editor, runtime));
    const column = ["docx-clipboard-cut", "docx-clipboard-copy", "docx-format-painter"].map((id) => item(items, id));
    for (const entry of column) expect(entry.size).toBe("icon");
    expect(column.map((entry) => entry.rowBreak === true)).toEqual([false, true, true]);
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
  it("lays Word's two icon rows out: family, size, case, clear / B I U S x2 x2, colour, highlight", () => {
    const editor = editorWith("hello world");
    const runtime = createDocxCommandRuntime(() => editor);
    const items = homeFontRibbonItems(context(editor, runtime));
    for (const entry of items) expect(entry.size).toBe("icon");
    expect(items.filter((entry) => entry.rowBreak).map((entry) => entry.id)).toEqual(["docx-bold"]);
    expect(items.map((entry) => entry.id)).not.toContain("docx-format-painter");
    const family = item(items, "docx-font-family");
    const size = item(items, "docx-font-size");
    if (family.kind !== "custom" || size.kind !== "custom") throw new Error("family/size not custom");
    expect(family.width ?? 0).toBeGreaterThanOrEqual(140);
    expect(size.width ?? 0).toBeGreaterThanOrEqual(56);
  });

  it("keeps every non-typed command call identical to the pre-typed group", () => {
    const editor = editorWith("hello world");
    editor.commands.setTextSelection({ from: 1, to: 6 });
    publishDocxEditor(editor);
    const runtime = createDocxCommandRuntime(() => editor);
    const spies = {
      toggleBold: vi.spyOn(runtime, "toggleBold"),
      toggleItalic: vi.spyOn(runtime, "toggleItalic"),
      toggleUnderline: vi.spyOn(runtime, "toggleUnderline"),
      toggleStrike: vi.spyOn(runtime, "toggleStrike"),
      setVerticalAlign: vi.spyOn(runtime, "setVerticalAlign"),
      changeCase: vi.spyOn(runtime, "changeCase"),
      clearCharacterFormatting: vi.spyOn(runtime, "clearCharacterFormatting"),
    };
    const items = homeFontRibbonItems(context(editor, runtime));

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

  it("exposes the size control as an editable custom picker (F3)", () => {
    const editor = editorWith("hello world");
    editor.commands.setTextSelection({ from: 1, to: 6 });
    publishDocxEditor(editor);
    const runtime = createDocxCommandRuntime(() => editor);
    const items = homeFontRibbonItems(context(editor, runtime));
    const size = item(items, "docx-font-size");
    expect(size.kind).toBe("custom");
    if (size.kind !== "custom") throw new Error("size not custom");

    renderItem(size);
    // The legacy -[input]+ control is back: typing a non-preset size commits it.
    const input = screen.getByTestId("docx-font-size");
    fireEvent.change(input, { target: { value: "13.5" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect((editor.getAttributes("docTextStyle") as { sizeHalfPoints?: number }).sizeHalfPoints).toBe(27);
    expect(screen.getByTestId("docx-font-size-decrease")).toBeInTheDocument();
    expect(screen.getByTestId("docx-font-size-increase")).toBeInTheDocument();
  });

  it("steps the size through stepFontSize from the -/+ pair (F3)", () => {
    const editor = editorWith("hello world");
    editor.commands.setTextSelection({ from: 1, to: 6 });
    publishDocxEditor(editor);
    const runtime = createDocxCommandRuntime(() => editor);
    const stepFontSize = vi.spyOn(runtime, "stepFontSize");
    const items = homeFontRibbonItems(context(editor, runtime));
    const size = item(items, "docx-font-size");
    if (size.kind !== "custom") throw new Error("size not custom");

    renderItem(size);
    fireEvent.click(screen.getByTestId("docx-font-size-increase"));
    expect(stepFontSize).toHaveBeenCalledWith(1);
    fireEvent.click(screen.getByTestId("docx-font-size-decrease"));
    expect(stepFontSize).toHaveBeenCalledWith(-1);
  });

  it("shows the effective size and the mixed placeholder in the picker (F3)", async () => {
    const editor = editorWith("hello world");
    editor.chain().setTextSelection({ from: 1, to: 6 }).setMark("docTextStyle", { sizeHalfPoints: 28 }).run();
    publishDocxEditor(editor);
    editor.commands.setTextSelection(3);
    const runtime = createDocxCommandRuntime(() => editor);

    const single = item(homeFontRibbonItems(context(editor, runtime)), "docx-font-size");
    if (single.kind !== "custom") throw new Error("size not custom");
    const { unmount } = render(<>{single.render({ size: "small", inPanel: false })}</>);
    expect(screen.getByTestId("docx-font-size")).toHaveValue("14");
    unmount();

    editor.commands.setTextSelection({ from: 1, to: 12 });
    const mixed = item(homeFontRibbonItems(context(editor, runtime)), "docx-font-size");
    if (mixed.kind !== "custom") throw new Error("size not custom");
    renderItem(mixed);
    await waitFor(() => expect(screen.getByTestId("docx-font-size")).toHaveValue(""));
    expect(screen.getByTestId("docx-font-size")).toHaveAttribute("aria-placeholder", "-");
  });

  it("restores the family picker and commits a typed family name (F4)", async () => {
    const editor = editorWith("hello world");
    editor.commands.setTextSelection({ from: 1, to: 6 });
    publishDocxEditor(editor);
    const runtime = createDocxCommandRuntime(() => editor);
    const setFontFamily = vi.spyOn(runtime, "setFontFamily");
    const items = homeFontRibbonItems(context(editor, runtime));
    const family = item(items, "docx-font-family");
    expect(family.kind).toBe("custom");
    if (family.kind !== "custom") throw new Error("family not custom");

    renderItem(family);
    fireEvent.click(screen.getByTestId("docx-font-family"));
    const search = await screen.findByTestId("docx-font-family-search");
    fireEvent.change(search, { target: { value: "Aptos Display" } });
    fireEvent.keyDown(search, { key: "Enter" });
    expect(setFontFamily).toHaveBeenCalledWith("Aptos Display");
  });

  it("reads documentFonts only when the family panel opens, and caches per document (F5)", async () => {
    const editor = editorWith("hello world");
    publishDocxEditor(editor);
    const runtime = createDocxCommandRuntime(() => editor);
    const documentFonts = vi.spyOn(runtime, "documentFonts");
    const items = homeFontRibbonItems(context(editor, runtime));

    // Building the items must not walk the document.
    expect(documentFonts).not.toHaveBeenCalled();

    const family = item(items, "docx-font-family");
    if (family.kind !== "custom") throw new Error("family not custom");
    renderItem(family);
    expect(documentFonts).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("docx-font-family"));
    await screen.findByTestId("docx-font-family-list");
    expect(documentFonts).toHaveBeenCalledTimes(1);

    // Selection-only changes keep the same doc, so a second open reuses the
    // cached list instead of walking the document again.
    fireEvent.keyDown(screen.getByTestId("docx-font-family-search"), { key: "Escape" });
    editor.commands.setTextSelection(3);
    fireEvent.click(screen.getByTestId("docx-font-family"));
    await screen.findByTestId("docx-font-family-list");
    expect(documentFonts).toHaveBeenCalledTimes(1);
  });
});
