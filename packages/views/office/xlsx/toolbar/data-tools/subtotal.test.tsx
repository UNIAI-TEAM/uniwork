import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { XlsxCellState, XlsxWorkbookSnapshot } from "@uniwork/office-engine/xlsx";
import viLocale from "@uniwork/core/i18n/locales/vi.json";
import type { XlsxToolbarGroupProps } from "../types";
import { scalarCellData } from "./range-values";

/** A label cell as the plan writes it: text plus the no-wrap style. */
const labelCell = (label: string) => ({ ...scalarCellData(label), s: { tb: 1 } });
import { planSubtotal, SUBTOTAL_FUNCTIONS } from "./subtotal";
import { XlsxSubtotalButton } from "./subtotal-dialog";

const viText = (key: string): string => {
  const value = key.split(".").reduce<unknown>((node, part) =>
    node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined, viLocale);
  if (typeof value !== "string") throw new Error(`missing vi key ${key}`);
  return value;
};

const c = (value: XlsxCellState["value"]): XlsxCellState => ({ value });
const formula = (f: string) => ({ f, v: null, p: null, si: null });
const insert = (row: number, startColumn = 0, endColumn = 1) => ({
  id: "sheet.command.insert-row",
  params: { unitId: "file-sha", subUnitId: "sheet-1", direction: 2, range: { startRow: row, endRow: row, startColumn, endColumn, rangeType: 1 } },
});
const outline = (start: number, end: number) => ({
  id: "uniwork.command.set-rows-outline",
  params: { subUnitId: "sheet-1", start, end, action: "group" },
});

// Header + An, an, Bình, Chi in A1:B5: three groups (text compares case-insensitively).
const LIST = [[c("Tên"), c("SL")], [c("An"), c(1)], [c("an"), c(2)], [c("Bình"), c(3)], [c("Chi"), c(4)]];
const TARGET = { unitId: "file-sha", sheetId: "sheet-1" };
const LABELS = { group: (value: string) => `Tổng ${value}`, grand: "Tổng chung" };
const SPAN = { startRow: 0, startColumn: 0, endColumn: 1 };

/** The full batch for LIST summed into column B, labels in column A. */
const EXPECTED_STEPS = [
  // Bottom-up in original rows: grand total, then Chi, Bình, An.
  insert(5), insert(5), insert(4), insert(3),
  {
    id: "sheet.command.set-range-values",
    params: {
      unitId: "file-sha",
      subUnitId: "sheet-1",
      range: { startRow: 3, endRow: 8, startColumn: 0, endColumn: 1 },
      value: {
        "3": { "0": labelCell("Tổng An"), "1": formula("=SUBTOTAL(9,B2:B3)") },
        "5": { "0": labelCell("Tổng Bình"), "1": formula("=SUBTOTAL(9,B5:B5)") },
        "7": { "0": labelCell("Tổng Chi"), "1": formula("=SUBTOTAL(9,B7:B7)") },
        "8": { "0": labelCell("Tổng chung"), "1": formula("=SUBTOTAL(9,B2:B8)") },
      },
    },
  },
  outline(1, 7), outline(1, 2), outline(4, 4), outline(6, 6),
];

describe("planSubtotal", () => {
  it("maps Excel's functions onto SUBTOTAL function numbers", () => {
    expect(SUBTOTAL_FUNCTIONS).toEqual({ sum: 9, count: 3, average: 1, max: 4, min: 5, product: 6 });
  });

  it("inserts bottom-up, writes labels and formulas at the final rows and outlines two levels", () => {
    const plan = planSubtotal(LIST, { changeColumn: 0, fn: "sum", columns: [1] }, SPAN, TARGET, LABELS);
    if (typeof plan === "string") throw new Error(plan);
    expect(plan.insertedRows).toBe(4);
    expect(plan.grandRow).toBe(8);
    expect(plan.groups).toEqual([
      { value: "An", firstRow: 1, lastRow: 2, subtotalRow: 3 },
      { value: "Bình", firstRow: 4, lastRow: 4, subtotalRow: 5 },
      { value: "Chi", firstRow: 6, lastRow: 6, subtotalRow: 7 },
    ]);
    expect(plan.steps).toEqual(EXPECTED_STEPS);
  });

  it("offsets an off-origin list and lets a subtotalled change column keep its formula", () => {
    // List in C3:D5 (header row 2): groups x (rows 3-4), y (row 5).
    const plan = planSubtotal([[c("K"), c("V")], [c("x"), c(1)], [c("x"), c(2)], [c("y"), c(3)]],
      { changeColumn: 0, fn: "count", columns: [0, 1] }, { startRow: 2, startColumn: 2, endColumn: 3 }, TARGET, LABELS);
    if (typeof plan === "string") throw new Error(plan);
    expect(plan.steps.slice(0, 3)).toEqual([insert(6, 2, 3), insert(6, 2, 3), insert(5, 2, 3)]);
    const write = plan.steps[3]!.params as { value: Record<string, Record<string, unknown>> };
    expect(write.value).toEqual({
      "5": { "2": formula("=SUBTOTAL(3,C4:C5)"), "3": formula("=SUBTOTAL(3,D4:D5)") },
      "7": { "2": formula("=SUBTOTAL(3,C7:C7)"), "3": formula("=SUBTOTAL(3,D7:D7)") },
      "8": { "2": formula("=SUBTOTAL(3,C4:C8)"), "3": formula("=SUBTOTAL(3,D4:D8)") },
    });
    expect(plan.steps.slice(4)).toEqual([outline(3, 7), outline(3, 4), outline(6, 6)]);
  });

  it("refuses a header-only list, no subtotal column and a batch over the edit limit", () => {
    expect(planSubtotal([[c("Tên"), c("SL")]], { changeColumn: 0, fn: "sum", columns: [1] }, SPAN, TARGET, LABELS)).toBe("needRows");
    expect(planSubtotal(LIST, { changeColumn: 0, fn: "sum", columns: [] }, SPAN, TARGET, LABELS)).toBe("noColumns");
    const many = [[c("h"), c("v")], ...Array.from({ length: 4000 }, (_, index) => [c(index), c(index)])];
    expect(planSubtotal(many, { changeColumn: 0, fn: "sum", columns: [1] }, SPAN, TARGET, LABELS)).toBe("limitExceeded");
  });
});

