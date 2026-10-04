// W-F (UNI-924): the paragraph group's typed ribbon items. Each item must call
// the same command the legacy component called, so the migration loses nothing.
import { describe, expect, it, vi } from "vitest";
import type { RibbonItem } from "../../../ribbon";
import type { DocxCommandRuntime } from "../../commands";
import type { DocxToolbarGroupContext } from "../types";
import { homeParagraphRibbonItems } from "./home-paragraph";

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

    // The split's primary re-applies the caret's current alignment (center),
    // and every menu row picks its own alignment.
    const align = byId(items, "docx-align");
    expect(align.kind).toBe("split");
    if (align.kind !== "split") return;
    expect(align.pressed).toBe(true);
    align.onExecute();
    expect(commands.setParagraphAlign).toHaveBeenCalledWith("center");
    for (const [index, value] of (["left", "center", "right", "justify"] as const).entries()) {
      align.menu[index]!.onSelect();
    }
    expect(commands.setParagraphAlign).toHaveBeenCalledWith("left");
    expect(commands.setParagraphAlign).toHaveBeenCalledWith("justify");
  });

  it("disables every item while read-only and keeps spacing as a custom item", () => {
    const items = homeParagraphRibbonItems(context({ readOnly: true }));
    for (const item of items) expect(item.disabled).toBe(true);
    const spacing = byId(items, "docx-paragraph-spacing");
    expect(spacing.kind).toBe("custom");
    expect(spacing.size).toBe("small");
  });

  it("falls back to left as the split's primary when no alignment is set", () => {
    const commands = runtime();
    const items = homeParagraphRibbonItems(
      context({ commands, format: { align: null } as unknown as DocxToolbarGroupContext["format"] }),
    );
    const align = byId(items, "docx-align");
    if (align.kind !== "split") throw new Error("expected split");
    align.onExecute();
    expect(commands.setParagraphAlign).toHaveBeenCalledWith("left");
  });
});
