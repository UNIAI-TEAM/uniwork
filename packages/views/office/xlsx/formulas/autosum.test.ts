import { describe, expect, it } from "vitest";
import type { RendererRangeCell } from "../xlsx-render-model-bridge";
import type { XlsxSelection } from "../types";
import {
  autoSumFormula,
  autoSumReadWindow,
  autoSumSheetPrefix,
  buildAutoSumCommand,
  buildAutoSumRange,
  isNumericCellValue,
  XLSX_AUTOSUM_COMMAND,
  XLSX_AUTOSUM_GUESS_MAX,
  type XlsxAutoSumCell,
} from "./autosum";

const selection = (address: string, endAddress?: string): XlsxSelection => ({
  sheet: "Data",
  address,
  ...(endAddress === undefined ? {} : { endAddress }),
});

const cells = (list: [number, number, RendererRangeCell["value"]][]): XlsxAutoSumCell[] =>
  list.map(([row, column, value]) => ({ row, column, value }));

const bounds = { rowCount: 100, columnCount: 26 };

describe("isNumericCellValue", () => {
  it("counts only finite numbers as summable", () => {
    expect(isNumericCellValue(3)).toBe(true);
    expect(isNumericCellValue(0)).toBe(true);
    expect(isNumericCellValue("3")).toBe(false);
    expect(isNumericCellValue(true)).toBe(false);
    expect(isNumericCellValue(null)).toBe(false);
    expect(isNumericCellValue(Number.NaN)).toBe(false);
    expect(isNumericCellValue(Number.POSITIVE_INFINITY)).toBe(false);
  });
});

describe("buildAutoSumRange", () => {
  it("guesses the contiguous numeric block directly above a single cell", () => {
    const range = buildAutoSumRange(cells([[0, 0, 1], [1, 0, 2], [2, 0, 3]]), selection("A4"), bounds);
    expect(range).toEqual({
      startRow: 0, endRow: 2, startColumn: 0, endColumn: 0,
      targetRow: 3, targetColumn: 0, kind: "guess-above",
    });
  });

  it("stops the guess at the first non-numeric cell above", () => {
    const range = buildAutoSumRange(cells([[0, 0, 1], [1, 0, "x"], [2, 0, 3]]), selection("A4"), bounds);
    expect(range?.startRow).toBe(2);
    expect(range?.endRow).toBe(2);
    expect(range?.kind).toBe("guess-above");
  });

  it("falls back to the numeric block to the left when the column above is empty", () => {
    const range = buildAutoSumRange(cells([[0, 0, 1], [0, 1, 2]]), selection("C1"), bounds);
    expect(range).toEqual({
      startRow: 0, endRow: 0, startColumn: 0, endColumn: 1,
      targetRow: 0, targetColumn: 2, kind: "guess-left",
    });
  });

  it("prefers the block above over the block to the left", () => {
    const range = buildAutoSumRange(cells([[0, 1, 1], [1, 1, 2], [1, 0, 9]]), selection("B2"), bounds);
    expect(range?.kind).toBe("guess-above");
    expect(range?.startColumn).toBe(1);
    expect(range?.endRow).toBe(0);
  });

  it("does nothing when neither direction holds a number", () => {
    expect(buildAutoSumRange(cells([[0, 0, "x"]]), selection("A3"), bounds)).toBeNull();
    expect(buildAutoSumRange([], selection("A1"), bounds)).toBeNull();
    expect(buildAutoSumRange(cells([[0, 0, 1]]), { sheet: "Data", address: "not-a-cell" }, bounds)).toBeNull();
  });

  it("caps one guess direction", () => {
    const tall: [number, number, RendererRangeCell["value"]][] = [];
    for (let row = 0; row < XLSX_AUTOSUM_GUESS_MAX + 5; row += 1) tall.push([row, 0, 1]);
    const range = buildAutoSumRange(cells(tall), selection(`A${XLSX_AUTOSUM_GUESS_MAX + 6}`), bounds);
    expect(range?.endRow).toBe(XLSX_AUTOSUM_GUESS_MAX + 4);
    expect(range?.startRow).toBe(5);
  });

  it("sums a multi-cell selection below it, and a single row to its right", () => {
    expect(buildAutoSumRange([], selection("A1", "A3"), bounds)).toEqual({
      startRow: 0, endRow: 2, startColumn: 0, endColumn: 0,
      targetRow: 3, targetColumn: 0, kind: "selection",
    });
    expect(buildAutoSumRange([], selection("A1", "C1"), bounds)).toEqual({
      startRow: 0, endRow: 0, startColumn: 0, endColumn: 2,
      targetRow: 0, targetColumn: 3, kind: "selection",
    });
  });

  it("refuses a single-row selection whose result would land past the used columns", () => {
    expect(buildAutoSumRange([], selection("Y1", "Z1"), { rowCount: 10, columnCount: 26 })).toBeNull();
  });
});

describe("autoSumReadWindow", () => {
  it("pads the selection above and left by the guess bound, clipped to the used bounds", () => {
    expect(autoSumReadWindow(selection("C5"), bounds)).toEqual({
      startRow: 0, endRow: 4, startColumn: 0, endColumn: 2,
    });
    expect(autoSumReadWindow(selection("A1", "B2"), bounds)).toEqual({
      startRow: 0, endRow: 1, startColumn: 0, endColumn: 1,
    });
    expect(autoSumReadWindow({ sheet: "Data", address: "??" }, bounds)).toBeNull();
  });
});

describe("autoSumFormula / buildAutoSumCommand", () => {
  const range = {
    startRow: 0, endRow: 2, startColumn: 0, endColumn: 0,
    targetRow: 3, targetColumn: 0, kind: "guess-above" as const,
  };

  it("writes an absolute SUM over the sheet-qualified range", () => {
    expect(autoSumFormula(range, "Data")).toBe("=SUM(Data!A1:A3)");
    expect(autoSumSheetPrefix("Data")).toBe("Data!");
    expect(autoSumSheetPrefix("My Sheet")).toBe("'My Sheet'!");
    expect(autoSumSheetPrefix("it's")).toBe("'it''s'!");
    expect(autoSumFormula({ ...range, startColumn: 1, endColumn: 1 }, "Data")).toBe("=SUM(Data!B1:B3)");
  });

  it("builds the allowlisted set-range-values payload with one formula cell", () => {
    const command = buildAutoSumCommand(range, "sheet-1", "file-abc", "Data");
    expect(command.id).toBe(XLSX_AUTOSUM_COMMAND);
    expect(command.params).toEqual({
      unitId: "file-abc",
      subUnitId: "sheet-1",
      value: { "3": { "0": { f: "=SUM(Data!A1:A3)" } } },
    });
  });
});