const snapshot = (cells: Record<string, XlsxCellState>): XlsxWorkbookSnapshot => ({ revision: 1, sheets: [{ id: "sheet-1", name: "Data", cells }] });
const LIST_CELLS = { A1: c("Tên"), B1: c("SL"), A2: c("An"), B2: c(1), A3: c("an"), B3: c(2), A4: c("Bình"), B4: c(3), A5: c("Chi"), B5: c(4) };

function groupProps(overrides: Partial<XlsxToolbarGroupProps> = {}): XlsxToolbarGroupProps {
  return {
    readOnly: false,
    selection: { sheet: "Data", address: "A1", endAddress: "B5" },
    snapshot: snapshot(LIST_CELLS),
    canUndo: true, canRedo: true, canRecalculate: true, canFormat: true, recalculating: false,
    commands: { execute: vi.fn(() => true), executeAsOneStep: vi.fn(async () => true) },
    unitId: "file-sha",
    sheetName: "Data",
    resolveSheetId: () => "sheet-1",
    onUndo: vi.fn(), onRedo: vi.fn(), onNumberFormat: vi.fn(), onRecalculate: vi.fn(),
    onCopy: vi.fn(), onPaste: vi.fn(), onShowSheets: vi.fn(),
    ...overrides,
  };
}

function pick(labelKey: string, option: string) {
  fireEvent.click(screen.getByRole("combobox", { name: viText(labelKey) }));
  // Base UI's Select commits on the pointer sequence; a bare click does not.
  const item = screen.getByRole("option", { name: option });
  fireEvent.pointerDown(item);
  fireEvent.pointerUp(item);
  fireEvent.click(item);
}

