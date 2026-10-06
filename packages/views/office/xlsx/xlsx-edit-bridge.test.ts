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
      "set_hyperlink", "set_notes",
      "set_page_setup",
      "set_conditional_formats", "set_data_validations",
      "set_filter", "clear_filter",
      "clear_cell", "set_cell",
      "insert_rows", "remove_rows", "insert_cols", "remove_cols",
      "set_row_size", "set_col_size", "set_rows_hidden", "set_cols_hidden", "set_rows_outline", "set_cols_outline",
      "merge_cells", "unmerge_cells",
      "add_sheet", "duplicate_sheet", "remove_sheet", "rename_sheet", "reorder_sheet", "set_sheet_hidden",
      "create_table", "remove_table",
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
    expect(pick({ sheetId: "sheet-1", sheetName: "Sheet3", sheetOp: { kind: "add-sheet", index: 2 } })).toBe("add_sheet");
    expect(pick({ sheetId: "sheet-1", sheetName: "Copy", sheetOp: { kind: "duplicate-sheet", sourceSheetId: "sheet-1", sourceName: "Data", index: 1 } })).toBe("duplicate_sheet");
    expect(pick({ sheetId: "sheet-2", sheetName: "Summary", sheetOp: { kind: "remove-sheet" } })).toBe("remove_sheet");
    expect(pick({ sheetId: "sheet-1", sheetName: "Data", sheetOp: { kind: "rename-sheet", newName: "Budget" } })).toBe("rename_sheet");
    expect(pick({ sheetId: "sheet-1", sheetName: "Data", sheetOp: { kind: "reorder-sheet", index: 1 } })).toBe("reorder_sheet");
    expect(pick({ sheetId: "sheet-1", sheetName: "Data", sheetOp: { kind: "set-sheet-hidden", hidden: true } })).toBe("set_sheet_hidden");
    expect(pick({ sheetId: "sheet-1", setup: { orientation: "landscape" } })).toBe("set_page_setup");
    // A page-setup edit is never mistaken for a cell edit.
    expect(pick({ sheetId: "sheet-1", setup: { printArea: "A1:B2" } })).toBe("set_page_setup");
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

  it("maps filter journal edits onto the set/clear filter vocabulary", () => {
    const range = { startRow: 0, endRow: 4, startColumn: 0, endColumn: 2 };
    const visibilityRange = { startRow: 0, endRow: 6, startColumn: 0, endColumn: 2 };
    const filter = { range, columns: [{ colId: 0, values: ["alpha"] }, { colId: 2, customs: { and: true, filters: [{ val: 5, operator: "greaterThan" }] } }] };
    expect(rendererEditsToOperations(sheets, [
      { sheetId: "sheet-1", filter, hiddenRows: [1, 3], visibilityRange },
      { sheetId: "sheet-2", filter: null, hiddenRows: [], visibilityRange },
    ])).toEqual([
      { op: "set_filter", target: { sheet: "Data" }, attributes: { filter, hiddenRows: [1, 3], visibilityRange } },
      { op: "clear_filter", target: { sheet: "Summary" }, attributes: { visibilityRange } },
    ]);
    const [setOp, clearOp] = rendererEditsToOperations(sheets, [
      { sheetId: "sheet-1", filter, hiddenRows: [1], visibilityRange: range },
      { sheetId: "sheet-1", filter: null, hiddenRows: [], visibilityRange: range },
    ]);
    expect(Object.keys(setOp!)).toEqual(["op", "target", "attributes"]);
    expect(Object.keys(clearOp!)).toEqual(["op", "target", "attributes"]);
    expect(Object.keys((setOp as { attributes: Record<string, unknown> }).attributes)).toEqual(["filter", "hiddenRows", "visibilityRange"]);
    expect(Object.keys((clearOp as { attributes: Record<string, unknown> }).attributes)).toEqual(["visibilityRange"]);
    // A filter edit is never mistaken for a cell edit.
    const pick = (edit: XlsxGridEdit): string | undefined =>
      XLSX_JOURNAL_OP_MAPPINGS.find((entry) => entry.matches(edit))?.op;
    expect(pick({ sheetId: "sheet-1", filter, hiddenRows: [], visibilityRange: range })).toBe("set_filter");
    expect(pick({ sheetId: "sheet-1", filter: null, hiddenRows: [], visibilityRange: range })).toBe("clear_filter");
    // A live name wins over the host file's stale one for filter edits too.
    expect(rendererEditsToOperations(sheets, [
      { sheetId: "sheet-1", sheetName: "Budget", filter, hiddenRows: [], visibilityRange: range },
    ])).toEqual([
      { op: "set_filter", target: { sheet: "Budget" }, attributes: { filter, hiddenRows: [], visibilityRange: range } },
    ]);
  });

  it("maps sheet journal edits onto the sheet op vocabulary", () => {
    expect(rendererEditsToOperations(sheets, [
      { sheetId: "sheet-3", sheetName: "Scratch", sheetOp: { kind: "add-sheet", index: 0 } },
      { sheetId: "sheet-4", sheetName: "Data copy", sheetOp: { kind: "duplicate-sheet", sourceSheetId: "sheet-1", sourceName: "Data", index: 1 } },
      { sheetId: "sheet-2", sheetName: "Summary", sheetOp: { kind: "remove-sheet" } },
      { sheetId: "sheet-1", sheetName: "Data", sheetOp: { kind: "rename-sheet", newName: "Budget" } },
      { sheetId: "sheet-1", sheetName: "Budget", sheetOp: { kind: "reorder-sheet", index: 0 } },
      { sheetId: "sheet-1", sheetName: "Budget", sheetOp: { kind: "set-sheet-hidden", hidden: true } },
    ])).toEqual([
      { op: "add_sheet", attributes: { name: "Scratch", index: 0 } },
      { op: "duplicate_sheet", target: { sheet: "Data" }, attributes: { name: "Data copy", index: 1 } },
      { op: "remove_sheet", target: { sheet: "Summary" } },
      { op: "rename_sheet", target: { sheet: "Data" }, attributes: { newName: "Budget" } },
      { op: "reorder_sheet", target: { sheet: "Budget" }, attributes: { index: 0 } },
      { op: "set_sheet_hidden", target: { sheet: "Budget" }, attributes: { hidden: true } },
    ]);
    // Wire key order: op, [target], attributes; add_sheet has no target.
    const [addOp, renameOp] = rendererEditsToOperations(sheets, [
      { sheetId: "sheet-3", sheetName: "Scratch", sheetOp: { kind: "add-sheet", index: 0 } },
      { sheetId: "sheet-1", sheetName: "Data", sheetOp: { kind: "rename-sheet", newName: "Budget" } },
    ]);
    expect(Object.keys(addOp!)).toEqual(["op", "attributes"]);
    expect(Object.keys(renameOp!)).toEqual(["op", "target", "attributes"]);
  });

  it("prefers an edit's live sheet name over the host file's stale name", () => {
    expect(rendererEditsToOperations(sheets, [
      { sheetId: "sheet-1", sheetName: "Budget", row: 0, column: 0, writeValue: true, value: 1 },
      { sheetId: "sheet-1", sheetName: "Budget", structural: { kind: "insert-rows", index: 0, count: 1 } },
    ])).toEqual([
      { op: "set_cell", target: { sheet: "Budget", cell: "A1" }, attributes: { value: 1 } },
      { op: "insert_rows", target: { sheet: "Budget" }, attributes: { index: 0, count: 1 } },
    ]);
    // An added sheet has no host file entry at all; the live name carries it.
    expect(rendererEditsToOperations(sheets, [
      { sheetId: "added-1", sheetName: "Scratch", row: 2, column: 2, writeValue: true, value: "x" },
    ])).toEqual([{ op: "set_cell", target: { sheet: "Scratch", cell: "C3" }, attributes: { value: "x" } }]);
  });
  it("maps page-setup journal edits onto the set_page_setup vocabulary", () => {
    expect(rendererEditsToOperations(sheets, [
      { sheetId: "sheet-1", setup: { orientation: "landscape", margins: "narrow", printArea: "A1:C10" } },
      { sheetId: "sheet-2", sheetName: "Summary", setup: { printArea: null, printTitles: "1:2" } },
    ])).toEqual([
      { op: "set_page_setup", target: { sheet: "Data" }, attributes: { orientation: "landscape", margins: "narrow", printArea: "A1:C10" } },
      { op: "set_page_setup", target: { sheet: "Summary" }, attributes: { printArea: null, printTitles: "1:2" } },
    ]);
    // The mapped attributes preserve the field order the edit carried and stay
    // a plain (cloned) object so the host can serialize it verbatim.
    const [op] = rendererEditsToOperations(sheets, [
      { sheetId: "sheet-1", setup: { fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 } },
    ]);
    expect(Object.keys((op as { attributes: Record<string, unknown> }).attributes)).toEqual(["fitToPage", "fitToWidth", "fitToHeight", "paperSize"]);
    expect((op as { attributes: Record<string, unknown> }).attributes).toEqual({ fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 });
  });

  it("maps hyperlink journal edits onto the set_hyperlink vocabulary", () => {
    expect(rendererEditsToOperations(sheets, [
      { sheetId: "sheet-1", row: 1, column: 1, target: "https://example.com" },
      { sheetId: "sheet-1", sheetName: "Budget", row: 0, column: 0, target: null },
    ])).toEqual([
      { op: "set_hyperlink", target: { sheet: "Data" }, attributes: { cell: "B2", target: "https://example.com" } },
      { op: "set_hyperlink", target: { sheet: "Budget" }, attributes: { cell: "A1", target: null } },
    ]);
  });

  it("maps note journal edits onto the set_notes vocabulary", () => {
    expect(rendererEditsToOperations(sheets, [
      { sheetId: "sheet-1", notes: [{ row: 0, column: 1, author: "An", text: "x" }] },
      { sheetId: "sheet-2", sheetName: "Summary", notes: [] },
    ])).toEqual([
      { op: "set_notes", target: { sheet: "Data" }, attributes: { notes: [{ row: 0, column: 1, author: "An", text: "x" }] } },
      { op: "set_notes", target: { sheet: "Summary" }, attributes: { notes: [] } },
    ]);
  });
});
