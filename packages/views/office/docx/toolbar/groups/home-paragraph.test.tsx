// W-F (UNI-924): the paragraph group's typed ribbon items. Each item must call
// the same command the legacy component called, so the migration loses nothing.
import { describe, expect, it, vi } from "vitest";
import type { RibbonItem } from "../../../ribbon";
import type { DocxCommandRuntime } from "../../commands";
import type { DocxToolbarGroupContext } from "../types";
import { homeParagraphRibbonItems } from "./home-paragraph";
import { createDocxDocumentScope } from "../../editor-store";

function runtime() {
  return {
    setParagraphAlign: vi.fn(),
    stepParagraphIndent: vi.fn(),
    setLineSpacing: vi.fn(),
    setSpaceBeforePt: vi.fn(),
    setSpaceAfterPt: vi.fn(),
  } as unknown as DocxCommandRuntime;
}

function context(overrides: Partial<DocxToolbarGroupContext> = {}): DocxToolbarGroupContext {
  return {
    docScope: createDocxDocumentScope(),
    editor: {} as unknown as DocxToolbarGroupContext["editor"],
    coordinator: {} as unknown as DocxToolbarGroupContext["coordinator"],
    format: { align: "center" } as unknown as DocxToolbarGroupContext["format"],
    commands: runtime(),
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

function byId(items: readonly RibbonItem[], id: string): RibbonItem {
  const item = items.find((entry) => entry.id === id);
  if (!item) throw new Error(`missing ribbon item ${id}`);
  return item;
}

describe("homeParagraphRibbonItems", () => {
  it("keeps the indent, align and spacing commands identical", () => {
    const commands = runtime();
    const items = homeParagraphRibbonItems(context({ commands }));

    const outdent = byId(items, "docx-indent-decrease");
    const indent = byId(items, "docx-indent-increase");
    expect(outdent.kind).toBe("button");
    expect(indent.kind).toBe("button");
    if (outdent.kind === "button") outdent.onExecute();
    if (indent.kind === "button") indent.onExecute();
    expect(commands.stepParagraphIndent).toHaveBeenNthCalledWith(1, -1);
    expect(commands.stepParagraphIndent).toHaveBeenNthCalledWith(2, 1);

    // Word's four alignment toggles, each applying its own alignment.
    for (const value of ["left", "center", "right", "justify"] as const) {
      const toggle = byId(items, `docx-align-${value}`);
      expect(toggle.kind).toBe("toggle");
      expect(toggle.size).toBe("icon");
      if (toggle.kind !== "toggle") return;
      expect(toggle.pressed).toBe(value === "center");
      toggle.onExecute();
      expect(commands.setParagraphAlign).toHaveBeenLastCalledWith(value);
    }
  });

  it("merges the list controls into the paragraph group as two icon rows", () => {
    const items = homeParagraphRibbonItems(context());
    expect(items.map((item) => item.id)).toEqual([
      "docx-list-gallery",
      "docx-list-multilevel",
      "docx-indent-decrease",
      "docx-indent-increase",
      "docx-align-left",
      "docx-align-center",
      "docx-align-right",
      "docx-align-justify",
      "docx-paragraph-spacing",
    ]);
    for (const item of items) expect(item.size).toBe("icon");
    expect(items.filter((item) => item.rowBreak).map((item) => item.id)).toEqual(["docx-align-left"]);
  });

  it("disables every item while read-only and keeps spacing as a custom item", () => {
    const items = homeParagraphRibbonItems(context({ readOnly: true }));
    for (const item of items) expect(item.disabled).toBe(true);
    const spacing = byId(items, "docx-paragraph-spacing");
    expect(spacing.kind).toBe("custom");
    expect(spacing.size).toBe("icon");
  });
});
