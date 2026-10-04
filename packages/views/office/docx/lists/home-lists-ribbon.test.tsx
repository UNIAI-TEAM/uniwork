// W-F (UNI-924): the list group's typed ribbon items. Each menu row must call
// the same numbering command the legacy menus called.
import { describe, expect, it, vi } from "vitest";
import type { RibbonItem } from "../../ribbon";
import type { DocxCommandRuntime } from "../commands";
import type { DocxToolbarGroupContext } from "../toolbar/types";
import { homeListsRibbonItems } from "./home-lists";

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

function dropdown(items: readonly RibbonItem[], id: string) {
  const item = items.find((entry) => entry.id === id);
  if (!item || item.kind !== "dropdown") throw new Error(`missing dropdown ${id}`);
  return item;
}

describe("homeListsRibbonItems", () => {
  it("applies a gallery preset through applyDocxListPreset", () => {
    const commands = runtime();
    const item = dropdown(homeListsRibbonItems(context({ commands })), "docx-list-gallery");
    const row = item.menu.find((entry) => entry.id === "docx-list-preset-multilevel-decimal");
    expect(row).toBeDefined();
    row!.onSelect();
    expect(commands.applyDocxListPreset).toHaveBeenCalledWith("multilevel-decimal");
  });

  it("routes level, stepping and restart/continue rows to their commands", () => {
    const commands = runtime();
    const list = { kind: "ordered", numId: "7", ilvl: 2, levels: [] } as unknown as NonNullable<
      DocxToolbarGroupContext["format"]
    >["docxList"];
    const item = dropdown(
      homeListsRibbonItems(context({ commands, format: { docxList: list } as unknown as DocxToolbarGroupContext["format"] })),
      "docx-list-multilevel",
    );
    item.menu.find((entry) => entry.id === "docx-list-level-2")!.onSelect();
    item.menu.find((entry) => entry.id === "docx-list-level-increase")!.onSelect();
    item.menu.find((entry) => entry.id === "docx-list-level-decrease")!.onSelect();
    item.menu.find((entry) => entry.id === "docx-list-restart")!.onSelect();
    item.menu.find((entry) => entry.id === "docx-list-continue")!.onSelect();

    expect(commands.setDocxListLevel).toHaveBeenCalledWith(2);
    expect(commands.stepDocxListLevel).toHaveBeenNthCalledWith(1, 1);
    expect(commands.stepDocxListLevel).toHaveBeenNthCalledWith(2, -1);
    expect(commands.restartDocxListNumbering).toHaveBeenCalledTimes(1);
    expect(commands.continueDocxListNumbering).toHaveBeenCalledTimes(1);
  });

  it("marks the caret's level and disables list-only rows outside a list", () => {
    const list = { kind: "ordered", numId: "7", ilvl: 1, levels: [] } as unknown as NonNullable<
      DocxToolbarGroupContext["format"]
    >["docxList"];
    const inList = dropdown(
      homeListsRibbonItems(context({ format: { docxList: list } as unknown as DocxToolbarGroupContext["format"] })),
      "docx-list-multilevel",
    );
    expect(inList.menu.find((entry) => entry.id === "docx-list-level-1")!.checked).toBe(true);

    const outside = dropdown(homeListsRibbonItems(context()), "docx-list-multilevel");
    expect(outside.menu.find((entry) => entry.id === "docx-list-restart")!.disabled).toBe(true);
  });

  it("disables both triggers while read-only", () => {
    const items = homeListsRibbonItems(context({ readOnly: true }));
    expect(items.every((item) => item.disabled === true)).toBe(true);
  });
});


