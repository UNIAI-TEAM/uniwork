// W-F (UNI-924): the styles group's typed gallery. Selecting a card must apply
// the same paragraph style the legacy gallery applied.
import { describe, expect, it, vi } from "vitest";
import type { RibbonItem } from "../../../ribbon";
import type { DocxCommandRuntime } from "../../commands";
import type { DocxToolbarGroupContext } from "../types";
import { homeStylesRibbonItems } from "./home-styles";

function context(overrides: Partial<DocxToolbarGroupContext> = {}): DocxToolbarGroupContext {
  return {
    editor: {} as unknown as DocxToolbarGroupContext["editor"],
    coordinator: {} as unknown as DocxToolbarGroupContext["coordinator"],
    format: { paragraphStyle: "heading-2" } as unknown as DocxToolbarGroupContext["format"],
    commands: { applyParagraphStyle: vi.fn() } as unknown as DocxCommandRuntime,
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

function gallery(items: readonly RibbonItem[]): Extract<RibbonItem, { kind: "gallery" }> {
  const item = items.find((entry) => entry.kind === "gallery");
  if (!item || item.kind !== "gallery") throw new Error("missing gallery item");
  return item;
}

describe("homeStylesRibbonItems", () => {
  it("exposes every gallery entry and marks the caret's style selected", () => {
    const items = homeStylesRibbonItems(context());
    const item = gallery(items);
    expect(item.id).toBe("docx-styles-gallery");
    expect(item.size).toBe("large");
    expect(item.selectedId).toBe("heading-2");
    expect(item.options.map((option) => option.id)).toContain("normal");
    expect(item.options.map((option) => option.id)).toContain("quote");
  });

  it("applies the picked style through the same command", () => {
    const commands = { applyParagraphStyle: vi.fn() } as unknown as DocxCommandRuntime;
    const item = gallery(homeStylesRibbonItems(context({ commands })));
    item.onSelect("title");
    expect(commands.applyParagraphStyle).toHaveBeenCalledWith("title");
  });

  it("disables the gallery while read-only", () => {
    expect(gallery(homeStylesRibbonItems(context({ readOnly: true }))).disabled).toBe(true);
  });
});
