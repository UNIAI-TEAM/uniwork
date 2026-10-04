// B3ui (UNI-927) - pure tests for the Charts panel model.
//
// Every builder emits exactly one engine `ChartEdit` union member, and every
// refusal carries one of the engine's own `PptxEngineError` codes. These tests
// pin the payload shape, the parsers and the refusal codes without a DOM.
import { describe, expect, it } from "vitest";
import { CHART_KINDS, type ChartKind } from "@uniwork/office-engine/pptx";
import {
  PPTX_CHART_DEFAULT_COLORS,
  PPTX_CHART_DEFAULT_DATA,
  PPTX_CHART_DEFAULT_RECT,
  PPTX_CHART_KIND_OPTIONS,
  PPTX_CHART_LEGEND_POSITIONS,
  PPTX_CHART_PALETTES,
  buildChartDataEdit,
  buildChartStyleEdit,
  buildChartTypeEdit,
  buildInsertChartEdit,
  chartKindLabelKey,
  chartKindUsesBarDir,
  chartKindUsesHoleSize,
  formatChartData,
  isChartColor,
  isChartKind,
  isChartLegendPos,
  matchChartPalette,
  normalizeChartColor,
  parseChartData,
  resolveChartKind,
  validateChartData,
  validateChartRect,
  type PptxChartData,
} from "./chart-model";

describe("chart vocabulary", () => {
  it("mirrors the engine's CHART_KINDS in order", () => {
    expect(PPTX_CHART_KIND_OPTIONS.map((option) => option.kind)).toEqual([...CHART_KINDS]);
    for (const option of PPTX_CHART_KIND_OPTIONS) {
      expect(option.labelKey).toBe(chartKindLabelKey(option.kind));
      expect(option.labelKey).toBe("office.pptx.charts.kind." + option.kind);
    }
  });

  it("accepts only real kinds", () => {
    for (const kind of CHART_KINDS) expect(isChartKind(kind)).toBe(true);
    expect(isChartKind("waterfall")).toBe(false);
    expect(isChartKind(7)).toBe(false);
    expect(isChartKind(null)).toBe(false);
  });

  it("resolves an unknown read-back kind to the first real kind", () => {
    expect(resolveChartKind("pie")).toBe("pie");
    expect(resolveChartKind("waterfall")).toBe(CHART_KINDS[0]);
    expect(resolveChartKind(undefined)).toBe(CHART_KINDS[0]);
  });

  it("knows which kinds read a bar direction and which read the hole size", () => {
    for (const kind of ["bar", "barStacked", "barPercentStacked", "bar3D"] as ChartKind[]) {
      expect(chartKindUsesBarDir(kind)).toBe(true);
    }
    expect(chartKindUsesBarDir("pie")).toBe(false);
    expect(chartKindUsesHoleSize("doughnut")).toBe(true);
    expect(chartKindUsesHoleSize("pie")).toBe(false);
  });

  it("validates hex colours like the engine and normalizes the case", () => {
    expect(isChartColor("#4472C4")).toBe(true);
    expect(isChartColor("4472C4")).toBe(true);
    expect(isChartColor("#4472C4FF")).toBe(true);
    expect(isChartColor("#4472C")).toBe(false);
    expect(isChartColor("red")).toBe(false);
    expect(normalizeChartColor("4472c4")).toBe("#4472C4");
    expect(normalizeChartColor("nope")).toBe("nope");
  });

  it("validates legend positions", () => {
    for (const position of PPTX_CHART_LEGEND_POSITIONS) expect(isChartLegendPos(position)).toBe(true);
    expect(isChartLegendPos("tr")).toBe(false);
    expect(isChartLegendPos(null)).toBe(false);
  });
});

