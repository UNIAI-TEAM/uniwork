import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { setLocale } from "@uniwork/core/i18n";
import viLocale from "@uniwork/core/i18n/locales/vi.json";
import type { XlsxToolbarGroupProps } from "./types";
import { insertCounts, normalizeRowColCount, selectionSpan, XlsxStructureInsertGroup } from "./structure-insert";
import { XLSX_RANGE_TYPE } from "../selection-mapping";
import { characterWidthToPixels, parseBoundedNumber, pointsToPixels, XlsxStructureSizeGroup } from "./structure-size";
import { outlineCommandId, outlineCommandParams, XlsxStructureOutlineGroup } from "./structure-outline";

function groupProps(overrides: Partial<XlsxToolbarGroupProps> = {}): XlsxToolbarGroupProps {
  return {
    readOnly: false,
    permissions: {},
    selection: { sheet: "Data", address: "B2", endAddress: "C4" },
    canUndo: true,
    canRedo: true,
    canRecalculate: true,
    canFormat: true,
    recalculating: false,
    commands: { execute: vi.fn(() => true) },
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

const executeMock = (props: XlsxToolbarGroupProps) => props.commands!.execute as ReturnType<typeof vi.fn>;

/** The active suite locale is vi (test/setup.ts beforeAll), so the accessible
 *  names the product renders are the Vietnamese strings. */
const viText = (key: string): string => {
  const value = key.split(".").reduce<unknown>((node, part) =>
    node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined, viLocale);
  if (typeof value !== "string") throw new Error(`missing vi locale key ${key}`);
  return value;
};
/** Vietnamese has a single plural form, declared as `_other` (i18next v4). */
const viCount = (key: string, count: number) => viText(`${key}_other`).replace("{{count}}", String(count));

describe("structure pure logic", () => {
  it("derives the 0-based span from either selection order", () => {
    expect(selectionSpan({ sheet: "Data", address: "B2", endAddress: "C4" })).toEqual({
      startRow: 1, endRow: 3, startColumn: 1, endColumn: 2, rows: 3, columns: 2,
    });
    expect(selectionSpan({ sheet: "Data", address: "C4", endAddress: "B2" })).toEqual({
      startRow: 1, endRow: 3, startColumn: 1, endColumn: 2, rows: 3, columns: 2,
    });
    expect(selectionSpan({ sheet: "Data", address: "A1" })).toEqual({
      startRow: 0, endRow: 0, startColumn: 0, endColumn: 0, rows: 1, columns: 1,
    });
    expect(selectionSpan(null)).toBeNull();
    expect(selectionSpan({ sheet: "Data", address: "nope" })).toBeNull();
  });

  it("derives insert counts from the grid range type, keeping an explicit span", () => {
    const span = (address: string, endAddress: string) => selectionSpan({ sheet: "Data", address, endAddress })!;
    // A NORMAL range anchored at A spanning 26 columns is an explicit choice.
    expect(insertCounts(span("A1", "Z5"), XLSX_RANGE_TYPE.NORMAL)).toEqual({ rows: 5, columns: 26 });
    // Whole columns B:C: the row axis spans the sheet, so rows fall back to one.
    expect(insertCounts(span("B1", "C1000"), XLSX_RANGE_TYPE.COLUMN)).toEqual({ rows: 1, columns: 2 });
    // Whole rows 2:3: the column axis spans the sheet.
    expect(insertCounts(span("A2", "Z3"), XLSX_RANGE_TYPE.ROW)).toEqual({ rows: 2, columns: 1 });
    // The whole sheet: neither span is a count the user chose.
    expect(insertCounts(span("A1", "Z1000"), XLSX_RANGE_TYPE.ALL)).toEqual({ rows: 1, columns: 1 });
    // A whole-column type wins even on a grid smaller than the default bounds.
    expect(insertCounts(span("B1", "C50"), XLSX_RANGE_TYPE.COLUMN)).toEqual({ rows: 1, columns: 2 });
    // Without a range type (fallback surface, host-set selection) the bounds heuristic stays.
    expect(insertCounts(span("B1", "C1000"))).toEqual({ rows: 1, columns: 2 });
    expect(insertCounts(span("B2", "C4"))).toEqual({ rows: 3, columns: 2 });
  });

  it("accepts only whole counts in 1..10000", () => {
    expect(normalizeRowColCount("1")).toBe(1);
    expect(normalizeRowColCount(" 250 ")).toBe(250);
    expect(normalizeRowColCount("10000")).toBe(10_000);
    for (const draft of ["0", "10001", "-1", "1.5", "abc", ""]) {
      expect(normalizeRowColCount(draft), draft).toBeNull();
    }
  });

  it("converts file units to the renderer's pixels", () => {
    expect(pointsToPixels(15)).toBe(20);
    expect(pointsToPixels(30)).toBe(40);
    expect(characterWidthToPixels(12)).toBe(84);
    expect(characterWidthToPixels(8.43)).toBe(59);
  });

  it("rejects malformed and out-of-range size drafts", () => {
    expect(parseBoundedNumber("30", 1, 409)).toBe(30);
    expect(parseBoundedNumber("30.5", 1, 409)).toBe(30.5);
    expect(parseBoundedNumber("0", 1, 409)).toBeNull();
    expect(parseBoundedNumber("409.5", 1, 409)).toBeNull();
    expect(parseBoundedNumber("abc", 1, 409)).toBeNull();
    expect(parseBoundedNumber("256", 1, 255)).toBeNull();
  });

  it("maps outline actions onto the axis command and params", () => {
    const span = selectionSpan({ sheet: "Data", address: "B2", endAddress: "C4" })!;
    expect(outlineCommandId("rows")).toBe("uniwork.command.set-rows-outline");
    expect(outlineCommandId("cols")).toBe("uniwork.command.set-cols-outline");
    expect(outlineCommandParams(span, "rows", "group")).toEqual({ start: 1, end: 3, action: "group" });
    expect(outlineCommandParams(span, "cols", "clear")).toEqual({ start: 1, end: 2, action: "clear" });
  });
});

describe("XlsxStructureInsertGroup", () => {
  it("fires the insert commands with the typed count and the selection ranges", () => {
    const props = groupProps();
    render(<XlsxStructureInsertGroup {...props} />);
    const execute = executeMock(props);
    const rowCount = screen.getByLabelText(viText("office.xlsx.structure.rowCount"));
    const colCount = screen.getByLabelText(viText("office.xlsx.structure.colCount"));
    fireEvent.change(rowCount, { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: viCount("office.xlsx.structure.insertRowsAbove", 4) }));
    expect(execute).toHaveBeenCalledWith("sheet.command.insert-row-before", { value: 4 });
    fireEvent.click(screen.getByRole("button", { name: viText("office.xlsx.structure.insertRowsBelow") }));
    expect(execute).toHaveBeenCalledWith("sheet.command.insert-multi-rows-after", { value: 4 });
    // Each input keeps its own draft: the row edit above must not leak.
    expect(colCount).toHaveValue("2");
    fireEvent.change(colCount, { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: viCount("office.xlsx.structure.insertColsLeft", 5) }));
    expect(execute).toHaveBeenCalledWith("sheet.command.insert-col-before", { value: 5 });
    fireEvent.click(screen.getByRole("button", { name: viText("office.xlsx.structure.insertColsRight") }));
    expect(execute).toHaveBeenCalledWith("sheet.command.insert-multi-cols-right", { value: 5 });
    // Deleting lives in Home > Cells > Delete, not in the insert form.
    expect(screen.queryByRole("button", { name: viText("office.xlsx.structure.deleteRows") })).toBeNull();
  });

  it("labels every insert command with visible text (design review X2)", () => {
    const props = groupProps();
    render(<XlsxStructureInsertGroup {...props} />);
    for (const button of screen.getAllByRole("button")) {
      expect((button.textContent ?? "").trim()).not.toBe("");
      expect(button).toHaveAttribute("title", (button.textContent ?? "").trim());
    }
  });

  it("keeps an unparsable count at the last good value", () => {
    const props = groupProps();
    render(<XlsxStructureInsertGroup {...props} />);
    const execute = executeMock(props);
    const rowCount = screen.getByLabelText(viText("office.xlsx.structure.rowCount"));
    fireEvent.change(rowCount, { target: { value: "99999" } });
    fireEvent.blur(rowCount);
    expect(rowCount).toHaveValue("3");
    fireEvent.click(screen.getByRole("button", { name: viCount("office.xlsx.structure.insertRowsAbove", 3) }));
    expect(execute).toHaveBeenCalledWith("sheet.command.insert-row-before", { value: 3 });
    // The column input falls back to its own span (2), not the row span.
    const colCount = screen.getByLabelText(viText("office.xlsx.structure.colCount"));
    fireEvent.change(colCount, { target: { value: "0" } });
    fireEvent.blur(colCount);
    expect(colCount).toHaveValue("2");
  });

  it("does not echo the unrelated axis span for whole-column or whole-row selections", () => {
    // Whole columns B:C (every one of 1000 rows): Insert Rows is not the
    // 1000-row span; it falls back to one row, label and action agreeing.
    const columns = groupProps({ selection: { sheet: "Data", address: "B1", endAddress: "C1000" } });
    const first = render(<XlsxStructureInsertGroup {...columns} />);
    expect(screen.getByLabelText(viText("office.xlsx.structure.rowCount"))).toHaveValue("1");
    fireEvent.click(screen.getByRole("button", { name: viCount("office.xlsx.structure.insertRowsAbove", 1) }));
    expect(executeMock(columns)).toHaveBeenCalledWith("sheet.command.insert-row-before", { value: 1 });
    // The column axis keeps its real span.
    expect(screen.getByRole("button", { name: viCount("office.xlsx.structure.insertColsLeft", 2) })).toBeInTheDocument();
    first.unmount();
    // Whole rows 2:3 (A:Z): Insert Columns falls back to one column.
    const rows = groupProps({ selection: { sheet: "Data", address: "A2", endAddress: "Z3" } });
    render(<XlsxStructureInsertGroup {...rows} />);
    expect(screen.getByLabelText(viText("office.xlsx.structure.colCount"))).toHaveValue("1");
    fireEvent.click(screen.getByRole("button", { name: viCount("office.xlsx.structure.insertColsLeft", 1) }));
    expect(executeMock(rows)).toHaveBeenCalledWith("sheet.command.insert-col-before", { value: 1 });
    expect(screen.getByRole("button", { name: viCount("office.xlsx.structure.insertRowsAbove", 2) })).toBeInTheDocument();
  });

  it("inserts the explicit span of a wide NORMAL range and one line for whole axes", () => {
    const wide = groupProps({ selection: { sheet: "Data", address: "A1", endAddress: "Z5", rangeType: XLSX_RANGE_TYPE.NORMAL } });
    const first = render(<XlsxStructureInsertGroup {...wide} />);
    expect(screen.getByLabelText(viText("office.xlsx.structure.colCount"))).toHaveValue("26");
    fireEvent.click(screen.getByRole("button", { name: viCount("office.xlsx.structure.insertColsLeft", 26) }));
    expect(executeMock(wide)).toHaveBeenCalledWith("sheet.command.insert-col-before", { value: 26 });
    first.unmount();
    const sheet = groupProps({ selection: { sheet: "Data", address: "A1", endAddress: "Z1000", rangeType: XLSX_RANGE_TYPE.ALL } });
    render(<XlsxStructureInsertGroup {...sheet} />);
    fireEvent.click(screen.getByRole("button", { name: viCount("office.xlsx.structure.insertRowsAbove", 1) }));
    fireEvent.click(screen.getByRole("button", { name: viCount("office.xlsx.structure.insertColsLeft", 1) }));
    expect(executeMock(sheet)).toHaveBeenCalledWith("sheet.command.insert-row-before", { value: 1 });
    expect(executeMock(sheet)).toHaveBeenCalledWith("sheet.command.insert-col-before", { value: 1 });
  });

  it("refuses clicks in a read-only mount", () => {
    const props = groupProps({ readOnly: true });
    render(<XlsxStructureInsertGroup {...props} />);
    const button = screen.getByRole("button", { name: viText("office.xlsx.structure.insertRowsBelow") });
    expect(button).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(button);
    expect(executeMock(props)).not.toHaveBeenCalled();
  });

  it("disables every control without a usable selection or commands port", () => {
    render(<XlsxStructureInsertGroup {...groupProps({ selection: null })} />);
    for (const button of screen.getAllByRole("button")) expect(button).toHaveAttribute("aria-disabled", "true");
    const props = groupProps({ commands: undefined });
    const second = render(<XlsxStructureInsertGroup {...props} />);
    const container = second.container;
    for (const button of container.querySelectorAll("button")) {
      expect(button.getAttribute("aria-disabled")).toBe("true");
    }
  });
});

