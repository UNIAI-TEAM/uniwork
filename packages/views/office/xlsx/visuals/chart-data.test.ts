import { describe, expect, it } from "vitest";
import { buildChartFromRange } from "./chart-data";

const range = (rows: number, cols: number, startRow = 0, startColumn = 0) => ({
  startRow,
  startColumn,
  endRow: startRow + rows - 1,
  endColumn: startColumn + cols - 1,
});

type Raw = string | number | boolean | null;
const table: Raw[][] = [
  ["", "Sales", "Cost"],
  ["Q1", 10, 4],
  ["Q2", 20, 6],
  ["Q3", 30, 8],
];
const text = (g: Raw[][]): string[][] => g.map((r) => r.map((c) => (c === null ? "" : String(c))));

describe("buildChartFromRange", () => {
  it("detects header row and category column", () => {
    const chart = buildChartFromRange({ values: table, display: text(table), range: range(4, 3, 0, 0), sheetName: "Data", chartType: "column" });
    expect(chart?.series.map((s) => s.name)).toEqual(["Sales", "Cost"]);
    expect(chart?.series[0]?.categories).toEqual(["Q1", "Q2", "Q3"]);
    expect(chart?.series[1]?.values).toEqual([4, 6, 8]);
    expect(chart?.series[0]?.valuesRef).toBe("'Data'!$B$2:$B$4");
    expect(chart?.series[0]?.categoriesRef).toBe("'Data'!$A$2:$A$4");
    expect(chart?.title).toBe("");
  });

  it("uses empty names and numeric categories without headers", () => {
    const g: Raw[][] = [
      [1, 2],
      [3, 4],
    ];
    const chart = buildChartFromRange({ values: g, display: text(g), range: range(2, 2, 4, 1), sheetName: "S", chartType: "line" });
    expect(chart?.series.map((s) => s.name)).toEqual(["", ""]);
    expect(chart?.series[0]?.categories).toEqual(["1", "2"]);
    expect(chart?.series[0]?.valuesRef).toBe("'S'!$B$5:$B$6");
    expect(chart?.series[0]?.categoriesRef).toBeUndefined();
  });

  it("keeps only the first series for pie and doughnut and titles it", () => {
    for (const chartType of ["pie", "doughnut"] as const) {
      const chart = buildChartFromRange({ values: table, display: text(table), range: range(4, 3), sheetName: "Data", chartType });
      expect(chart?.series).toHaveLength(1);
      expect(chart?.title).toBe("Sales");
    }
  });

  it("quotes sheet names with apostrophes and uses multi-letter columns", () => {
    const chart = buildChartFromRange({ values: table, display: text(table), range: range(4, 3, 0, 26), sheetName: "Bob's", chartType: "bar" });
    expect(chart?.series[0]?.valuesRef).toBe("'Bob''s'!$AB$2:$AB$4");
    expect(chart?.series[0]?.categoriesRef).toBe("'Bob''s'!$AA$2:$AA$4");
  });

  it("maps text, booleans and blanks to 0", () => {
    const g: Raw[][] = [
      ["", "V"],
      ["a", 5],
      ["b", "x"],
      ["c", true],
      ["d", null],
    ];
    const chart = buildChartFromRange({ values: g, display: text(g), range: range(5, 2), sheetName: "S", chartType: "column" });
    expect(chart?.series[0]?.values).toEqual([5, 0, 0, 0]);
  });

  it("caps series and points", () => {
    const row = Array.from({ length: 30 }, (_, i) => i + 1);
    const wide: Raw[][] = [row, row];
    const w = buildChartFromRange({ values: wide, display: text(wide), range: range(2, 30), sheetName: "S", chartType: "line" });
    expect(w?.series).toHaveLength(24);
    const tall: Raw[][] = Array.from({ length: 1200 }, (_, i) => [i + 1]);
    const t = buildChartFromRange({ values: tall, display: text(tall), range: range(1200, 1), sheetName: "S", chartType: "line" });
    expect(t?.series[0]?.values).toHaveLength(1000);
  });

  it("returns null for single cells and non-numeric ranges", () => {
    expect(buildChartFromRange({ values: [[1]], display: [["1"]], range: range(1, 1), sheetName: "S", chartType: "pie" })).toBeNull();
    const g: Raw[][] = [
      ["a", "b"],
      ["c", "d"],
    ];
    expect(buildChartFromRange({ values: g, display: text(g), range: range(2, 2), sheetName: "S", chartType: "pie" })).toBeNull();
    expect(buildChartFromRange({ values: [], display: [], range: range(1, 1), sheetName: "S", chartType: "pie" })).toBeNull();
  });
});
