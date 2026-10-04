// B8 (UNI-924): pure chart logic — table extraction, grid parsing, draft
// validation and the engine payloads, without an editor.
import { describe, expect, it } from "vitest";
import {
  chartDataFromTable,
  chartDisplayFromSpec,
  chartDraftError,
  chartDraftToSpec,
  DOCX_CHART_KINDS,
  DOCX_CHART_PLOT_HEIGHT_PX,
  DOCX_CHART_TITLE_ROW_PX,
  DOCX_CHART_WIDTH_PX,
  emptyDocxChartDraft,
  formatDocxChartValue,
  normalizeDocxChartDraft,
  parseDocxChartNumber,
  type DocxChartDraft,
  type DocxChartTableCell,
} from "./docx-chart-model";

const table = (texts: string[][]) => ({ rows: texts.map((row) => row.map((text) => ({ paras: [text] }))) });

const cell = (text: string, extra: Partial<DocxChartTableCell> = {}): DocxChartTableCell => ({ paras: [text], ...extra });

const grid = (rows: DocxChartTableCell[][]) => ({ rows });

const DRAFT: DocxChartDraft = {
  kind: "bar",
  title: "Doanh thu",
  categories: ["Q1", "Q2"],
  series: [
    { name: "Bắc", values: [1, 2] },
    { name: "Nam", values: [3, null] },
  ],
};

describe("parseDocxChartNumber", () => {
  it("reads plain, signed and thousands-separated numbers", () => {
    expect(parseDocxChartNumber("12")).toBe(12);
    expect(parseDocxChartNumber(" -3.5 ")).toBe(-3.5);
    expect(parseDocxChartNumber("1,234.5")).toBe(1234.5);
    expect(parseDocxChartNumber("1 234")).toBe(1234);
    expect(parseDocxChartNumber("0")).toBe(0);
  });

  it("treats blank, letters and non-finite input as a gap", () => {
    expect(parseDocxChartNumber("")).toBeNull();
    expect(parseDocxChartNumber("  ")).toBeNull();
    expect(parseDocxChartNumber("abc")).toBeNull();
    expect(parseDocxChartNumber("Infinity")).toBeNull();
    expect(formatDocxChartValue(null)).toBe("");
    expect(formatDocxChartValue(3)).toBe("3");
  });
});

describe("chartDataFromTable", () => {
  it("reads first row as series names and first column as categories", () => {
    expect(chartDataFromTable(table([["", "Bắc", "Nam"], ["Q1", "1", "3"], ["Q2", "2", "x"]]))).toEqual({
      categories: ["Q1", "Q2"],
      series: [
        { name: "Bắc", values: [1, 2] },
        { name: "Nam", values: [3, null] },
      ],
    });
  });

  it("keeps a blank category and a gap for a missing trailing cell", () => {
    expect(chartDataFromTable(table([["", "S"], ["", "1"], ["Q2"]]))).toEqual({
      categories: ["", "Q2"],
      series: [{ name: "S", values: [1, null] }],
    });
  });

  it("refuses tables without a header row or a second column", () => {
    expect(chartDataFromTable(null)).toBeNull();
    expect(chartDataFromTable(undefined)).toBeNull();
    expect(chartDataFromTable({ rows: [] })).toBeNull();
    expect(chartDataFromTable(table([["only header"]]))).toBeNull();
    expect(chartDataFromTable(table([["", "S"]]))).toBeNull();
  });

  it("pairs names and values by grid column when a header cell spans columns", () => {
    const rows = [
      [cell(""), cell("Bắc", { colSpan: 2 }), cell("Nam")],
      [cell("Q1"), cell("1"), cell("2"), cell("3")],
      [cell("Q2"), cell("4"), cell("5"), cell("6")],
    ];
    expect(chartDataFromTable(grid(rows))).toEqual({
      categories: ["Q1", "Q2"],
      series: [
        { name: "Bắc", values: [1, 4] },
        { name: "Bắc", values: [2, 5] },
        { name: "Nam", values: [3, 6] },
      ],
    });
  });

  it("repeats a spanning body cell across the columns it covers", () => {
    const rows = [
      [cell(""), cell("Q1"), cell("Q2")],
      [cell("Tổng"), cell("30", { colSpan: 2 })],
    ];
    expect(chartDataFromTable(grid(rows))).toEqual({
      categories: ["Tổng"],
      series: [
        { name: "Q1", values: [30] },
        { name: "Q2", values: [30] },
      ],
    });
  });

  it("keeps gridBefore/gridAfter pads from shifting categories or values", () => {
    const pad: DocxChartTableCell = { paras: [], gridGap: true };
    const rows = [
      [pad, cell(""), cell("S"), cell("T")],
      [pad, cell("Q1"), cell("1"), cell("2")],
      [pad, cell("Q2"), cell("3"), cell("4")],
    ];
    expect(chartDataFromTable(grid(rows))).toEqual({
      categories: ["Q1", "Q2"],
      series: [
        { name: "S", values: [1, 3] },
        { name: "T", values: [2, 4] },
      ],
    });
  });

  it("reads a vMerge continuation as merged away, not as its own content", () => {
    const rows = [
      [cell(""), cell("S")],
      [cell("2024", { vMerge: "restart" }), cell("10")],
      [cell("2025", { vMerge: "continue" }), cell("20")],
    ];
    expect(chartDataFromTable(grid(rows))).toEqual({
      categories: ["2024", ""],
      series: [{ name: "S", values: [10, 20] }],
    });
  });
});

