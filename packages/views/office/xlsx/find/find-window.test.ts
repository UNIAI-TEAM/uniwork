import { describe, expect, it } from "vitest";
import type { RendererRangeCell, RendererRangeResult } from "../xlsx-render-model-bridge";
import type { XlsxSelection } from "../types";
import {
  FIND_SCAN_MAX_CELLS,
  clipScanResult,
  findScanRange,
  scanWindow,
  selectionRange,
} from "./find-window";

const sheet = (rowCount: number, columnCount: number) => ({ rowCount, columnCount });

const selection = (address: string, endAddress?: string): XlsxSelection => ({
  sheet: "Data",
  address,
  ...(endAddress === undefined ? {} : { endAddress }),
});

const result = (cells: RendererRangeCell[], extra: Partial<RendererRangeResult> = {}): RendererRangeResult =>
  ({ cells, indexingComplete: true, indexedThroughRow: null, ...extra }) as RendererRangeResult;

const cell = (row: number, column: number, value: string): RendererRangeCell => ({ row, column, value });

describe("selectionRange", () => {
  it("normalizes a reversed selection to an ordered rectangle", () => {
    expect(selectionRange(selection("B2", "A1"))).toEqual({ startRow: 0, endRow: 1, startColumn: 0, endColumn: 1 });
  });

  it("returns null for a malformed address", () => {
    expect(selectionRange(selection("nope"))).toBeNull();
  });
});

describe("scanWindow", () => {
  it("clips the wanted window to the sheet's used bounds", () => {
    expect(scanWindow({ startRow: 0, endRow: 10, startColumn: 0, endColumn: 3 }, sheet(5, 2))).toEqual({
      range: { startRow: 0, endRow: 4, startColumn: 0, endColumn: 1 },
      totalRows: 5,
      windowed: false,
    });
  });

  it("caps one read to whole rows under the cell bound", () => {
    const request = scanWindow({ startRow: 0, endRow: 99_999, startColumn: 0, endColumn: 1 }, sheet(100_000, 2));
    expect(request).toEqual({
      range: { startRow: 0, endRow: FIND_SCAN_MAX_CELLS / 2 - 1, startColumn: 0, endColumn: 1 },
      totalRows: 100_000,
      windowed: true,
    });
  });

  it("returns null when the wanted window holds no used cell", () => {
    expect(scanWindow({ startRow: 10, endRow: 20, startColumn: 0, endColumn: 0 }, sheet(5, 2))).toBeNull();
    expect(scanWindow({ startRow: 0, endRow: 5, startColumn: 0, endColumn: 0 }, sheet(0, 0))).toBeNull();
  });
});

describe("findScanRange", () => {
  it("scans the selection by default and the whole used sheet on request", () => {
    expect(findScanRange("selection", selection("A1", "B3"), sheet(100, 26))?.range).toEqual({
      startRow: 0,
      endRow: 2,
      startColumn: 0,
      endColumn: 1,
    });
    expect(findScanRange("sheet", selection("A1"), sheet(20, 4))?.range).toEqual({
      startRow: 0,
      endRow: 19,
      startColumn: 0,
      endColumn: 3,
    });
  });

  it("has no window for a selection scope without a selection", () => {
    expect(findScanRange("selection", null, sheet(10, 10))).toBeNull();
  });
});

describe("clipScanResult", () => {
  const request = {
    range: { startRow: 0, endRow: 2, startColumn: 0, endColumn: 0 },
    totalRows: 3,
    windowed: false,
  };

  it("keeps only the requested rectangle and reports the read as complete", () => {
    const read = clipScanResult(
      result([cell(0, 0, "a"), cell(1, 5, "outside"), cell(9, 0, "below"), cell(2, 0, "b")]),
      request,
    );
    expect(read.cells.map((entry) => entry.value)).toEqual(["a", "b"]);
    expect(read.scannedRows).toBe(3);
    expect(read.totalRows).toBe(3);
    expect(read.partial).toBe(false);
  });

  it("drops rows a partial host has not indexed and says so", () => {
    const read = clipScanResult(
      result([cell(0, 0, "a"), cell(1, 0, "b"), cell(2, 0, "c")], { indexingComplete: false, indexedThroughRow: 1 }),
      request,
    );
    expect(read.cells.map((entry) => entry.value)).toEqual(["a", "b"]);
    expect(read.scannedRows).toBe(2);
    expect(read.partial).toBe(true);
  });

  it("treats a partial host that confirms no rows as covering nothing", () => {
    const read = clipScanResult(
      result([cell(0, 0, "a"), cell(1, 0, "b")], { indexingComplete: false, indexedThroughRow: null }),
      request,
    );
    expect(read.cells).toEqual([]);
    expect(read.scannedRows).toBe(0);
    expect(read.partial).toBe(true);
  });

  it("flags a windowed request as partial and keeps the row totals apart", () => {
    const windowed = {
      range: { startRow: 0, endRow: 1, startColumn: 0, endColumn: 0 },
      totalRows: 3,
      windowed: true,
    };
    const read = clipScanResult(result([cell(0, 0, "a"), cell(1, 0, "b")]), windowed);
    expect(read.partial).toBe(true);
    expect(read.scannedRows).toBe(2);
    expect(read.totalRows).toBe(3);
  });

  it("trusts a host that omits the indexing fields", () => {
    const legacy = { cells: [cell(0, 0, "a")] } as RendererRangeResult;
    expect(clipScanResult(legacy, request).partial).toBe(false);
  });
});
