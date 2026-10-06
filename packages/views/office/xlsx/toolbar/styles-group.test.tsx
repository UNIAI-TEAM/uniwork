import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import viLocale from "@uniwork/core/i18n/locales/vi.json";
import { XLSX_CLIENT_MAX_EDIT_OPS } from "../xlsx-clipboard";
import { cellStyleParams, XLSX_CELL_STYLE_PRESETS } from "./cell-styles";
import { xlsxStylesRibbonItems } from "./styles-group";
import { selectionSpan } from "./structure-insert";
import type { XlsxToolbarGroupProps } from "./types";

const viText = (key: string): string => {
  const value = key.split(".").reduce<unknown>((node, part) =>
    node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined, viLocale);
  if (typeof value !== "string") throw new Error(`missing vi key ${key}`);
  return value;
};

function groupProps(overrides: Partial<XlsxToolbarGroupProps> = {}): XlsxToolbarGroupProps {
  return {
    readOnly: false,
    selection: { sheet: "Data", address: "B2", endAddress: "C3" },
    canUndo: true, canRedo: true, canRecalculate: true, canFormat: true, recalculating: false,
    commands: { execute: vi.fn(() => true) },
    unitId: "file-sha",
    sheetName: "Data",
    resolveSheetId: () => "sheet-1",
    onUndo: vi.fn(), onRedo: vi.fn(), onNumberFormat: vi.fn(), onRecalculate: vi.fn(),
    onCopy: vi.fn(), onPaste: vi.fn(), onShowSheets: vi.fn(),
    ...overrides,
  };
}

function renderStyles(props: XlsxToolbarGroupProps) {
  const items = xlsxStylesRibbonItems(props);
  return render(<>{items.map((item) => (item.kind === "custom" ? <div key={item.id}>{item.render({ size: "large", inPanel: false })}</div> : null))}</>);
}

const execute = (props: XlsxToolbarGroupProps) => props.commands!.execute as ReturnType<typeof vi.fn>;

describe("Home > Styles (design review X1)", () => {
  it("holds Conditional Formatting, Format as Table and Cell Styles as large commands, in Excel order", () => {
    const items = xlsxStylesRibbonItems(groupProps());
    expect(items.map((item) => `${item.id}:${item.size}`)).toEqual(["conditional-format:large", "format-as-table:large", "cell-styles:large"]);
  });

  it("gives large labels room for two full lines, so the Conditional Formatting label is not cut", () => {
    renderStyles(groupProps());
    for (const id of ["xlsx-cf-menu", "xlsx-format-as-table", "xlsx-cell-styles"]) {
      const button = screen.getByTestId(id);
      expect(button.className).toContain("max-w-24");
      expect(button.className).not.toContain("max-w-20");
    }
    expect(screen.getByTestId("xlsx-cf-menu")).toHaveTextContent(viText("office.xlsx.conditionalFormat.menu.label"));
  });

  it("formats the selection as a table through add-table with the next free name", () => {
    const props = groupProps({ tables: [{ sheet: "Other", name: "Table1", range: { startRow: 0, endRow: 1, startColumn: 0, endColumn: 0 } }] });
    renderStyles(props);
    const button = screen.getByTestId("xlsx-format-as-table");
    expect(button).toHaveTextContent(viText("office.xlsx.styles.formatAsTable"));
    fireEvent.click(button);
    expect(execute(props)).toHaveBeenCalledWith("sheet.command.add-table", {
      range: { startRow: 1, endRow: 2, startColumn: 1, endColumn: 2 },
      name: "Table2",
    });
  });

  it("applies a cell style preset as one style-only set-range-values over the selection", async () => {
    const props = groupProps();
    renderStyles(props);
    expect(screen.getByTestId("xlsx-cell-styles")).toHaveTextContent(viText("office.xlsx.styles.cellStyles"));
    fireEvent.click(screen.getByTestId("xlsx-cell-styles"));
    const good = await screen.findByTestId("xlsx-cell-style-good");
    expect(good).toHaveTextContent(viText("office.xlsx.styles.presets.good"));
    fireEvent.click(good);
    const style = { bg: { rgb: "#C6EFCE" }, cl: { rgb: "#006100" } };
    expect(execute(props)).toHaveBeenCalledTimes(1);
    expect(execute(props)).toHaveBeenCalledWith("sheet.command.set-range-values", {
      unitId: "file-sha",
      subUnitId: "sheet-1",
      range: { startRow: 1, endRow: 2, startColumn: 1, endColumn: 2 },
      value: { "1": { "1": { s: style }, "2": { s: style } }, "2": { "1": { s: style }, "2": { s: style } } },
    });
  });

  it("maps Normal to the clear-format command and lists every preset with the direct-formatting note", async () => {
    const props = groupProps();
    renderStyles(props);
    fireEvent.click(screen.getByTestId("xlsx-cell-styles"));
    for (const preset of XLSX_CELL_STYLE_PRESETS) {
      expect(await screen.findByTestId(`xlsx-cell-style-${preset.id}`)).toHaveTextContent(viText(`office.xlsx.styles.presets.${preset.id}`));
    }
    expect(screen.getByText(viText("office.xlsx.styles.cellStylesNote"))).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("xlsx-cell-style-normal"));
    expect(execute(props).mock.calls.map((call) => call[0])).toEqual(["sheet.command.clear-selection-format"]);
  });

  it("refuses a selection over the per-save edit limit instead of styling part of it", async () => {
    const props = groupProps({ selection: { sheet: "Data", address: "A1", endAddress: "K1000" } });
    expect(11 * 1000).toBeGreaterThan(XLSX_CLIENT_MAX_EDIT_OPS);
    expect(cellStyleParams(selectionSpan(props.selection)!, "u", "s", { bl: 1 })).toBeNull();
    renderStyles(props);
    fireEvent.click(screen.getByTestId("xlsx-cell-styles"));
    fireEvent.click(await screen.findByTestId("xlsx-cell-style-bad"));
    expect(execute(props)).not.toHaveBeenCalled();
    expect(screen.getByTestId("xlsx-cell-styles-limit")).toHaveAttribute("role", "alert");
  });

  it("stays inert read-only, without a selection or without a sheet id", () => {
    for (const overrides of [{ readOnly: true }, { selection: null }, { resolveSheetId: () => undefined }] as Partial<XlsxToolbarGroupProps>[]) {
      const props = groupProps(overrides);
      const view = renderStyles(props);
      expect(screen.getByTestId("xlsx-cell-styles")).toHaveAttribute("aria-disabled", "true");
      fireEvent.click(screen.getByTestId("xlsx-cell-styles"));
      expect(screen.queryByTestId("xlsx-cell-style-good")).toBeNull();
      if (overrides.resolveSheetId === undefined) {
        expect(screen.getByTestId("xlsx-format-as-table")).toHaveAttribute("aria-disabled", "true");
        fireEvent.click(screen.getByTestId("xlsx-format-as-table"));
      }
      expect(execute(props)).not.toHaveBeenCalled();
      view.unmount();
    }
  });
});
