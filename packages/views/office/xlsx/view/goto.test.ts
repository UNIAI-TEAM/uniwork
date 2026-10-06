import { describe, expect, it } from "vitest";
import { parseA1Reference, scrollCommandParams, selectionCommandParams } from "./goto";

describe("xlsx go-to reference parsing", () => {
  it("parses a single cell case-insensitively with absolute markers", () => {
    expect(parseA1Reference("B5")).toEqual({ startRow: 4, endRow: 4, startColumn: 1, endColumn: 1 });
    expect(parseA1Reference(" b5 ")).toEqual({ startRow: 4, endRow: 4, startColumn: 1, endColumn: 1 });
    expect(parseA1Reference("$A$1")).toEqual({ startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 });
  });

  it("parses a range and normalizes a reversed one", () => {
    expect(parseA1Reference("A1:C10")).toEqual({ startRow: 0, endRow: 9, startColumn: 0, endColumn: 2 });
    expect(parseA1Reference("C10:A1")).toEqual({ startRow: 0, endRow: 9, startColumn: 0, endColumn: 2 });
  });

  it("accepts the grid's outer bounds and rejects what is past them", () => {
    expect(parseA1Reference("XFD1048576")).toEqual({ startRow: 1_048_575, endRow: 1_048_575, startColumn: 16_383, endColumn: 16_383 });
    expect(parseA1Reference("XFE1")).toBeNull();
    expect(parseA1Reference("A1048577")).toBeNull();
    expect(parseA1Reference("A0")).toBeNull();
  });

  it("rejects malformed and out-of-scope references", () => {
    expect(parseA1Reference("")).toBeNull();
    expect(parseA1Reference("   ")).toBeNull();
    expect(parseA1Reference("A")).toBeNull();
    expect(parseA1Reference("1")).toBeNull();
    expect(parseA1Reference("A1:")).toBeNull();
    expect(parseA1Reference("A1:B2:C3")).toBeNull();
    expect(parseA1Reference("hello")).toBeNull();
    expect(parseA1Reference("Data!A1")).toBeNull();
    expect(parseA1Reference("1:1")).toBeNull();
    expect(parseA1Reference("A:A")).toBeNull();
  });
});

describe("xlsx go-to command payloads", () => {
  const range = { startRow: 0, endRow: 9, startColumn: 0, endColumn: 2 };

  it("selects the range with its top-left cell as the primary", () => {
    expect(selectionCommandParams(range)).toEqual({
      selections: [{
        range,
        primary: {
          startRow: 0,
          startColumn: 0,
          endRow: 0,
          endColumn: 0,
          actualRow: 0,
          actualColumn: 0,
          rangeType: 0,
          isMerged: false,
          isMergedMainCell: false,
        },
        style: null,
      }],
    });
  });

  it("forces the reveal scroll to the range's top-left corner", () => {
    expect(scrollCommandParams(range)).toEqual({ range, forceTop: true, forceLeft: true });
  });
});
