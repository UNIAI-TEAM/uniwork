import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { XlsxCellState, XlsxWorkbookSnapshot } from "@uniwork/office-engine/xlsx";
import viLocale from "@uniwork/core/i18n/locales/vi.json";
import type { XlsxToolbarGroupProps } from "../types";
import { XlsxRemoveDuplicatesButton } from "./remove-duplicates-dialog";
import { planRemoveDuplicates } from "./remove-duplicates";
import { scalarCellData } from "./range-values";

const viText = (key: string): string => {
  const value = key.split(".").reduce<unknown>((node, part) =>
    node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined, viLocale);
  if (typeof value !== "string") throw new Error(`missing vi key ${key}`);
  return value;
};

const c = (value: XlsxCellState["value"], formula?: string): XlsxCellState => (formula ? { value, formula } : { value });

describe("planRemoveDuplicates", () => {
  it("keeps the first of each duplicate row, moves the rest up and empties the freed rows", () => {
    const plan = planRemoveDuplicates(
      [[c("Tên"), c("SL")], [c("An"), c(1)], [c("an"), c(1)], [c("Bình"), c(2)], [c("An"), c(1)]],
      { hasHeader: true, columns: [0, 1] },
    );
    if (typeof plan === "string") throw new Error(plan);
    expect(plan.removed).toBe(2);
    expect(plan.kept).toBe(2);
    expect(plan.values).toEqual([
      [scalarCellData("Tên"), scalarCellData("SL")],
      [scalarCellData("An"), scalarCellData(1)],
      [scalarCellData("Bình"), scalarCellData(2)],
      [scalarCellData(null), scalarCellData(null)],
      [scalarCellData(null), scalarCellData(null)],
    ]);
  });

  it("compares only the chosen columns and keeps a text '12' apart from the number 12", () => {
    const rows = [[c("x"), c(12)], [c("y"), c("12")], [c("z"), c(12)]];
    const byNumber = planRemoveDuplicates(rows, { hasHeader: false, columns: [1] });
    if (typeof byNumber === "string") throw new Error(byNumber);
    expect(byNumber.removed).toBe(1);
    expect(byNumber.values[1]).toEqual([scalarCellData("y"), scalarCellData("12")]);
    const byFirst = planRemoveDuplicates(rows, { hasHeader: false, columns: [0] });
    expect(typeof byFirst !== "string" && byFirst.removed).toBe(0);
  });

  it("refuses formulas, a single row and no compared column", () => {
    expect(planRemoveDuplicates([[c(1)], [c(2, "=A1+1")]], { hasHeader: false, columns: [0] })).toBe("formulas");
    expect(planRemoveDuplicates([[c(1)]], { hasHeader: false, columns: [0] })).toBe("needRows");
    expect(planRemoveDuplicates([[c(1)], [c(1)]], { hasHeader: false, columns: [] })).toBe("noColumns");
  });

  it("plans over the used rows only: trailing blank rows are no duplicates and stay untouched (F4)", () => {
    const column = [[c("a")], [c("b")], [c("A")], ...Array.from({ length: 997 }, () => [null]), [c("")]];
    const plan = planRemoveDuplicates(column, { hasHeader: false, columns: [0] });
    if (typeof plan === "string") throw new Error(plan);
    expect(plan).toMatchObject({ removed: 1, kept: 2 });
    expect(plan.values).toHaveLength(3);
    // A blank row inside the used range still counts (Excel does the same).
    const inside = planRemoveDuplicates([[c("a")], [null], [null], [c("b")], [null]], { hasHeader: false, columns: [0] });
    expect(inside).toMatchObject({ removed: 1, kept: 3 });
    expect(planRemoveDuplicates([[c("a")], [null], [null]], { hasHeader: false, columns: [0] })).toBe("needRows");
  });
});

const snapshot = (cells: Record<string, XlsxCellState>): XlsxWorkbookSnapshot => ({ revision: 1, sheets: [{ id: "sheet-1", name: "Data", cells }] });

