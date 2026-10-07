// W-F (UNI-924): the styles group's typed gallery. Selecting a card must apply
// the same paragraph style the legacy gallery applied.
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { RibbonItem } from "../../../ribbon";
import type { DocxCommandRuntime } from "../../commands";
import { DOCX_STYLES_GALLERY } from "../../paragraph/styles-gallery";
import type { DocxToolbarGroupContext } from "../types";
import { homeStylesRibbonItems } from "./home-styles";
import { createDocxDocumentScope } from "../../editor-store";

function context(overrides: Partial<DocxToolbarGroupContext> = {}): DocxToolbarGroupContext {
  return {
    docScope: createDocxDocumentScope(),
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

  it("sizes the cards so Heading 1-6 stay distinguishable and titles each one", () => {
    const item = gallery(homeStylesRibbonItems(context()));
    // Wider than the old 76px default: "Heading 1" .. "Heading 6" fit on one line.
    expect(item.cardWidth).toBeGreaterThanOrEqual(90);
    // Full width shows the Word count of cards and the rest go to "More";
    // the ribbon can still shrink the row down to one card.
    expect(item.maxVisible).toBe(4);
    expect(item.options).toHaveLength(DOCX_STYLES_GALLERY.length);
    expect(item.minVisible).toBe(1);
    // The Styles group shows a real gallery (>= 3 cards), not a lone button.
    expect(item.maxVisible).toBeGreaterThanOrEqual(3);

    const headings = item.options.filter((option) => option.id.startsWith("heading-"));
    expect(headings).toHaveLength(6);
    for (const option of headings) {
      // Each card carries its full name (caption + tooltip) and Word's specimen.
      expect(option.label).toBeTruthy();
      const preview = render(<>{option.preview}</>).container.firstElementChild;
      expect(preview?.textContent).toBe("AaBbCcDd");
      expect(preview).toHaveAttribute("title", option.label);
    }
  });

  it("disables the gallery while read-only", () => {
    expect(gallery(homeStylesRibbonItems(context({ readOnly: true }))).disabled).toBe(true);
  });
});
