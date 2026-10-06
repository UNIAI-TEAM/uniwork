// W-F (UNI-924): the list group's ribbon items. Both list controls mount as
// `custom` items wrapping the same gallery/menu the legacy group used, because
// `RibbonMenuEntry` renders `t(labelKey)` with no interpolation: a typed
// `dropdown` would drop the `{{glyph}}`/`{{sample}}`/`{{level}}` variables, the
// per-level preview and the row icons (review F2/F11). Each row must still call
// the same numbering command the legacy menus called.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import type { RibbonItem } from "../../ribbon";
import type { DocxCommandRuntime } from "../commands";
import type { DocxToolbarGroupContext } from "../toolbar/types";
import { homeListsRibbonItems } from "./home-lists";

initI18n();

beforeEach(async () => {
  await setLocale("en");
});

function runtime() {
  return {
    applyDocxListPreset: vi.fn(() => true),
    setDocxListLevel: vi.fn(() => true),
    stepDocxListLevel: vi.fn(() => true),
    restartDocxListNumbering: vi.fn(() => true),
    continueDocxListNumbering: vi.fn(() => true),
  } as unknown as DocxCommandRuntime;
}

function context(overrides: Partial<DocxToolbarGroupContext> = {}): DocxToolbarGroupContext {
  return {
    editor: {} as unknown as DocxToolbarGroupContext["editor"],
    coordinator: {} as unknown as DocxToolbarGroupContext["coordinator"],
    format: { docxList: null } as unknown as DocxToolbarGroupContext["format"],
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

function custom(items: readonly RibbonItem[], id: string): Extract<RibbonItem, { kind: "custom" }> {
  const item = items.find((entry) => entry.id === id);
  if (!item || item.kind !== "custom") throw new Error(`missing custom item ${id}`);
  return item;
}

function mount(item: Extract<RibbonItem, { kind: "custom" }>): void {
  render(item.render({ size: "small", inPanel: false }));
}

async function openGallery(): Promise<void> {
  fireEvent.click(screen.getByTestId("docx-list-gallery"));
  await screen.findByTestId("docx-list-preset-multilevel-decimal");
}

async function openMultilevel(): Promise<void> {
  fireEvent.click(screen.getByTestId("docx-list-multilevel"));
  await screen.findByTestId("docx-list-level-0");
}

describe("homeListsRibbonItems", () => {
  it("mounts both list controls as custom items carrying their icon", () => {
    const items = homeListsRibbonItems(context());
    const gallery = custom(items, "docx-list-gallery");
    const multilevel = custom(items, "docx-list-multilevel");
    expect(gallery.labelKey).toBe("office.docx.lists.gallery");
    expect(gallery.icon).toBeDefined();
    expect(multilevel.labelKey).toBe("office.docx.lists.multilevel");
    expect(multilevel.icon).toBeDefined();
  });

  it("interpolates the {{glyph}} preset label instead of showing the bare key", async () => {
    mount(custom(homeListsRibbonItems(context()), "docx-list-gallery"));
    await openGallery();
    // "Bullet {{glyph}}" must read "Bullet •"; the old typed dropdown rendered
    // the bare key, i.e. "Bullet " (review F2).
    expect(screen.getByTestId("docx-list-preset-bullet-dot")).toHaveTextContent("Bullet •");
  });

  it("routes level, stepping and restart/continue rows to their commands", async () => {
    const commands = runtime();
    const list = { kind: "ordered", numId: "7", ilvl: 2, levels: [] } as unknown as NonNullable<
      DocxToolbarGroupContext["format"]
    >["docxList"];
    mount(custom(homeListsRibbonItems(context({ commands, format: { docxList: list } as unknown as DocxToolbarGroupContext["format"] })), "docx-list-multilevel"));

    await openMultilevel();
    fireEvent.click(screen.getByTestId("docx-list-level-2"));
    await openMultilevel();
    fireEvent.click(screen.getByTestId("docx-list-level-increase"));
    await openMultilevel();
    fireEvent.click(screen.getByTestId("docx-list-level-decrease"));
    await openMultilevel();
    fireEvent.click(screen.getByTestId("docx-list-restart"));
    await openMultilevel();
    fireEvent.click(screen.getByTestId("docx-list-continue"));

    expect(commands.setDocxListLevel).toHaveBeenCalledWith(2);
    expect(commands.stepDocxListLevel).toHaveBeenNthCalledWith(1, 1);
    expect(commands.stepDocxListLevel).toHaveBeenNthCalledWith(2, -1);
    expect(commands.restartDocxListNumbering).toHaveBeenCalledTimes(1);
    expect(commands.continueDocxListNumbering).toHaveBeenCalledTimes(1);
  });

  it("marks the caret's level and disables list-only rows outside a list", async () => {
    const list = { kind: "ordered", numId: "7", ilvl: 1, levels: [] } as unknown as NonNullable<
      DocxToolbarGroupContext["format"]
    >["docxList"];
    mount(custom(homeListsRibbonItems(context({ format: { docxList: list } as unknown as DocxToolbarGroupContext["format"] })), "docx-list-multilevel"));
    await openMultilevel();
    expect(screen.getByTestId("docx-list-level-1")).toHaveAttribute("aria-checked", "true");

    cleanup();
    mount(custom(homeListsRibbonItems(context()), "docx-list-multilevel"));
    await openMultilevel();
    expect(screen.getByTestId("docx-list-restart")).toHaveAttribute("aria-disabled", "true");
  });

  it("disables both triggers while read-only", () => {
    const items = homeListsRibbonItems(context({ readOnly: true }));
    expect(items.every((item) => item.disabled === true)).toBe(true);
  });
});