function groupProps(overrides: Partial<XlsxToolbarGroupProps> = {}): XlsxToolbarGroupProps {
  return {
    readOnly: false,
    selection: { sheet: "Data", address: "A1", endAddress: "B4" },
    snapshot: snapshot({ A1: c("Tên"), B1: c("SL"), A2: c("An"), B2: c(1), A3: c("An"), B3: c(1), A4: c("Chi"), B4: c(3) }),
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

describe("XlsxRemoveDuplicatesButton", () => {
  it("removes duplicates over the header-aware selection in ONE step and reports Excel's message", async () => {
    const props = groupProps();
    render(<XlsxRemoveDuplicatesButton {...props} />);
    const button = screen.getByTestId("xlsx-remove-duplicates");
    expect(button).toHaveTextContent(viText("office.xlsx.dataTools.removeDuplicates"));
    fireEvent.click(button);
    expect(await screen.findByRole("heading", { name: viText("office.xlsx.dataTools.removeDuplicatesDialog.title") })).toBeInTheDocument();
    // Without headers the columns read "Cột A"/"Cột B"; with headers, the header text.
    expect(screen.getByText("Cột A")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("xlsx-remove-duplicates-header"));
    expect(screen.getByText("Tên")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("xlsx-remove-duplicates-apply"));
    const step = props.commands!.executeAsOneStep as ReturnType<typeof vi.fn>;
    await waitFor(() => expect(step).toHaveBeenCalledTimes(1));
    expect(step.mock.calls[0]![0]).toEqual([{
      id: "sheet.command.set-range-values",
      params: {
        unitId: "file-sha",
        subUnitId: "sheet-1",
        range: { startRow: 0, endRow: 3, startColumn: 0, endColumn: 1 },
        value: {
          "0": { "0": scalarCellData("Tên"), "1": scalarCellData("SL") },
          "1": { "0": scalarCellData("An"), "1": scalarCellData(1) },
          "2": { "0": scalarCellData("Chi"), "1": scalarCellData(3) },
          "3": { "0": scalarCellData(null), "1": scalarCellData(null) },
        },
      },
    }]);
    // F1: atomic, so a refused write leaves nothing behind.
    expect(step.mock.calls[0]![1]).toEqual({ atomic: true });
    expect(await screen.findByTestId("xlsx-remove-duplicates-result")).toHaveTextContent("Đã tìm thấy và xóa 1 giá trị trùng lặp; còn lại 2 giá trị duy nhất.");
  });

  it("plans at OK from the settled snapshot, after the queued grid edits, and fails when one failed (F3)", async () => {
    // The dialog opened on the stale snapshot (A3 = "An"); a grid edit typed
    // just before made A3 "Binh", so nothing repeats and nothing is written.
    const settled = snapshot({ A1: c("Tên"), B1: c("SL"), A2: c("An"), B2: c(1), A3: c("Binh"), B3: c(1), A4: c("Chi"), B4: c(3) });
    const readLiveSnapshot = vi.fn(async () => settled);
    const props = groupProps({ readLiveSnapshot });
    const view = render(<XlsxRemoveDuplicatesButton {...props} />);
    fireEvent.click(screen.getByTestId("xlsx-remove-duplicates"));
    fireEvent.click(await screen.findByTestId("xlsx-remove-duplicates-apply"));
    expect(await screen.findByTestId("xlsx-remove-duplicates-result")).toHaveTextContent(viText("office.xlsx.dataTools.removeDuplicatesDialog.resultNone"));
    expect(readLiveSnapshot).toHaveBeenCalledTimes(1);
    expect(props.commands!.executeAsOneStep).not.toHaveBeenCalled();
    view.unmount();

    const failed = groupProps({ readLiveSnapshot: vi.fn(async () => { throw new Error("edit failed"); }) });
    render(<XlsxRemoveDuplicatesButton {...failed} />);
    fireEvent.click(screen.getByTestId("xlsx-remove-duplicates"));
    fireEvent.click(await screen.findByTestId("xlsx-remove-duplicates-apply"));
    expect(await screen.findByTestId("xlsx-remove-duplicates-result")).toHaveTextContent(viText("office.xlsx.dataTools.common.failed"));
    expect(failed.commands!.executeAsOneStep).not.toHaveBeenCalled();
  });

  it("writes nothing when there is no duplicate, and says so", async () => {
    const props = groupProps({ snapshot: snapshot({ A1: c("a"), A2: c("b") }), selection: { sheet: "Data", address: "A1", endAddress: "A2" } });
    render(<XlsxRemoveDuplicatesButton {...props} />);
    fireEvent.click(screen.getByTestId("xlsx-remove-duplicates"));
    fireEvent.click(await screen.findByTestId("xlsx-remove-duplicates-apply"));
    expect(await screen.findByTestId("xlsx-remove-duplicates-result")).toHaveTextContent(viText("office.xlsx.dataTools.removeDuplicatesDialog.resultNone"));
    expect(props.commands!.executeAsOneStep).not.toHaveBeenCalled();
  });

  it("refuses formulas and unchecked columns with a notice, and reports a refused write", async () => {
    const formulas = groupProps({ snapshot: snapshot({ A1: c(1), A2: c(1, "=A1") }), selection: { sheet: "Data", address: "A1", endAddress: "A2" } });
    const view = render(<XlsxRemoveDuplicatesButton {...formulas} />);
    fireEvent.click(screen.getByTestId("xlsx-remove-duplicates"));
    expect(await screen.findByTestId("xlsx-remove-duplicates-error")).toHaveTextContent(viText("office.xlsx.dataTools.removeDuplicatesDialog.formulas"));
    expect(screen.getByTestId("xlsx-remove-duplicates-apply")).toHaveAttribute("aria-disabled", "true");
    view.unmount();

    const refused = groupProps({ commands: { execute: vi.fn(() => true), executeAsOneStep: vi.fn(async () => false) } });
    render(<XlsxRemoveDuplicatesButton {...refused} />);
    fireEvent.click(screen.getByTestId("xlsx-remove-duplicates"));
    fireEvent.click(await screen.findByText(viText("office.xlsx.dataTools.removeDuplicatesDialog.unselectAll")));
    expect(screen.getByTestId("xlsx-remove-duplicates-error")).toHaveTextContent(viText("office.xlsx.dataTools.removeDuplicatesDialog.noColumns"));
    fireEvent.click(screen.getByText(viText("office.xlsx.dataTools.removeDuplicatesDialog.selectAll")));
    fireEvent.click(screen.getByTestId("xlsx-remove-duplicates-apply"));
    expect(await screen.findByTestId("xlsx-remove-duplicates-result")).toHaveTextContent(viText("office.xlsx.dataTools.common.failed"));
  });

  it("refuses a selection above the per-save edit limit", async () => {
    render(<XlsxRemoveDuplicatesButton {...groupProps({ selection: { sheet: "Data", address: "A1", endAddress: "K1000" } })} />);
    fireEvent.click(screen.getByTestId("xlsx-remove-duplicates"));
    expect(await screen.findByTestId("xlsx-remove-duplicates-error")).toHaveTextContent("10000");
  });

  it("stays inert read-only, without a live snapshot or without a selection", () => {
    for (const overrides of [{ readOnly: true }, { snapshot: null }, { selection: null }] as Partial<XlsxToolbarGroupProps>[]) {
      const view = render(<XlsxRemoveDuplicatesButton {...groupProps(overrides)} />);
      const button = screen.getByTestId("xlsx-remove-duplicates");
      expect(button).toHaveAttribute("aria-disabled", "true");
      fireEvent.click(button);
      expect(screen.queryByTestId("xlsx-remove-duplicates-dialog")).toBeNull();
      view.unmount();
    }
  });
});
