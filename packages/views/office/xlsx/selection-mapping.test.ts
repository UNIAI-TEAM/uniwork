import { describe, expect, it } from "vitest";
import { XLSX_RANGE_TYPE, xlsxSelectionFromGrid } from "./selection-mapping";

describe("xlsxSelectionFromGrid", () => {
  it("maps a single cell to its A1 address without an end", () => {
    expect(xlsxSelectionFromGrid("Data", { startRow: 1, endRow: 1, startColumn: 2, endColumn: 2 })).toEqual({
      sheet: "Data", address: "C2",
    });
  });

  it("maps a range to its corners and carries Univer's range type", () => {
    expect(xlsxSelectionFromGrid("Data", {
      startRow: 0, endRow: 999, startColumn: 1, endColumn: 2, rangeType: XLSX_RANGE_TYPE.COLUMN,
    })).toEqual({ sheet: "Data", address: "B1", endAddress: "C1000", rangeType: XLSX_RANGE_TYPE.COLUMN });
    expect(xlsxSelectionFromGrid("Data", { startRow: 0, endRow: 4, startColumn: 0, endColumn: 25, rangeType: 0 }))
      .toEqual({ sheet: "Data", address: "A1", endAddress: "Z5", rangeType: XLSX_RANGE_TYPE.NORMAL });
  });

  it("carries the renderer's one-merged-cell flag and nothing else for an ordinary range", () => {
    expect(xlsxSelectionFromGrid("Data", { startRow: 0, endRow: 1, startColumn: 0, endColumn: 1, merged: true }))
      .toEqual({ sheet: "Data", address: "A1", endAddress: "B2", merged: true });
    expect(xlsxSelectionFromGrid("Data", { startRow: 0, endRow: 1, startColumn: 0, endColumn: 1 }))
      .toEqual({ sheet: "Data", address: "A1", endAddress: "B2" });
  });

  it("drops a range type outside Univer's four values", () => {
    expect(xlsxSelectionFromGrid("Data", { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0, rangeType: 7 }))
      .toEqual({ sheet: "Data", address: "A1" });
  });
});
