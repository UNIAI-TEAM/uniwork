import { describe, expect, it } from "vitest";
import {
  filterCriteriaOperations,
  selectionFilterArea,
  XLSX_FILTER_MAX_CONDITIONS,
  XLSX_FILTER_OPERATORS,
} from "./filter-commands";

describe("xlsx filter criteria mapping", () => {
  it("maps rows grouped per column to one set-filter-criteria payload each", () => {
    expect(
      filterCriteriaOperations(
        [
          { column: 1, operator: "equal", value: "alpha" },
          { column: 1, operator: "greaterThan", value: "10" },
          { column: 3, operator: "notEqual", value: "x" },
        ],
        "and",
      ),
    ).toEqual([
      {
        col: 1,
        criteria: {
          colId: 1,
          customFilters: {
            and: 1,
            customFilters: [{ val: "alpha" }, { val: "10", operator: "greaterThan" }],
          },
        },
      },
      {
        col: 3,
        criteria: { colId: 3, customFilters: { customFilters: [{ val: "x", operator: "notEqual" }] } },
      },
    ]);
  });

  it("drops the join when a column has a single condition", () => {
    const [operation] = filterCriteriaOperations([{ column: 0, operator: "equal", value: "a" }], "and");
    expect(operation?.criteria.customFilters).toEqual({ customFilters: [{ val: "a" }] });
  });

  it("returns no operations for no rows", () => {
    expect(filterCriteriaOperations([], "or")).toEqual([]);
  });

  it("refuses an empty value, a negative column and too many conditions per column", () => {
    expect(() => filterCriteriaOperations([{ column: 0, operator: "equal", value: "" }], "or")).toThrowError("filter_value_required");
    expect(() => filterCriteriaOperations([{ column: -1, operator: "equal", value: "a" }], "or")).toThrowError("filter_column_invalid");
    expect(() =>
      filterCriteriaOperations(
        Array.from({ length: XLSX_FILTER_MAX_CONDITIONS + 1 }, () => ({ column: 0, operator: "equal" as const, value: "a" })),
        "or",
      ),
    ).toThrowError("filter_too_many_conditions");
  });

  it("keeps the operator vocabulary the OOXML writer accepts", () => {
    expect(XLSX_FILTER_OPERATORS).toEqual([
      "equal", "notEqual", "greaterThan", "greaterThanOrEqual", "lessThan", "lessThanOrEqual",
    ]);
  });

  it("orders a selection's corners into a filter area", () => {
    expect(selectionFilterArea({ row: 3, column: 2 }, { row: 0, column: 0 })).toEqual({
      startRow: 0, endRow: 3, startColumn: 0, endColumn: 2,
    });
  });
});
