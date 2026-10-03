import { describe, expect, it } from "vitest";
import type { RendererRangeCell } from "../xlsx-render-model-bridge";
import { SUMMARY_READ_MAX_CELLS, summarizeCells, summarizeRead, summaryReadRequest, type XlsxSummaryRange } from "./selection-summary";

const cell = (value: RendererRangeCell["value"], row = 0, column = 0): RendererRangeCell => ({ row, column, value });

describe("summarizeCells", () => {
  it("reports an empty selection instead of zero totals", () => {
    expect(summarizeCells([])).toEqual({ kind: "empty" });
    expect(summarizeCells([cell(null), cell("")])).toEqual({ kind: "empty" });
  });

  it("summarizes a single numeric cell", () => {
    expect(summarizeCells([cell(7)])).toEqual({ kind: "numeric", nonEmptyCount: 1, numericCount: 1, sum: 7, average: 7, min: 7, max: 7 });
  });

  it("shows count only for a mixed selection", () => {
    expect(summarizeCells([cell(2), cell("two"), cell(4), cell(true)])).toEqual({ kind: "count", nonEmptyCount: 4 });
  });

  it("treats a boolean as a non-numeric value", () => {
    expect(summarizeCells([cell(1), cell(true)])).toEqual({ kind: "count", nonEmptyCount: 2 });
  });

  it("keeps zero and negative values as data", () => {
    expect(summarizeCells([cell(-4), cell(0), cell(4)])).toEqual({
      kind: "numeric",
      nonEmptyCount: 3,
      numericCount: 3,
      sum: 0,
      average: 0,
      min: -4,
      max: 4,
    });
  });

  it("reports a text-only selection as a count", () => {
    expect(summarizeCells([cell("alpha"), cell("beta")])).toEqual({ kind: "count", nonEmptyCount: 2 });
  });

  it("skips non-finite numbers", () => {
    expect(summarizeCells([cell(Number.NaN), cell(Number.POSITIVE_INFINITY)])).toEqual({ kind: "empty" });
  });

  it("skips a formula cell with no cached value", () => {
    expect(summarizeCells([{ value: null }])).toEqual({ kind: "empty" });
  });
});

describe("summaryReadRequest", () => {
  it("normalizes a single cell and a reversed range", () => {
    expect(summaryReadRequest({ sheet: "Data", address: "B2" })).toEqual({
      range: { startRow: 1, endRow: 1, startColumn: 1, endColumn: 1 },
      windowed: false,
    });
    expect(summaryReadRequest({ sheet: "Data", address: "C3", endAddress: "A1" })).toEqual({
      range: { startRow: 0, endRow: 2, startColumn: 0, endColumn: 2 },
      windowed: false,
    });
  });

  it("rejects an unparseable address", () => {
    expect(summaryReadRequest({ sheet: "Data", address: "not-a-cell" })).toBeNull();
  });

  it("clips the range to the sheet's used bounds", () => {
    expect(summaryReadRequest({ sheet: "Data", address: "A1", endAddress: "A100" }, { rowCount: 10, columnCount: 3 })).toEqual({
      range: { startRow: 0, endRow: 9, startColumn: 0, endColumn: 0 },
      windowed: false,
    });
  });

  it("treats a selection outside the used bounds as having no range", () => {
    expect(summaryReadRequest({ sheet: "Data", address: "A20" }, { rowCount: 10, columnCount: 3 })).toBeNull();
  });

  it("caps an oversized selection to the read window and marks it windowed", () => {
    expect(summaryReadRequest({ sheet: "Data", address: "A1", endAddress: "A100000" }, undefined, 10)).toEqual({
      range: { startRow: 0, endRow: 9, startColumn: 0, endColumn: 0 },
      windowed: true,
    });
  });

  it("splits the window across the selection's columns", () => {
    expect(summaryReadRequest({ sheet: "Data", address: "A1", endAddress: "B100" }, undefined, 10)).toEqual({
      range: { startRow: 0, endRow: 4, startColumn: 0, endColumn: 1 },
      windowed: true,
    });
  });

  it("ships a positive default window", () => {
    expect(SUMMARY_READ_MAX_CELLS).toBeGreaterThan(0);
  });
});

describe("summarizeRead", () => {
  const range: XlsxSummaryRange = { startRow: 0, endRow: 2, startColumn: 0, endColumn: 0 };

  it("trusts a complete read", () => {
    expect(summarizeRead({ cells: [cell(1, 0), cell(2, 1)] }, range)).toEqual({
      summary: { kind: "numeric", nonEmptyCount: 2, numericCount: 2, sum: 3, average: 1.5, min: 1, max: 2 },
      partial: false,
    });
  });

  it("summarizes only the confirmed rows of an incomplete read", () => {
    expect(summarizeRead({ cells: [cell(1, 0), cell(2, 1), cell(3, 2)], indexingComplete: false, indexedThroughRow: 1 }, range)).toEqual({
      summary: { kind: "numeric", nonEmptyCount: 2, numericCount: 2, sum: 3, average: 1.5, min: 1, max: 2 },
      partial: true,
    });
  });

  it("treats row coverage as complete once the index reaches the last row", () => {
    expect(summarizeRead({ cells: [cell(1)], indexingComplete: false, indexedThroughRow: 2 }, range).partial).toBe(false);
  });

  it("does not present an unindexed payload as a total", () => {
    expect(summarizeRead({ cells: [cell(1)], indexingComplete: false, indexedThroughRow: null }, range)).toEqual({
      summary: { kind: "empty" },
      partial: true,
    });
  });

  it("accepts hosts that omit the index fields", () => {
    expect(summarizeRead({}, range)).toEqual({ summary: { kind: "empty" }, partial: false });
    expect(summarizeRead(undefined, range)).toEqual({ summary: { kind: "empty" }, partial: false });
  });
});
