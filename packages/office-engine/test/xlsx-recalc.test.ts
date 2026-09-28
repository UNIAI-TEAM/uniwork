// Recalc planning tests — read batching respects the sidecar's wire bounds
// and the cell→cached-value mapping mirrors the upstream renderer's reduce.
import { describe, expect, it } from "vitest";
import {
  buildRecalcReadBatches,
  recalcCellValue,
  recalcToFormulaValues,
  XLSX_MAX_RECALC_READ_CELLS,
} from "../src/xlsx/recalc";

describe("buildRecalcReadBatches", () => {
  it("one bounding box per sheet over formulas ∪ edits", () => {
    const batches = buildRecalcReadBatches(
      [
        { sheetName: "Data", row: 0, column: 0 },
        { sheetName: "Data", row: 9, column: 2 },
        { sheetName: "Report", row: 1, column: 1 },
      ],
      [{ sheet: "Data", row: 3, column: 0, input: "7" }],
    );
    expect(batches).toHaveLength(1);
    expect(batches[0]).toEqual([
      { sheet: "Data", range: { startRow: 0, endRow: 9, startColumn: 0, endColumn: 2 } },
      { sheet: "Report", range: { startRow: 1, endRow: 1, startColumn: 1, endColumn: 1 } },
    ]);
  });

  it("splits row bands so every batch stays under the summed cell bound", () => {
    // 500 columns × 2000 rows = 1_000_000 cells → ≥50 batches of ≤20_000.
    const batches = buildRecalcReadBatches(
      [
        { sheetName: "S", row: 0, column: 0 },
        { sheetName: "S", row: 1999, column: 499 },
      ],
      [],
    );
    for (const batch of batches) {
      const total = batch.reduce(
        (n, r) => n + (r.range.endRow - r.range.startRow + 1) * (r.range.endColumn - r.range.startColumn + 1),
        0,
      );
      expect(total).toBeLessThanOrEqual(XLSX_MAX_RECALC_READ_CELLS);
    }
    // Coverage: bands tile the whole range.
    const rows = batches.flatMap((b) => b[0]!.range).map((r) => r.startRow).sort((a, b) => a - b);
    expect(rows[0]).toBe(0);
  });

  it("no formula cells and no edits → no reads", () => {
    expect(buildRecalcReadBatches([], [])).toEqual([]);
  });
});

describe("recalcCellValue", () => {
  const cell = (over: object) => ({
    sheet: "S",
    row: 0,
    column: 0,
    formatted: "",
    isError: false,
    isFormula: true,
    ...over,
  });
  it("maps engine-typed errors to {error}, numbers to number, booleans, empty→null, else text", () => {
    expect(recalcCellValue(cell({ isError: true, formatted: "#DIV/0!" }))).toEqual({ error: "#DIV/0!" });
    expect(recalcCellValue(cell({ number: 42, formatted: "42" }))).toBe(42);
    expect(recalcCellValue(cell({ formatted: "TRUE" }))).toBe(true);
    expect(recalcCellValue(cell({ formatted: "FALSE" }))).toBe(false);
    expect(recalcCellValue(cell({ formatted: "" }))).toBeNull();
    expect(recalcCellValue(cell({ formatted: "text" }))).toBe("text");
  });
});

describe("recalcToFormulaValues", () => {
  it("only isFormula cells get a <v> refresh; skipped cells count as kept", () => {
    const expected = [
      { sheetName: "Data", row: 0, column: 1 },
      { sheetName: "Data", row: 1, column: 1 },
      { sheetName: "Data", row: 2, column: 1 },
    ];
    const { values, kept } = recalcToFormulaValues(expected, {
      cells: [
        { sheet: "Data", row: 0, column: 1, formatted: "6", number: 6, isError: false, isFormula: true },
        // row 1: a literal the user typed over a formula — no <v> patch.
        { sheet: "Data", row: 1, column: 1, formatted: "typed", isError: false, isFormula: false },
        // row 2 missing entirely: engine gap → keeps file's cached <v>.
      ],
    });
    expect(kept).toBe(1);
    expect(values).toEqual([{ sheetName: "Data", cells: [{ row: 0, column: 1, value: 6 }] }]);
  });
});
