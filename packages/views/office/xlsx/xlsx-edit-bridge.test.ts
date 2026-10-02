import { describe, expect, it } from "vitest";
import { rendererEditsToOperations } from "./xlsx-edit-bridge";

const sheets = [{ id: "sheet-1", name: "Data" }, { id: "sheet-2", name: "Summary" }];

describe("rendererEditsToOperations", () => {
  it("maps typed values and cross-sheet formulas without reparsing strings", () => {
    expect(rendererEditsToOperations(sheets, [
      { sheetId: "sheet-1", row: 0, column: 0, writeValue: true, value: "001" },
      { sheetId: "sheet-2", row: 1, column: 27, writeValue: true, value: null, formula: "=Data!A1*2" },
    ])).toEqual([
      { op: "set_cell", target: { sheet: "Data", cell: "A1" }, attributes: { value: "001" } },
      { op: "set_cell", target: { sheet: "Summary", cell: "AB2" }, attributes: { formula: "=Data!A1*2" } },
    ]);
  });

  it("keeps style-only operations separate from clears and copies the style", () => {
    const style = { font: { bold: true }, numFmt: "0.00" };
    const edits = rendererEditsToOperations(sheets, [
      { sheetId: "sheet-1", row: 3, column: 1, writeValue: false, value: null, style },
      { sheetId: "sheet-1", row: 4, column: 1, writeValue: true, value: null },
      { sheetId: "sheet-1", row: 5, column: 1, writeValue: true, value: null, styleReset: true },
    ]);
    expect(edits).toEqual([
      { op: "set_cell", target: { sheet: "Data", cell: "B4" }, style },
      { op: "clear_cell", target: { sheet: "Data", cell: "B5" } },
      { op: "set_cell", target: { sheet: "Data", cell: "B6" }, attributes: { value: null, styleReset: true } },
    ]);
    style.font.bold = false;
    expect(edits[0]?.style).toEqual({ font: { bold: true }, numFmt: "0.00" });
  });

  it("rejects a lost sheet identity and invalid coordinates before editing", () => {
    expect(() => rendererEditsToOperations(sheets, [{ sheetId: "removed", row: 0, column: 0, writeValue: true, value: 1 }])).toThrow("xlsx_edit_unknown_sheet");
    expect(() => rendererEditsToOperations(sheets, [{ sheetId: "sheet-1", row: -1, column: 0, writeValue: true, value: 1 }])).toThrow("xlsx_edit_outside_grid");
  });
});
