import { describe, expect, it } from "vitest";
import {
  selectionSortRange,
  sortAffectedCellCount,
  sortCommandParams,
  sortRangeIsSortable,
  sortWithinOpLimit,
  XLSX_SORT_MAX_OPS,
  type XlsxSortRange,
} from "./sort-commands";

const range = (startRow: number, endRow: number, startColumn: number, endColumn: number): XlsxSortRange => ({
  startRow,
  endRow,
  startColumn,
  endColumn,
});

describe("sortAffectedCellCount", () => {
  it("counts every cell of the sorted rectangle (rows x columns)", () => {
    expect(sortAffectedCellCount(range(0, 9, 0, 4))).toBe(50);
    expect(sortAffectedCellCount(range(0, 0, 0, 0))).toBe(1);
  });

  it("returns 0 for a degenerate rectangle", () => {
    expect(sortAffectedCellCount(range(5, 4, 0, 0))).toBe(0);
    expect(sortAffectedCellCount(range(0, 4, 3, 2))).toBe(0);
  });
});

describe("sortWithinOpLimit", () => {
  it("allows a sort at exactly the engine budget", () => {
    // 10_000 cells = the maxOfficeEditOps bound; allowed, not refused.
    expect(sortWithinOpLimit(range(0, 99, 0, 99), XLSX_SORT_MAX_OPS)).toBe(10_000);
  });

  it("refuses a sort one cell over the budget without running anything", () => {
    expect(sortWithinOpLimit(range(0, 100, 0, 100), XLSX_SORT_MAX_OPS)).toBeNull();
  });

  it("refuses a degenerate range", () => {
    expect(sortWithinOpLimit(range(3, 2, 0, 0))).toBeNull();
  });

  it("pins the default budget at the engine's 10_000 ops", () => {
    expect(XLSX_SORT_MAX_OPS).toBe(10_000);
    expect(sortWithinOpLimit(range(0, 100, 0, 100))).toBeNull();
  });
});

describe("sortRangeIsSortable", () => {
  it("requires at least two rows and one column", () => {
    expect(sortRangeIsSortable(range(0, 1, 0, 0))).toBe(true);
    expect(sortRangeIsSortable(range(0, 0, 0, 0))).toBe(false);
    expect(sortRangeIsSortable(range(0, 4, 3, 2))).toBe(false);
  });
});

describe("sortCommandParams", () => {
  it("builds the pinned single-key sort params", () => {
    expect(sortCommandParams(range(0, 4, 1, 3), 2, "desc", true)).toEqual({
      range: { startRow: 0, endRow: 4, startColumn: 1, endColumn: 3 },
      orderRules: [{ type: "desc", colIndex: 2 }],
      hasTitle: true,
    });
  });

  it("refuses a key column outside the selection", () => {
    expect(() => sortCommandParams(range(0, 4, 1, 3), 0, "asc", false)).toThrow("sort_key_outside_range");
    expect(() => sortCommandParams(range(0, 4, 1, 3), 4, "asc", false)).toThrow("sort_key_outside_range");
  });

  it("refuses an unsortable range", () => {
    expect(() => sortCommandParams(range(2, 2, 0, 0), 0, "asc", false)).toThrow("sort_range_unsortable");
  });
});

describe("selectionSortRange", () => {
  it("normalizes the two corners", () => {
    expect(selectionSortRange({ row: 5, column: 3 }, { row: 1, column: 0 })).toEqual({
      startRow: 1,
      endRow: 5,
      startColumn: 0,
      endColumn: 3,
    });
  });
});
