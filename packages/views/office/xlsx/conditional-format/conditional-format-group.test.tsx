import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { XlsxToolbarGroupProps } from "../toolbar/types";
import { XlsxConditionalFormatGroup, xlsxConditionalFormatRibbonItems } from "./conditional-format-group";


const RANGE = { startRow: 0, endRow: 3, startColumn: 0, endColumn: 2 };

function groupProps(overrides: Partial<XlsxToolbarGroupProps> = {}): XlsxToolbarGroupProps {
  return {
    readOnly: false,
    selection: { sheet: "Data", address: "A1", endAddress: "C4" },
    canUndo: true,
    canRedo: true,
    canRecalculate: true,
    canFormat: true,
    recalculating: false,
    commands: { execute: vi.fn(() => true) },
    formatState: null,
    unitId: "file-abc",
    sheetName: "Data",
    resolveSheetId: () => "sheet-1",
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    onNumberFormat: vi.fn(),
    onRecalculate: vi.fn(),
    onCopy: vi.fn(),
    onPaste: vi.fn(),
    onShowSheets: vi.fn(),
    ...overrides,
  };
}

function openMenu() {
  fireEvent.click(screen.getByTestId("xlsx-cf-menu"));
}

describe("XlsxConditionalFormatGroup", () => {
  it("opens a preset dialog from the menu and adds the rule", async () => {
    const execute = vi.fn((_id: string, _params?: unknown) => true);
    render(<XlsxConditionalFormatGroup {...groupProps({ commands: { execute } })} />);
    openMenu();
    fireEvent.click(await screen.findByTestId("xlsx-cf-greaterThan"));
    fireEvent.change(await screen.findByTestId("xlsx-cf-first"), { target: { value: "7" } });
    fireEvent.click(screen.getByTestId("xlsx-cf-ok"));
    expect(execute).toHaveBeenCalledWith(
      "sheet.command.add-conditional-rule",
      expect.objectContaining({
        unitId: "file-abc",
        subUnitId: "sheet-1",
        rule: expect.objectContaining({
          ranges: [RANGE],
          rule: expect.objectContaining({ operator: "greaterThan", value: 7 }),
        }),
      }),
    );
  });

  it("fires the clear commands with exact params", async () => {
    const execute = vi.fn((_id: string, _params?: unknown) => true);
    render(<XlsxConditionalFormatGroup {...groupProps({ commands: { execute } })} />);
    openMenu();
    fireEvent.click(await screen.findByTestId("xlsx-cf-clear-selection"));
    expect(execute).toHaveBeenLastCalledWith("sheet.command.clear-range-conditional-rule", {
      unitId: "file-abc",
      subUnitId: "sheet-1",
      ranges: [RANGE],
    });
    openMenu();
    fireEvent.click(await screen.findByTestId("xlsx-cf-clear-sheet"));
    expect(execute).toHaveBeenLastCalledWith("sheet.command.clear-worksheet-conditional-rule", {
      unitId: "file-abc",
      subUnitId: "sheet-1",
    });
  });

  it("stays focusable but inert when blocked", () => {
    for (const overrides of [
      { readOnly: true },
      { commands: undefined },
      { selection: null },
      { unitId: null },
      { resolveSheetId: () => undefined },
    ] as Partial<XlsxToolbarGroupProps>[]) {
      const execute = vi.fn(() => true);
      const commands = "commands" in overrides ? overrides.commands : { execute };
      const view = render(<XlsxConditionalFormatGroup {...groupProps({ ...overrides, commands })} />);
      const button = screen.getByTestId("xlsx-cf-menu");
      expect(button).not.toBeDisabled();
      expect(button).toHaveAttribute("aria-disabled", "true");
      fireEvent.click(button);
      expect(screen.queryByTestId("xlsx-cf-greaterThan")).not.toBeInTheDocument();
      expect(execute).not.toHaveBeenCalled();
      view.unmount();
    }
  });

  it("is one large custom ribbon item on the Home tab that renders the menu", () => {
    const [item, ...rest] = xlsxConditionalFormatRibbonItems(groupProps());
    expect(rest).toEqual([]);
    expect(item).toMatchObject({ kind: "custom", id: "conditional-format", size: "large", collapseAs: "large" });
    if (item?.kind !== "custom") throw new Error("custom item expected");
    render(<>{item.render({ size: "large", inPanel: false })}</>);
    expect(screen.getByTestId("xlsx-cf-menu")).toBeInTheDocument();
  });

  it("gives every menu item an icon", async () => {
    render(<XlsxConditionalFormatGroup {...groupProps({ commands: { execute: vi.fn(() => true), readRuleSets: vi.fn(() => []) } })} />);
    openMenu();
    const items = await screen.findAllByRole("menuitem");
    expect(items.length).toBeGreaterThanOrEqual(9);
    for (const item of items) expect(item.querySelector("svg")).not.toBeNull();
  });

  it("offers Unique Values after Duplicate Values and adds the rule", async () => {
    const execute = vi.fn((_id: string, _params?: unknown) => true);
    render(<XlsxConditionalFormatGroup {...groupProps({ commands: { execute } })} />);
    openMenu();
    const items = (await screen.findAllByRole("menuitem")).map((item) => item.getAttribute("data-testid"));
    expect(items.indexOf("xlsx-cf-uniqueValues")).toBe(items.indexOf("xlsx-cf-duplicateValues") + 1);
    fireEvent.click(screen.getByTestId("xlsx-cf-uniqueValues"));
    fireEvent.click(await screen.findByTestId("xlsx-cf-ok"));
    expect(execute).toHaveBeenCalledWith(
      "sheet.command.add-conditional-rule",
      expect.objectContaining({ rule: expect.objectContaining({ rule: expect.objectContaining({ subType: "uniqueValues" }) }) }),
    );
  });

  it("no longer special-cases x14 sheets: Excel data bars are editable", async () => {
    const execute = vi.fn((_id: string, _params?: unknown) => true);
    const host = { file: { sheets: [{ id: "sheet-1", ruleSets: { conditionalFormats: "x14", dataValidations: "none" } }] } } as unknown as XlsxToolbarGroupProps["host"];
    render(<XlsxConditionalFormatGroup {...groupProps({ commands: { execute }, host })} />);
    openMenu();
    expect(screen.queryByTestId("xlsx-cf-x14-reason")).not.toBeInTheDocument();
    fireEvent.click(await screen.findByTestId("xlsx-cf-clear-sheet"));
    expect(execute).toHaveBeenCalledOnce();
  });

  it("disables Manage Rules when the port cannot read rules", async () => {
    render(<XlsxConditionalFormatGroup {...groupProps()} />);
    openMenu();
    const manage = await screen.findByTestId("xlsx-cf-manage");
    expect(manage).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(manage);
    expect(screen.queryByTestId("xlsx-cf-manager")).not.toBeInTheDocument();
  });
});
