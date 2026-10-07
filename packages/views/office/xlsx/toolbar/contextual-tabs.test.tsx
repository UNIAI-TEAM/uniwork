import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { RibbonButtonItem, RibbonCustomItem, RibbonItem, RibbonTab } from "../../ribbon";
import { xlsxContextualTabs } from "./contextual-tabs";
import type { XlsxToolbarGroupProps, XlsxToolbarTable } from "./types";

const range = { startRow: 0, endRow: 3, startColumn: 0, endColumn: 2 };
const sessionTable: XlsxToolbarTable = { sheet: "Data", name: "Sales", range };
const nativeTable: XlsxToolbarTable = { sheet: "Data", name: "Budget", range, native: true };

function props(overrides: Partial<XlsxToolbarGroupProps> = {}): XlsxToolbarGroupProps {
  return {
    selection: { sheet: "Data", address: "B2" },
    canUndo: true,
    canRedo: true,
    canRecalculate: true,
    canFormat: true,
    recalculating: false,
    commands: { execute: vi.fn(() => true) },
    tables: [sessionTable],
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    onNumberFormat: vi.fn(),
    onRecalculate: vi.fn(),
    onCopy: vi.fn(),
    onPaste: vi.fn(),
    onShowSheets: vi.fn(),
    ...overrides,
  } as XlsxToolbarGroupProps;
}

const design = (context: XlsxToolbarGroupProps): RibbonTab => xlsxContextualTabs(context).find((tab) => tab.id === "table-design")!;
const items = (tab: RibbonTab): RibbonItem[] => tab.groups.flatMap((group) => [...group.items]);

describe("Table Design tab", () => {
  it("lists Properties then Tools for a session table, in Excel's group order", () => {
    expect(design(props()).groups.map((group) => group.id)).toEqual(["table-design-properties", "table-design-tools"]);
  });

  it("shows the table name read-only in Properties", () => {
    const tab = design(props());
    const name = items(tab).find((item) => item.id === "table-design-name") as RibbonCustomItem;
    expect(name.kind).toBe("custom");
    render(<>{name.render({ size: "small", inPanel: false })}</>);
    const field = screen.getByTestId("xlsx-table-design-name");
    expect(field).toHaveValue("Sales");
    expect(field).toHaveAttribute("readonly");
  });

  it("converts a session table to a range through delete-table by name", () => {
    const execute = vi.fn(() => true);
    const convert = items(design(props({ commands: { execute } }))).find((item) => item.id === "table-design-convert") as RibbonButtonItem;
    expect(convert.disabled).toBe(false);
    convert.onExecute();
    expect(execute).toHaveBeenCalledWith("sheet.command.delete-table", { name: "Sales" });
  });

  it("does not offer Convert to range for a file-native table (no removal path)", () => {
    const tab = design(props({ tables: [nativeTable] }));
    expect(tab.groups.map((group) => group.id)).toEqual(["table-design-properties"]);
    expect(items(tab).some((item) => item.id === "table-design-convert")).toBe(false);
  });

  it("never shows a control without a command path (style, options, resize, rename)", () => {
    const ids = items(design(props())).map((item) => item.id);
    expect(ids).toEqual(["table-design-name", "table-design-convert"]);
  });

  it("disables Convert when read-only or without a commands port", () => {
    for (const overrides of [{ readOnly: true }, { commands: undefined }] as Partial<XlsxToolbarGroupProps>[]) {
      const convert = items(design(props(overrides))).find((item) => item.id === "table-design-convert");
      expect(convert?.disabled).toBe(true);
    }
  });

  it("is hidden when the selection is outside every table", () => {
    expect(design(props({ selection: { sheet: "Data", address: "H20" } })).contextual?.when).toBe(false);
  });
});

describe("Table Layout tab", () => {
  it("keeps the merge command path", () => {
    const execute = vi.fn(() => true);
    const layout = xlsxContextualTabs(props({ commands: { execute } })).find((tab) => tab.id === "table-layout")!;
    (items(layout).find((item) => item.id === "table-layout-merge") as RibbonButtonItem).onExecute();
    expect(execute).toHaveBeenCalledWith("sheet.command.add-worksheet-merge-all", { selections: [{ startRow: 1, endRow: 1, startColumn: 1, endColumn: 1 }] });
  });

  it("inserts below/right through the multi-after commands with a count", () => {
    const execute = vi.fn(() => true);
    const layout = xlsxContextualTabs(props({ commands: { execute } })).find((tab) => tab.id === "table-layout")!;
    const menuItem = (menuId: string, entryId: string) =>
      (items(layout).find((item) => item.id === menuId) as unknown as { menu: { id: string; onSelect: () => void }[] }).menu.find((entry) => entry.id === entryId)!;
    menuItem("table-layout-rows-menu", "table-layout-row-below").onSelect();
    menuItem("table-layout-columns-menu", "table-layout-col-right").onSelect();
    expect(execute).toHaveBeenCalledWith("sheet.command.insert-multi-rows-after", { value: 1 });
    expect(execute).toHaveBeenCalledWith("sheet.command.insert-multi-cols-right", { value: 1 });
  });
});