describe("buildInsertChartEdit (add_chart)", () => {
  it("defaults the rect and data so the Insert button never sends an empty chart", () => {
    const result = buildInsertChartEdit({ slideIndex: 2, kind: "bar" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.edit).toEqual({
      op: "add_chart",
      slideIndex: 2,
      kind: "bar",
      xPx: PPTX_CHART_DEFAULT_RECT.xPx,
      yPx: PPTX_CHART_DEFAULT_RECT.yPx,
      wPx: PPTX_CHART_DEFAULT_RECT.wPx,
      hPx: PPTX_CHART_DEFAULT_RECT.hPx,
      categories: [...PPTX_CHART_DEFAULT_DATA.categories],
      series: [{ name: "Series 1", values: [1, 2, 3] }],
    });
  });

  it("carries barDir, title, colors and holeSizePct when supplied", () => {
    const result = buildInsertChartEdit({
      slideIndex: 0,
      kind: "doughnut",
      barDir: "bar",
      title: "  Revenue  ",
      colors: PPTX_CHART_DEFAULT_COLORS,
      holeSizePct: 60,
      rect: { xPx: 10, yPx: 20, wPx: 300, hPx: 200 },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.edit).toEqual({
      op: "add_chart",
      slideIndex: 0,
      kind: "doughnut",
      xPx: 10,
      yPx: 20,
      wPx: 300,
      hPx: 200,
      categories: [...PPTX_CHART_DEFAULT_DATA.categories],
      series: [{ name: "Series 1", values: [1, 2, 3] }],
      barDir: "bar",
      title: "Revenue",
      colorScheme: [...PPTX_CHART_DEFAULT_COLORS],
      holeSizePct: 60,
    });
  });

  it("refuses an unknown kind with the engine's bad_chart_kind", () => {
    const result = buildInsertChartEdit({ slideIndex: 0, kind: "waterfall" as ChartKind });
    expect(result).toMatchObject({ ok: false, code: "bad_chart_kind" });
  });

  it("refuses a bad rect with bad_chart_rect", () => {
    const result = buildInsertChartEdit({
      slideIndex: 0,
      kind: "bar",
      rect: { xPx: -1, yPx: 0, wPx: 10, hPx: 10 },
    });
    expect(result).toMatchObject({ ok: false, code: "bad_chart_rect" });
  });

  it("refuses empty data with bad_chart_data", () => {
    const result = buildInsertChartEdit({
      slideIndex: 0,
      kind: "bar",
      data: { categories: [], series: [{ name: "S", values: [1] }] },
    });
    expect(result).toMatchObject({ ok: false, code: "bad_chart_data" });
  });

  it("refuses a non-hex colour scheme with bad_chart_color", () => {
    const result = buildInsertChartEdit({ slideIndex: 0, kind: "bar", colors: ["red"] });
    expect(result).toMatchObject({ ok: false, code: "bad_chart_color" });
  });
});

describe("buildChartDataEdit (set_chart data)", () => {
  const data: PptxChartData = { categories: ["Q1", "Q2"], series: [{ name: "Sales", values: [10, 20] }] };

  it("emits one set_chart with categories and series", () => {
    const result = buildChartDataEdit(1, "el-1", data);
    expect(result).toEqual({
      ok: true,
      edit: { op: "set_chart", slideIndex: 1, elementId: "el-1", patch: { categories: ["Q1", "Q2"], series: [{ name: "Sales", values: [10, 20] }] } },
    });
  });

  it("copies the arrays so later mutation cannot reach the patch", () => {
    const result = buildChartDataEdit(1, "el-1", data);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    data.categories.push("Q3");
    expect((result.edit as unknown as { patch: { categories: string[] } }).patch.categories).toEqual(["Q1", "Q2"]);
  });

  it("refuses a missing element and invalid data", () => {
    expect(buildChartDataEdit(1, "", data)).toMatchObject({ ok: false, code: "no_element" });
    expect(buildChartDataEdit(1, "el-1", { categories: [], series: [] })).toMatchObject({
      ok: false,
      code: "bad_chart_data",
    });
  });
});

describe("buildChartTypeEdit (set_chart kind)", () => {
  it("emits kind, plus barDir only for the bar family", () => {
    expect(buildChartTypeEdit(0, "el-1", "pie")).toEqual({
      ok: true,
      edit: { op: "set_chart", slideIndex: 0, elementId: "el-1", patch: { kind: "pie" } },
    });
    expect(buildChartTypeEdit(0, "el-1", "bar", "bar")).toEqual({
      ok: true,
      edit: { op: "set_chart", slideIndex: 0, elementId: "el-1", patch: { kind: "bar", barDir: "bar" } },
    });
  });

  it("refuses an unknown kind and a missing element", () => {
    expect(buildChartTypeEdit(0, "el-1", "waterfall" as ChartKind)).toMatchObject({ ok: false, code: "bad_chart_kind" });
    expect(buildChartTypeEdit(0, "", "bar")).toMatchObject({ ok: false, code: "no_element" });
  });
});

describe("buildChartStyleEdit (set_chart style)", () => {
  it("includes only the supplied keys", () => {
    const result = buildChartStyleEdit(0, "el-1", { legendPos: "t", dataLabels: true });
    expect(result).toEqual({
      ok: true,
      edit: { op: "set_chart", slideIndex: 0, elementId: "el-1", patch: { legendPos: "t", dataLabels: true } },
    });
  });

  it("carries title, colours, gridlines and gap width", () => {
    const result = buildChartStyleEdit(2, "el-9", {
      title: "Revenue",
      gridlines: false,
      colors: PPTX_CHART_DEFAULT_COLORS,
      gapWidthPct: 120,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.edit).toMatchObject({
      op: "set_chart",
      slideIndex: 2,
      elementId: "el-9",
      patch: { title: "Revenue", gridlines: false, colorScheme: [...PPTX_CHART_DEFAULT_COLORS], gapWidthPct: 120 },
    });
  });

  it("refuses an empty patch, a bad legend, bad colours and a missing element", () => {
    expect(buildChartStyleEdit(0, "el-1", {})).toMatchObject({ ok: false, code: "bad_chart_patch" });
    expect(buildChartStyleEdit(0, "el-1", { legendPos: "tr" as never })).toMatchObject({ ok: false, code: "bad_chart_patch" });
    expect(buildChartStyleEdit(0, "el-1", { colors: [] })).toMatchObject({ ok: false, code: "bad_chart_color" });
    expect(buildChartStyleEdit(0, "", { dataLabels: true })).toMatchObject({ ok: false, code: "no_element" });
  });
});

describe("validate helpers", () => {
  it("validates rects and data like the engine", () => {
    expect(validateChartRect({ xPx: 0, yPx: 0, wPx: 1, hPx: 1 })).toBeNull();
    expect(validateChartRect({ xPx: 0, yPx: 0, wPx: 1, hPx: Number.NaN })).toMatchObject({ code: "bad_chart_rect" });
    expect(validateChartData({ categories: ["a"], series: [{ name: "s", values: [1] }] })).toBeNull();
    expect(validateChartData({ categories: ["a"], series: [{ name: "", values: [1] }] })).toMatchObject({
      code: "bad_chart_data",
    });
    expect(validateChartData({ categories: ["a"], series: [{ name: "s", values: [Number.POSITIVE_INFINITY] }] })).toMatchObject({
      code: "bad_chart_data",
    });
  });
});

describe("palette matching", () => {
  it("matches a preset by colours and returns null for a custom scheme", () => {
    for (const palette of PPTX_CHART_PALETTES) {
      expect(matchChartPalette(palette.colors)).toBe(palette.id);
    }
    expect(matchChartPalette(["#123456"])).toBeNull();
    expect(matchChartPalette([])).toBeNull();
    expect(matchChartPalette(null)).toBeNull();
  });
});

describe("parseChartData / formatChartData", () => {
  it("round-trips through the tab-separated editor text", () => {
    const data: PptxChartData = {
      categories: ["Q1", "Q2", "Q3"],
      series: [
        { name: "Sales", values: [10, 20, 30] },
        { name: "Costs", values: [5, 8, 12] },
      ],
    };
    const text = formatChartData(data);
    const parsed = parseChartData(text);
    expect(parsed).toEqual({ ok: true, data });
  });

  it("parses a comma-separated paste and names unnamed series", () => {
    const parsed = parseChartData("Category,A,B\nQ1,1,2\nQ2,3,4");
    expect(parsed).toEqual({
      ok: true,
      data: {
        categories: ["Q1", "Q2"],
        series: [
          { name: "A", values: [1, 2] },
          { name: "B", values: [3, 4] },
        ],
      },
    });
    const unnamed = parseChartData(",A\nQ1,1");
    expect(unnamed.ok).toBe(true);
    if (!unnamed.ok) return;
    expect(unnamed.data.series[0]?.name).toBe("A");
  });

  it("treats a blank cell as 0 but refuses a non-numeric one", () => {
    const blank = parseChartData("Cat,Value\nQ1,\nQ2,5");
    expect(blank.ok).toBe(true);
    if (!blank.ok) return;
    expect(blank.data.series[0]?.values).toEqual([0, 5]);
    expect(parseChartData("Cat,Value\nQ1,abc")).toMatchObject({ ok: false, code: "bad_chart_data" });
  });

  it("refuses text without a data row", () => {
    expect(parseChartData("")).toMatchObject({ ok: false, code: "bad_chart_data" });
    expect(parseChartData("Cat,Value")).toMatchObject({ ok: false, code: "bad_chart_data" });
  });
});