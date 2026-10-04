// UNI-924 W-H: the Layout / Review / View groups now publish typed ribbon items.
// These tests read each typed item and prove its action still runs the same
// command the pre-typed toolbar entry ran (no command lost in the migration).
import { describe, expect, it, vi } from "vitest";
import type { RibbonItem } from "../../../ribbon";
import type { DocxCommandRuntime } from "../../commands";
import type { DocxToolbarGroupContext } from "../types";
import { docxExportRibbonItems } from "../../export/docx-export-menu";
import { layoutPageDecorRibbonItems } from "./layout-page-decor";
import { layoutPageSetupRibbonItems } from "./layout-page-setup";
import { reviewCommentsRibbonItems } from "./review-comments";
import { reviewCompareRibbonItems } from "./review-compare";
import { reviewTrackChangesRibbonItems } from "./review-track-changes";
import { viewNavigationRibbonItems } from "./view-navigation";

function context(overrides: Partial<DocxToolbarGroupContext> = {}): DocxToolbarGroupContext {
  return {
    editor: {} as DocxToolbarGroupContext["editor"],
    coordinator: {} as DocxToolbarGroupContext["coordinator"],
    format: null,
    commands: undefined,
    selection: null,
    readOnly: false,
    saving: false,
    dirty: false,
    canUndo: false,
    canRedo: false,
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    ...overrides,
  };
}

function itemById(items: readonly RibbonItem[], id: string): RibbonItem {
  const item = items.find((entry) => entry.id === id);
  if (!item) throw new Error(`missing ribbon item ${id}`);
  return item;
}

describe("Layout tab typed ribbon items", () => {
  it("opens the page-setup dialog from the split primary and its menu", () => {
    const commands = { setDocxSectionProperties: vi.fn(() => true) } as unknown as DocxCommandRuntime;
    const items = layoutPageSetupRibbonItems(context({ commands, format: { docxPageSetup: { sections: [], activeIndex: 0 } } as never }));
    const split = itemById(items, "layout-page-setup");
    expect(split).toMatchObject({ kind: "split", size: "large" });
    if (split.kind !== "split") throw new Error("expected split");
    expect(() => split.onExecute()).not.toThrow();
    expect(() => split.menu[0]!.onSelect()).not.toThrow();
    // The group component stays mounted through a zero-width host item so the
    // dialog it owns still renders.
    expect(itemById(items, "layout-page-setup-host")).toMatchObject({ kind: "custom", width: 0 });
  });

  it("opens the page-decoration dialog from the dropdown menu", () => {
    const commands = { applyDocxPageDecor: vi.fn(() => true) } as unknown as DocxCommandRuntime;
    const items = layoutPageDecorRibbonItems(context({ commands, format: { docxPageDecor: {} } as never }));
    const dropdown = itemById(items, "layout-page-decor");
    expect(dropdown).toMatchObject({ kind: "dropdown", size: "large" });
    if (dropdown.kind !== "dropdown") throw new Error("expected dropdown");
    expect(() => dropdown.menu[0]!.onSelect()).not.toThrow();
  });
});

describe("Review tab typed ribbon items", () => {
  it("keeps accept-all / reject-all on the track-changes split menu", () => {
    const commands = {
      acceptAllReviewChanges: vi.fn(() => true),
      rejectAllReviewChanges: vi.fn(() => true),
    } as unknown as DocxCommandRuntime;
    const items = reviewTrackChangesRibbonItems(context({ commands, format: { reviewChanges: [{ id: "a" }] } as never }));
    const split = itemById(items, "review-track-changes");
    if (split.kind !== "split") throw new Error("expected split");
    expect(split.size).toBe("large");
    split.menu[0]!.onSelect();
    split.menu[1]!.onSelect();
    expect(commands.acceptAllReviewChanges).toHaveBeenCalledTimes(1);
    expect(commands.rejectAllReviewChanges).toHaveBeenCalledTimes(1);
  });

  it("keeps the compose-comment command on the comments split menu", () => {
    const commands = { canAddDocxComment: vi.fn(() => true) } as unknown as DocxCommandRuntime;
    const items = reviewCommentsRibbonItems(context({ commands, format: { docxComments: [] } as never }));
    const split = itemById(items, "review-comments");
    if (split.kind !== "split") throw new Error("expected split");
    expect(split.menu[0]).toMatchObject({ id: "review-comments-new", disabled: false });
    expect(() => split.menu[0]!.onSelect()).not.toThrow();
  });

  it("opens the compare dialog from the typed button", () => {
    const commands = { compareDocumentTexts: vi.fn(() => []) } as unknown as DocxCommandRuntime;
    const items = reviewCompareRibbonItems(context({ commands, format: { docxCompareReady: true } as never }));
    const button = itemById(items, "review-compare");
    expect(button).toMatchObject({ kind: "button", size: "large", disabled: false });
    if (button.kind !== "button") throw new Error("expected button");
    expect(() => button.onExecute()).not.toThrow();
  });
});

describe("View tab typed ribbon items", () => {
  it("toggles the navigation pane from the typed toggle", () => {
    const first = itemById(viewNavigationRibbonItems(context()), "view-navigation");
    if (first.kind !== "toggle") throw new Error("expected toggle");
    expect(first.size).toBe("large");
    const before = first.pressed;
    first.onExecute();
    const after = itemById(viewNavigationRibbonItems(context()), "view-navigation");
    if (after.kind !== "toggle") throw new Error("expected toggle");
    expect(after.pressed).toBe(!before);
    after.onExecute();
  });

  it("runs print / HTML / PDF from the export dropdown", () => {
    const commands = {
      printDocx: vi.fn(() => true),
      downloadDocxHtml: vi.fn(() => true),
    } as unknown as DocxCommandRuntime;
    const items = docxExportRibbonItems(context({ commands, format: { docxExportReady: true } as never }));
    const dropdown = itemById(items, "export");
    if (dropdown.kind !== "dropdown") throw new Error("expected dropdown");
    expect(dropdown.size).toBe("large");
    dropdown.menu[0]!.onSelect();
    dropdown.menu[1]!.onSelect();
    expect(commands.printDocx).toHaveBeenCalledTimes(1);
    expect(commands.downloadDocxHtml).toHaveBeenCalledTimes(1);
  });
});