describe("chart draft validation", () => {
  it("an empty draft fails on no values, then passes once a number arrives", () => {
    const empty = emptyDocxChartDraft();
    expect(empty.kind).toBe("bar");
    expect(empty.categories).toHaveLength(3);
    expect(chartDraftError(empty)).toBe("noValues");
    expect(chartDraftToSpec(empty)).toBeNull();
    const filled = { ...empty, categories: ["A", "B", "C"], series: [{ name: "S", values: [1, null, null] }] };
    expect(chartDraftError(filled)).toBeNull();
  });

  it("reports the first structural refusal", () => {
    expect(chartDraftError({ ...DRAFT, categories: [] })).toBe("noCategories");
    expect(chartDraftError({ ...DRAFT, series: [] })).toBe("noSeries");
    expect(chartDraftError({ ...DRAFT, series: [{ name: " ", values: [1, 2] }] })).toBe("seriesName");
    expect(chartDraftError({ ...DRAFT, series: [{ name: "S", values: [1] }] })).toBe("seriesLength");
    expect(chartDraftError({ ...DRAFT, series: [{ name: "S", values: [null, null] }] })).toBe("noValues");
    expect(chartDraftError(DRAFT)).toBeNull();
  });

  it("normalizes blank series names and builds a trimmed spec", () => {
    const normalized = normalizeDocxChartDraft({ ...DRAFT, title: "  ", series: [{ name: " ", values: [1, 2] }] }, (i) => `Series ${i + 1}`);
    expect(normalized.series[0]!.name).toBe("Series 1");
    const spec = chartDraftToSpec(normalized);
    expect(spec).toEqual({
      kind: "bar",
      categories: ["Q1", "Q2"],
      series: [{ name: "Series 1", values: [1, 2] }],
    });
    expect(spec && "title" in spec).toBe(false);
  });

  it("trims the title and copies the arrays", () => {
    const spec = chartDraftToSpec({ ...DRAFT, title: "  Doanh thu  " });
    expect(spec?.title).toBe("Doanh thu");
    spec!.categories.push("Q3");
    expect(DRAFT.categories).toEqual(["Q1", "Q2"]);
  });
});

describe("chartDisplayFromSpec", () => {
  it("reserves the title row and copies the data", () => {
    const spec = chartDraftToSpec(DRAFT);
    const display = chartDisplayFromSpec(spec!);
    expect(display.partPath).toBe("");
    expect(display.widthPx).toBe(DOCX_CHART_WIDTH_PX);
    expect(display.heightPx).toBe(DOCX_CHART_PLOT_HEIGHT_PX + DOCX_CHART_TITLE_ROW_PX);
    expect(display.series).toEqual(DRAFT.series);
    spec!.series[0]!.values[0] = 99;
    expect(display.series[0]!.values[0]).toBe(1);
  });

  it("keeps the plot height when there is no title", () => {
    const spec = chartDraftToSpec({ ...DRAFT, title: "" });
    expect(chartDisplayFromSpec(spec!).heightPx).toBe(DOCX_CHART_PLOT_HEIGHT_PX);
    expect(chartDisplayFromSpec(spec!).title).toBeUndefined();
  });

  it("offers exactly the three engine kinds", () => {
    expect(DOCX_CHART_KINDS).toEqual(["bar", "line", "pie"]);
  });
});