describe("XlsxSubtotalButton", () => {
  it("runs the whole subtotal as ONE step with the planned inserts, write and outline", async () => {
    const props = groupProps();
    render(<XlsxSubtotalButton {...props} />);
    const button = screen.getByTestId("xlsx-subtotal");
    expect(button).toHaveTextContent(viText("office.xlsx.dataTools.subtotal"));
    fireEvent.click(button);
    expect(await screen.findByRole("heading", { name: viText("office.xlsx.dataTools.subtotalDialog.title") })).toBeInTheDocument();
    expect(screen.getByText(viText("office.xlsx.dataTools.subtotalDialog.note"))).toBeInTheDocument();
    // Columns read by their header; the last one is checked by default.
    expect(screen.getByTestId("xlsx-subtotal-col-1")).toHaveAccessibleName("SL");
    expect(screen.getByRole("combobox", { name: viText("office.xlsx.dataTools.subtotalDialog.atEachChange") })).toHaveTextContent("Tên");
    expect(screen.getByTestId("xlsx-subtotal-col-1")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId("xlsx-subtotal-col-0")).toHaveAttribute("aria-checked", "false");
    fireEvent.click(screen.getByTestId("xlsx-subtotal-apply"));
    const step = props.commands!.executeAsOneStep as ReturnType<typeof vi.fn>;
    await waitFor(() => expect(step).toHaveBeenCalledTimes(1));
    expect(step.mock.calls[0]![0]).toEqual(EXPECTED_STEPS);
    // F1: atomic, so a later refused step (the outline) takes the inserts back.
    expect(step.mock.calls[0]![1]).toEqual({ atomic: true });
    await waitFor(() => expect(screen.queryByTestId("xlsx-subtotal-dialog")).toBeNull());
  });

  it("plans at OK from the settled snapshot, after the queued grid edits, and fails when one failed (F3)", async () => {
    // A grid edit typed just before OK renamed A3 "an" to "Dung": a new group.
    const readLiveSnapshot = vi.fn(async () => snapshot({ ...LIST_CELLS, A3: c("Dung") }));
    const props = groupProps({ readLiveSnapshot });
    const view = render(<XlsxSubtotalButton {...props} />);
    fireEvent.click(screen.getByTestId("xlsx-subtotal"));
    fireEvent.click(await screen.findByTestId("xlsx-subtotal-apply"));
    const step = props.commands!.executeAsOneStep as ReturnType<typeof vi.fn>;
    await waitFor(() => expect(step).toHaveBeenCalledTimes(1));
    expect(readLiveSnapshot).toHaveBeenCalledTimes(1);
    expect(step.mock.calls[0]![0]).not.toEqual(EXPECTED_STEPS);
    expect(JSON.stringify(step.mock.calls[0]![0])).toContain("Dung");
    view.unmount();

    const failed = groupProps({ readLiveSnapshot: vi.fn(async () => { throw new Error("edit failed"); }) });
    render(<XlsxSubtotalButton {...failed} />);
    fireEvent.click(screen.getByTestId("xlsx-subtotal"));
    fireEvent.click(await screen.findByTestId("xlsx-subtotal-apply"));
    expect(await screen.findByTestId("xlsx-subtotal-error")).toHaveTextContent(viText("office.xlsx.dataTools.common.failed"));
    expect(failed.commands!.executeAsOneStep).not.toHaveBeenCalled();
  });

  it("labels the rows with the chosen function", async () => {
    const props = groupProps();
    render(<XlsxSubtotalButton {...props} />);
    fireEvent.click(screen.getByTestId("xlsx-subtotal"));
    await screen.findByTestId("xlsx-subtotal-apply");
    pick("office.xlsx.dataTools.subtotalDialog.useFunction", viText("office.xlsx.dataTools.subtotalDialog.functions.max"));
    fireEvent.click(screen.getByTestId("xlsx-subtotal-apply"));
    const step = props.commands!.executeAsOneStep as ReturnType<typeof vi.fn>;
    await waitFor(() => expect(step).toHaveBeenCalledTimes(1));
    const write = (step.mock.calls[0]![0] as { id: string; params: { value: Record<string, Record<string, unknown>> } }[])[4]!;
    expect(write.params.value["3"]).toEqual({ "0": labelCell("Lớn nhất An"), "1": formula("=SUBTOTAL(4,B2:B3)") });
    expect(write.params.value["8"]!["0"]).toEqual(labelCell("Lớn nhất chung"));
  });

  it("refuses a header-only list and no subtotal column, and reports a refused batch", async () => {
    const headerOnly = groupProps({ selection: { sheet: "Data", address: "A1", endAddress: "B1" } });
    const view = render(<XlsxSubtotalButton {...headerOnly} />);
    fireEvent.click(screen.getByTestId("xlsx-subtotal"));
    expect(await screen.findByTestId("xlsx-subtotal-error")).toHaveTextContent(viText("office.xlsx.dataTools.subtotalDialog.needRows"));
    expect(screen.getByTestId("xlsx-subtotal-apply")).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(screen.getByTestId("xlsx-subtotal-apply"));
    expect(headerOnly.commands!.executeAsOneStep).not.toHaveBeenCalled();
    view.unmount();

    const refused = groupProps({ commands: { execute: vi.fn(() => true), executeAsOneStep: vi.fn(async () => false) } });
    render(<XlsxSubtotalButton {...refused} />);
    fireEvent.click(screen.getByTestId("xlsx-subtotal"));
    fireEvent.click(await screen.findByTestId("xlsx-subtotal-col-1"));
    expect(screen.getByTestId("xlsx-subtotal-error")).toHaveTextContent(viText("office.xlsx.dataTools.subtotalDialog.noColumns"));
    fireEvent.click(screen.getByTestId("xlsx-subtotal-col-1"));
    fireEvent.click(screen.getByTestId("xlsx-subtotal-apply"));
    expect(await screen.findByTestId("xlsx-subtotal-error")).toHaveTextContent(viText("office.xlsx.dataTools.common.failed"));
    expect(screen.getByTestId("xlsx-subtotal-dialog")).toBeInTheDocument();
  });

  it("refuses a list taller than one save's edit budget without reading it", async () => {
    render(<XlsxSubtotalButton {...groupProps({ selection: { sheet: "Data", address: "A1", endAddress: "B20000" } })} />);
    fireEvent.click(screen.getByTestId("xlsx-subtotal"));
    expect(await screen.findByTestId("xlsx-subtotal-error")).toHaveTextContent("10000");
    expect(screen.queryByTestId("xlsx-subtotal-apply")).toBeNull();
  });

  it("stays focusable but inert read-only, without a live snapshot or without a selection", () => {
    for (const overrides of [{ readOnly: true }, { snapshot: null }, { selection: null }, { commands: undefined }] as Partial<XlsxToolbarGroupProps>[]) {
      const view = render(<XlsxSubtotalButton {...groupProps(overrides)} />);
      const button = screen.getByTestId("xlsx-subtotal");
      expect(button).not.toBeDisabled();
      expect(button).toHaveAttribute("aria-disabled", "true");
      fireEvent.click(button);
      expect(screen.queryByTestId("xlsx-subtotal-dialog")).toBeNull();
      view.unmount();
    }
  });
});