describe("plural insert labels", () => {
  it("reads 1 row / 1 column / 3 rows in English, not the count baked into a plural", async () => {
    await setLocale("en");
    try {
      const props = groupProps();
      render(<XlsxStructureInsertGroup {...props} />);
      // The B2:C4 span is 3 rows and 2 columns, so the "above"/"left" names pluralise.
      expect(screen.getByRole("button", { name: "Insert 3 rows above" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Insert 2 columns to the left" })).toBeInTheDocument();
      fireEvent.change(screen.getByLabelText("Row count"), { target: { value: "1" } });
      expect(screen.getByRole("button", { name: "Insert 1 row above" })).toBeInTheDocument();
      fireEvent.change(screen.getByLabelText("Column count"), { target: { value: "1" } });
      expect(screen.getByRole("button", { name: "Insert 1 column to the left" })).toBeInTheDocument();
      // The plural forms are gone once the count is 1, in both languages.
      expect(screen.queryByRole("button", { name: "Insert 1 rows above" })).toBeNull();
    } finally {
      await setLocale("vi");
    }
  });
});

describe("XlsxStructureSizeGroup", () => {
  it("converts points and character widths before firing the size commands", () => {
    const props = groupProps();
    render(<XlsxStructureSizeGroup {...props} />);
    const execute = executeMock(props);
    const height = screen.getByLabelText(viText("office.xlsx.structure.rowHeight"));
    fireEvent.change(height, { target: { value: "30" } });
    fireEvent.blur(height);
    expect(execute).toHaveBeenCalledWith("sheet.command.set-row-height", { value: 40 });
    const width = screen.getByLabelText(viText("office.xlsx.structure.colWidth"));
    fireEvent.change(width, { target: { value: "12" } });
    fireEvent.keyDown(width, { key: "Enter" });
    expect(execute).toHaveBeenCalledWith("sheet.command.set-worksheet-col-width", { value: 84 });
  });

  it("resets to automatic sizes and hides/unhides the selection's lines", () => {
    const props = groupProps();
    render(<XlsxStructureSizeGroup {...props} />);
    const execute = executeMock(props);
    fireEvent.click(screen.getByRole("button", { name: viText("office.xlsx.structure.resetRowHeight") }));
    expect(execute).toHaveBeenCalledWith("sheet.command.set-row-is-auto-height");
    fireEvent.click(screen.getByRole("button", { name: viText("office.xlsx.structure.resetColWidth") }));
    expect(execute).toHaveBeenCalledWith("uniwork.command.set-cols-default-width", { start: 1, end: 2 });
    const ranges = [{ startRow: 1, endRow: 3, startColumn: 1, endColumn: 2 }];
    fireEvent.click(screen.getByRole("button", { name: viText("office.xlsx.structure.hideRows") }));
    expect(execute).toHaveBeenCalledWith("sheet.command.set-rows-hidden", { ranges });
    fireEvent.click(screen.getByRole("button", { name: viText("office.xlsx.structure.showRows") }));
    expect(execute).toHaveBeenCalledWith("sheet.command.set-specific-rows-visible", { ranges });
    fireEvent.click(screen.getByRole("button", { name: viText("office.xlsx.structure.hideCols") }));
    expect(execute).toHaveBeenCalledWith("sheet.command.set-col-hidden", { ranges });
    fireEvent.click(screen.getByRole("button", { name: viText("office.xlsx.structure.showCols") }));
    expect(execute).toHaveBeenCalledWith("sheet.command.set-col-visible-on-cols", { ranges });
  });

  it("keeps invalid size drafts inert", () => {
    const props = groupProps();
    render(<XlsxStructureSizeGroup {...props} />);
    const execute = executeMock(props);
    const height = screen.getByLabelText(viText("office.xlsx.structure.rowHeight"));
    fireEvent.change(height, { target: { value: "900" } });
    fireEvent.blur(height);
    expect(execute).not.toHaveBeenCalled();
  });

  it("refuses clicks in a read-only mount", () => {
    const props = groupProps({ readOnly: true });
    const view = render(<XlsxStructureSizeGroup {...props} />);
    const button = view.getByRole("button", { name: viText("office.xlsx.structure.hideRows") });
    expect(button).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(button);
    expect(executeMock(props)).not.toHaveBeenCalled();
  });
});

describe("XlsxStructureOutlineGroup", () => {
  const openMenu = (testId: string) => fireEvent.click(screen.getByTestId(testId));
  const pick = (testId: string) => fireEvent.click(screen.getByTestId(testId));

  it("labels every primary control with visible text and a matching name", () => {
    render(<XlsxStructureOutlineGroup {...groupProps()} />);
    for (const key of ["group", "ungroup", "showDetail", "hideDetail"]) {
      const name = viText(`office.xlsx.structure.${key}`);
      const button = screen.getByRole("button", { name });
      expect(button).toHaveTextContent(name);
      expect(button).toHaveAttribute("title", name);
    }
  });

  it("fires the registered outline commands from the Group and Ungroup menus", () => {
    const props = groupProps();
    render(<XlsxStructureOutlineGroup {...props} />);
    const execute = executeMock(props);
    openMenu("xlsx-outline-group");
    pick("xlsx-outline-group-rows");
    expect(execute).toHaveBeenCalledWith("uniwork.command.set-rows-outline", { start: 1, end: 3, action: "group" });
    openMenu("xlsx-outline-group");
    pick("xlsx-outline-group-cols");
    expect(execute).toHaveBeenCalledWith("uniwork.command.set-cols-outline", { start: 1, end: 2, action: "group" });
    openMenu("xlsx-outline-ungroup");
    pick("xlsx-outline-ungroup-rows");
    expect(execute).toHaveBeenCalledWith("uniwork.command.set-rows-outline", { start: 1, end: 3, action: "ungroup" });
    openMenu("xlsx-outline-ungroup");
    pick("xlsx-outline-ungroup-cols");
    expect(execute).toHaveBeenCalledWith("uniwork.command.set-cols-outline", { start: 1, end: 2, action: "ungroup" });
    openMenu("xlsx-outline-ungroup");
    expect(screen.getByTestId("xlsx-outline-clear-outline")).toHaveTextContent(viText("office.xlsx.structure.clearOutline"));
    pick("xlsx-outline-clear-outline");
    expect(execute).toHaveBeenCalledWith("uniwork.command.set-rows-outline", { start: 1, end: 3, action: "clear" });
    expect(execute).toHaveBeenCalledWith("uniwork.command.set-cols-outline", { start: 1, end: 2, action: "clear" });
  });

  it("hides and shows the selection's rows from Hide / Show Detail", () => {
    const props = groupProps();
    render(<XlsxStructureOutlineGroup {...props} />);
    const execute = executeMock(props);
    const ranges = [{ startRow: 1, endRow: 3, startColumn: 1, endColumn: 2 }];
    fireEvent.click(screen.getByRole("button", { name: viText("office.xlsx.structure.hideDetail") }));
    expect(execute).toHaveBeenCalledWith("sheet.command.set-rows-hidden", { ranges });
    fireEvent.click(screen.getByRole("button", { name: viText("office.xlsx.structure.showDetail") }));
    expect(execute).toHaveBeenCalledWith("sheet.command.set-specific-rows-visible", { ranges });
  });

  it("uses the column commands for a whole-column selection", () => {
    const props = groupProps({
      selection: { sheet: "Data", address: "B1", endAddress: "C1000", rangeType: XLSX_RANGE_TYPE.COLUMN },
    });
    render(<XlsxStructureOutlineGroup {...props} />);
    const execute = executeMock(props);
    const ranges = [{ startRow: 0, endRow: 999, startColumn: 1, endColumn: 2 }];
    fireEvent.click(screen.getByRole("button", { name: viText("office.xlsx.structure.hideDetail") }));
    expect(execute).toHaveBeenCalledWith("sheet.command.set-col-hidden", { ranges });
    fireEvent.click(screen.getByRole("button", { name: viText("office.xlsx.structure.showDetail") }));
    expect(execute).toHaveBeenCalledWith("sheet.command.set-col-visible-on-cols", { ranges });
  });

  it("stays focusable but inert without edit rights or a selection", () => {
    for (const overrides of [{ readOnly: true }, { selection: null }] as Partial<XlsxToolbarGroupProps>[]) {
      const props = groupProps(overrides);
      const view = render(<XlsxStructureOutlineGroup {...props} />);
      const buttons = screen.getAllByRole("button");
      expect(buttons).toHaveLength(4);
      for (const button of buttons) {
        expect(button).not.toBeDisabled();
        expect(button).toHaveAttribute("aria-disabled", "true");
        fireEvent.click(button);
      }
      expect(screen.queryByTestId("xlsx-outline-group-rows")).not.toBeInTheDocument();
      expect(screen.queryByTestId("xlsx-outline-ungroup-rows")).not.toBeInTheDocument();
      expect(executeMock(props)).not.toHaveBeenCalled();
      view.unmount();
    }
  });
});

describe("vi plural forms", () => {
  it("carries the _one form with identical text beside every vi insert plural", () => {
    for (const key of ["office.xlsx.structure.insertRowsAbove", "office.xlsx.structure.insertColsLeft"]) {
      expect(viText(`${key}_one`), `${key}_one`).toBe(viText(`${key}_other`));
    }
  });
});
