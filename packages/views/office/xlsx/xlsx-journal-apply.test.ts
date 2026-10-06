import { describe, expect, it } from "vitest";
import type { XlsxWorkbookSnapshot } from "@uniwork/office-engine/xlsx";
import { applyXlsxJournalToSnapshot, diffXlsxSnapshotsToOperations } from "./xlsx-journal-apply";

const base = (): XlsxWorkbookSnapshot => ({ revision: 0, sheets: [{ id: "sheet-1", name: "Data", cells: { A1: { value: 2 }, B1: { value: 4, formula: "=A1*2" } } }] });

describe("applyXlsxJournalToSnapshot", () => {
  it("writes values and formulas and clears cells", () => {
    const next = applyXlsxJournalToSnapshot(base(), [
      { op: "set_cell", target: { sheet: "Data", cell: "A1" }, attributes: { value: 7 } },
      { op: "set_cell", target: { sheet: "Data", cell: "C3" }, attributes: { formula: "=A1+B1" } },
      { op: "clear_cell", target: { sheet: "Data", cell: "B1" } },
    ]);
    expect(next.revision).toBe(1);
    expect(next.sheets[0]?.cells).toEqual({ A1: { value: 7 }, C3: { value: null, formula: "=A1+B1" } });
  });

  it("keeps the value under a style-only edit and records the delta", () => {
    const next = applyXlsxJournalToSnapshot(base(), [{ op: "set_cell", target: { sheet: "Data", cell: "A1" }, style: { bold: true } }]);
    expect(next.sheets[0]?.cells.A1).toEqual({ value: 2, style: { bold: true } });
  });

  it("applies a rename before a later op targets the new name", () => {
    const next = applyXlsxJournalToSnapshot(base(), [
      { op: "rename_sheet", target: { sheet: "Data" }, attributes: { newName: "Budget" } },
      { op: "set_cell", target: { sheet: "Budget", cell: "A1" }, attributes: { value: 9 } },
    ]);
    expect(next.sheets[0]?.name).toBe("Budget");
    expect(next.sheets[0]?.cells.A1).toEqual({ value: 9 });
  });

  it("adds a sheet at its index and leaves structural ops to the server envelope", () => {
    const next = applyXlsxJournalToSnapshot(base(), [
      { op: "add_sheet", attributes: { name: "Summary" } },
      { op: "insert_rows", target: { sheet: "Data" }, attributes: { index: 0, count: 1 } },
    ]);
    expect(next.sheets.map((sheet) => sheet.name)).toEqual(["Data", "Summary"]);
    expect(next.sheets[0]?.cells.A1).toEqual({ value: 2 });
  });
});

describe("diffXlsxSnapshotsToOperations", () => {
  it("round-trips a value change and a clear back to bounded set/clear ops", () => {
    const next = applyXlsxJournalToSnapshot(base(), [
      { op: "set_cell", target: { sheet: "Data", cell: "A1" }, attributes: { value: 7 } },
      { op: "clear_cell", target: { sheet: "Data", cell: "B1" } },
    ]);
    const operations = diffXlsxSnapshotsToOperations(base(), next);
    expect(operations).toContainEqual({ op: "set_cell", target: { sheet: "Data", cell: "A1" }, attributes: { value: 7 } });
    expect(operations).toContainEqual({ op: "clear_cell", target: { sheet: "Data", cell: "B1" } });
    expect(applyXlsxJournalToSnapshot(base(), operations).sheets).toEqual(next.sheets);
  });

  it("ignores rule-set ops: they do not throw and leave the cells unchanged", () => {
    const area = { startRow: 1, endRow: 9, startColumn: 0, endColumn: 0 };
    const next = applyXlsxJournalToSnapshot(base(), [
      { op: "set_conditional_formats", target: { sheet: "Data" }, attributes: { rules: [{ ranges: [area], stopIfTrue: false, rule: { type: "highlightCell", subType: "number", operator: "greaterThan", value: 10, style: { bg: { rgb: "#FFC7CE" } } } }] } },
      { op: "set_data_validations", target: { sheet: "Data" }, attributes: { rules: [{ ranges: [area], rule: { uid: "dv-1", type: "list", formula1: "Yes,No", allowBlank: true } }] } },
    ]);
    expect(next.sheets).toEqual(base().sheets);
  });
});
