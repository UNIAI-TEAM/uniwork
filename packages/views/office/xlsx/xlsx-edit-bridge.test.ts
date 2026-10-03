import { describe, expect, it } from "vitest";
import { rendererEditsToOperations, XLSX_JOURNAL_OP_MAPPINGS, type XlsxGridEdit } from "./xlsx-edit-bridge";

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
    expect(edits[0]).toMatchObject({ style: { font: { bold: true }, numFmt: "0.00" } });
  });

  it("rejects a lost sheet identity and invalid coordinates before editing", () => {
    expect(() => rendererEditsToOperations(sheets, [{ sheetId: "removed", row: 0, column: 0, writeValue: true, value: 1 }])).toThrow("xlsx_edit_unknown_sheet");
    expect(() => rendererEditsToOperations(sheets, [{ sheetId: "sheet-1", row: -1, column: 0, writeValue: true, value: 1 }])).toThrow("xlsx_edit_outside_grid");
  });

  it("pins the wire key order of the mapped operations", () => {
    const [setOp, clearOp] = rendererEditsToOperations(sheets, [
      { sheetId: "sheet-1", row: 0, column: 0, writeValue: true, value: 7 },
      { sheetId: "sheet-1", row: 1, column: 0, writeValue: true, value: null },
    ]);
    expect(Object.keys(setOp!)).toEqual(["op", "target", "attributes"]);
    expect(Object.keys(clearOp!)).toEqual(["op", "target"]);
    const [styled] = rendererEditsToOperations(sheets, [
      { sheetId: "sheet-1", row: 2, column: 0, writeValue: true, value: 1, style: { bold: true } },
    ]);
    expect(Object.keys(styled!)).toEqual(["op", "target", "attributes", "style"]);
  });

  it("selects the op kind through the named registry entries", () => {
    expect(XLSX_JOURNAL_OP_MAPPINGS.map((entry) => entry.op)).toEqual([
      "clear_cell", "set_cell",
      "insert_rows", "remove_rows", "insert_cols", "remove_cols",
      "set_row_size", "set_col_size", "set_rows_hidden", "set_cols_hidden", "set_rows_outline", "set_cols_outline",
      "merge_cells", "unmerge_cells",
    ]);
    const pick = (edit: XlsxGridEdit): string | undefined =>
      XLSX_JOURNAL_OP_MAPPINGS.find((entry) => entry.matches(edit))?.op;
    expect(pick({ sheetId: "sheet-1", row: 0, column: 0, writeValue: true, value: null })).toBe("clear_cell");
    expect(pick({ sheetId: "sheet-1", row: 0, column: 0, writeValue: true, value: "x" })).toBe("set_cell");
    expect(pick({ sheetId: "sheet-1", row: 0, column: 0, writeValue: false, value: null, style: { bold: true } })).toBe("set_cell");
    // A clear carrying a style is a style edit, never a clear.
    expect(pick({ sheetId: "sheet-1", row: 0, column: 0, writeValue: true, value: null, style: { bold: true } })).toBe("set_cell");
    expect(pick({ sheetId: "sheet-1", structural: { kind: "insert-rows", index: 3, count: 2 } })).toBe("insert_rows");
    expect(pick({ sheetId: "sheet-1", structural: { kind: "set-cols-outline", start: 0, end: 2, level: 1 } })).toBe("set_cols_outline");
    expect(pick({ sheetId: "sheet-1", structural: { kind: "merge-cells", range: { startRow: 0, endRow: 1, startColumn: 0, endColumn: 1 } } })).toBe("merge_cells");
    expect(pick({ sheetId: "sheet-1", structural: { kind: "unmerge-cells", range: { startRow: 0, endRow: 1, startColumn: 0, endColumn: 1 } } })).toBe("unmerge_cells");
  });

  it("maps merge journal edits onto the envelope's own range field", () => {
    expect(rendererEditsToOperations(sheets, [
      { sheetId: "sheet-1", structural: { kind: "merge-cells", range: { startRow: 0, endRow: 1, startColumn: 0, endColumn: 2 } } },
      { sheetId: "sheet-2", structural: { kind: "unmerge-cells", range: { startRow: 2, endRow: 2, startColumn: 3, endColumn: 4 } } },
    ])).toEqual([
      { op: "merge_cells", target: { sheet: "Data" }, range: { startRow: 0, endRow: 1, startColumn: 0, endColumn: 2 } },
      { op: "unmerge_cells", target: { sheet: "Summary" }, range: { startRow: 2, endRow: 2, startColumn: 3, endColumn: 4 } },
    ]);
    const [mergeOp] = rendererEditsToOperations(sheets, [
      { sheetId: "sheet-1", structural: { kind: "merge-cells", range: { startRow: 0, endRow: 0, startColumn: 0, endColumn: 1 } } },
    ]);
    expect(Object.keys(mergeOp!)).toEqual(["op", "target", "range"]);
  });

  it("maps structural journal edits onto the attributes wire shape", () => {
    expect(rendererEditsToOperations(sheets, [
      { sheetId: "sheet-1", structural: { kind: "insert-rows", index: 3, count: 2 } },
      { sheetId: "sheet-2", structural: { kind: "remove-cols", index: 1, count: 1 } },
      { sheetId: "sheet-1", structural: { kind: "set-row-size", start: 0, end: 2, size: 24.5 } },
      { sheetId: "sheet-1", structural: { kind: "set-col-size", start: 2, end: 2, size: null } },
      { sheetId: "sheet-1", structural: { kind: "set-rows-hidden", start: 4, end: 4, hidden: true } },
      { sheetId: "sheet-1", structural: { kind: "set-cols-hidden", start: 0, end: 0, hidden: false } },
      { sheetId: "sheet-1", structural: { kind: "set-rows-outline", start: 1, end: 3, level: 2, collapsed: true } },
      { sheetId: "sheet-1", structural: { kind: "set-cols-outline", start: 0, end: 1, level: 0 } },
    ])).toEqual([
      { op: "insert_rows", target: { sheet: "Data" }, attributes: { index: 3, count: 2 } },
      { op: "remove_cols", target: { sheet: "Summary" }, attributes: { index: 1, count: 1 } },
      { op: "set_row_size", target: { sheet: "Data" }, attributes: { start: 0, end: 2, size: 24.5 } },
      { op: "set_col_size", target: { sheet: "Data" }, attributes: { start: 2, end: 2, size: null } },
      { op: "set_rows_hidden", target: { sheet: "Data" }, attributes: { start: 4, end: 4, hidden: true } },
      { op: "set_cols_hidden", target: { sheet: "Data" }, attributes: { start: 0, end: 0, hidden: false } },
      { op: "set_rows_outline", target: { sheet: "Data" }, attributes: { start: 1, end: 3, level: 2, collapsed: true } },
      { op: "set_cols_outline", target: { sheet: "Data" }, attributes: { start: 0, end: 1, level: 0 } },
    ]);
    // Key order stays op, target, attributes; an omitted collapsed must not
    // materialize as a key (the gateway leaves the file flag untouched).
    const keyOrdered = rendererEditsToOperations(sheets, [
      { sheetId: "sheet-1", structural: { kind: "insert-rows", index: 0, count: 1 } },
      { sheetId: "sheet-1", structural: { kind: "set-row-size", start: 0, end: 0, size: 12 } },
      { sheetId: "sheet-1", structural: { kind: "set-col-size", start: 0, end: 0, size: 12 } },
      { sheetId: "sheet-1", structural: { kind: "set-rows-hidden", start: 0, end: 0, hidden: true } },
      { sheetId: "sheet-1", structural: { kind: "set-cols-hidden", start: 0, end: 0, hidden: true } },
      { sheetId: "sheet-1", structural: { kind: "set-rows-outline", start: 0, end: 0, level: 1 } },
      { sheetId: "sheet-1", structural: { kind: "set-cols-outline", start: 0, end: 0, level: 1 } },
      { sheetId: "sheet-1", structural: { kind: "set-rows-outline", start: 0, end: 0, level: 0 } },
    ]);
    expect(Object.keys(keyOrdered[0]!)).toEqual(["op", "target", "attributes"]);
    expect(Object.keys(keyOrdered[7]!)).toEqual(["op", "target", "attributes"]);
    expect((keyOrdered[7] as { attributes: Record<string, unknown> }).attributes).toEqual({ start: 0, end: 0, level: 0 });
  });
});
