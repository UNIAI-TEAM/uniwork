// B8 (UNI-924): DOCX chart inserts. The model refuses a malformed spec before
// it reaches the plan (the vendored save embeds whatever it is handed), the
// save carries the spec through as a chart part, and unrelated parts keep
// their bytes.
import { describe, expect, it } from "vitest";
import { createDocxAdapter, DocxSessionModel, type DocxNewChart } from "../src/docx";
import { requireDocxChartExtent, requireDocxNewChart, type DocxChartExtent } from "../src/docx/chart";
import { createFakeDocxEngine, decodeFakeDocx, makeFakeDocxBytes } from "./fake-docx-engine";

/** Typed-error oracle: callers branch on `code`, never on message text. */
const errCode = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    return String((e as { code?: string }).code ?? e);
  }
  return "";
};

const BAR: DocxNewChart = {
  kind: "bar",
  title: "Doanh thu",
  categories: ["Q1", "Q2", "Q3"],
  series: [
    { name: "Bắc", values: [120, 88.5, 96] },
    { name: "Nam", values: [70, null, 110] },
  ],
};

const LINE: DocxNewChart = {
  kind: "line",
  categories: ["T1", "T2"],
  series: [{ name: "Chi phí", values: [10, 20] }],
};

const PIE: DocxNewChart = {
  kind: "pie",
  title: "Tỉ trọng",
  categories: ["A", "B"],
  series: [{ name: "Phần", values: [3, 7] }],
};

const kitchenSink = () =>
  makeFakeDocxBytes({
    blocks: [
      { type: "paragraph", runs: [{ text: "alpha" }] },
      { type: "paragraph", runs: [{ text: "omega" }] },
      { type: "paragraph", runs: [{ text: "hidden tail" }], hidden: true },
    ],
    extras: { chartParts: { "word/charts/chart1.xml": "<c:chartSpace/>" } },
    parts: {
      "word/charts/chart1.xml": "<c:chartSpace/>",
      "word/charts/embeddings/workbook1.xlsx": "XLSX",
      "customXml/item1.xml": "<custom/>",
    },
  });

const openKitchen = async () => {
  const adapter = createDocxAdapter({ engine: createFakeDocxEngine() });
  const out = await adapter.open({ bytes: kitchenSink(), format: "docx", document_id: "doc-charts" });
  if (out.outcome !== "opened") throw new Error("open failed: " + JSON.stringify(out));
  return { adapter, ref: out.document_model_ref };
};

describe("insert_chart through the session plan", () => {
  it("carries every chart kind, its categories/series and the extent into the plan", async () => {
    const engine = createFakeDocxEngine();
    const parsed = await engine.parseDocx(kitchenSink());
    for (const [spec, extent] of [
      [BAR, { w: 560, h: 262 }],
      [LINE, undefined],
      [PIE, { w: 480, h: 240 }],
    ] as const) {
      const model = new DocxSessionModel(parsed);
      model.insertChart(1, spec, extent);
      const { finalBlocks } = model.savePlan();
      expect(finalBlocks[1]).toEqual({ kind: "chart", chart: spec, ...(extent ? { extentPx: extent } : {}) });
      // the untouched originals stay byte-referenced, not re-generated
      expect(finalBlocks[0]).toEqual({ kind: "original", docxIndex: 0 });
      expect(finalBlocks[2]).toEqual({ kind: "original", docxIndex: 1 });
    }
  });

  it("adapter edit writes the chart block and a fresh chart part", async () => {
    const { adapter, ref } = await openKitchen();
    adapter.edit(ref, { op: "insert_chart", index: 1, chart: BAR, extentPx: { w: 560, h: 262 } });
    const saved = await adapter.serialize({ document_model_ref: ref, format: "docx" });
    const pkg = decodeFakeDocx(saved.bytes) as { blocks: Array<Record<string, unknown>>; parts: Record<string, string> };
    const chart = pkg.blocks.find((b) => b.type === "chart");
    expect(chart?.chart).toEqual(BAR);
    const chartParts = Object.keys(pkg.parts).filter((p) => /^word\/charts\/chart\d+\.xml$/.test(p));
    expect(chartParts).toHaveLength(2); // the original chart1 + the inserted part
    expect(chartParts).toContain("word/charts/chart1.xml");
    // the pre-existing chart part and the non-chart parts keep their content
    expect(pkg.parts["word/charts/chart1.xml"]).toBe("<c:chartSpace/>");
    expect(pkg.parts["word/charts/embeddings/workbook1.xlsx"]).toBe("XLSX");
    expect(pkg.parts["customXml/item1.xml"]).toBe("<custom/>");
  });

  it("two inserted charts allocate distinct parts in one save", async () => {
    const { adapter, ref } = await openKitchen();
    adapter.edit(ref, { op: "insert_chart", index: 1, chart: BAR });
    adapter.edit(ref, { op: "insert_chart", index: 2, chart: PIE });
    const saved = await adapter.serialize({ document_model_ref: ref, format: "docx" });
    const pkg = decodeFakeDocx(saved.bytes) as { blocks: Array<Record<string, unknown>>; parts: Record<string, string> };
    const charts = pkg.blocks.filter((b) => b.type === "chart");
    expect(charts.map((b) => (b.chart as DocxNewChart).kind)).toEqual(["bar", "pie"]);
    const parts = Object.keys(pkg.parts).filter((p) => /^word\/charts\/chart\d+\.xml$/.test(p));
    expect(parts).toHaveLength(3); // the original chart1 + two new parts
  });

  it("unrelated edits keep chart parts byte-identical", async () => {
    const { adapter, ref } = await openKitchen();
    adapter.edit(ref, { op: "set_paragraph_text", docxIndex: 0, runs: [{ text: "ALPHA" }] });
    const saved = await adapter.serialize({ document_model_ref: ref, format: "docx" });
    const pkg = decodeFakeDocx(saved.bytes) as { parts: Record<string, string> };
    expect(pkg.parts["word/charts/chart1.xml"]).toBe("<c:chartSpace/>");
    expect(pkg.parts["word/charts/embeddings/workbook1.xlsx"]).toBe("XLSX");
    expect(pkg.parts["customXml/item1.xml"]).toBe("<custom/>");
  });
});

describe("insert_chart refusals", () => {
  const refuse = async (chart: unknown, extentPx?: unknown): Promise<string> => {
    const { adapter, ref } = await openKitchen();
    const code = errCode(() =>
      adapter.edit(ref, { op: "insert_chart", index: 1, chart: chart as DocxNewChart, extentPx: extentPx as DocxChartExtent | undefined }),
    );
    // a refused edit never reaches the plan: the model stays clean and saves
    // the original bytes untouched
    expect(adapter.isDirty(ref)).toBe(false);
    const saved = await adapter.serialize({ document_model_ref: ref, format: "docx" });
    expect(saved.bytes).toEqual(kitchenSink());
    return code;
  };

  it("refuses a missing/foreign payload", async () => {
    expect(await refuse(undefined)).toBe("bad_chart");
    expect(await refuse("bar")).toBe("bad_chart");
    expect(await refuse({})).toBe("bad_chart_kind");
    expect(await refuse({ ...BAR, kind: "histogram" })).toBe("bad_chart_kind");
  });

  it("refuses a blank or non-string title", async () => {
    expect(await refuse({ ...BAR, title: "  " })).toBe("empty_chart_title");
    expect(await refuse({ ...BAR, title: 7 })).toBe("empty_chart_title");
  });

  it("refuses empty or non-string categories", async () => {
    expect(await refuse({ ...BAR, categories: [] })).toBe("empty_chart_data");
    expect(await refuse({ ...BAR, categories: ["Q1", 2] })).toBe("empty_chart_data");
    expect(await refuse({ ...BAR, categories: undefined })).toBe("empty_chart_data");
  });

  it("refuses empty series, blank names and misaligned values", async () => {
    expect(await refuse({ ...BAR, series: [] })).toBe("empty_chart_data");
    expect(await refuse({ ...BAR, series: [{ name: " ", values: [1, 2, 3] }] })).toBe("bad_chart_series");
    expect(await refuse({ ...BAR, series: [{ name: "S", values: [1, 2] }] })).toBe("bad_chart_series");
    expect(await refuse({ ...BAR, series: [{ name: "S", values: [1, 2, 3, 4] }] })).toBe("bad_chart_series");
  });

  it("refuses non-finite and all-gap data", async () => {
    expect(await refuse({ ...BAR, series: [{ name: "S", values: [1, Number.NaN, 3] }] })).toBe("bad_chart_series");
    expect(await refuse({ ...BAR, series: [{ name: "S", values: [1, Number.POSITIVE_INFINITY, 3] }] })).toBe("bad_chart_series");
    expect(await refuse({ ...BAR, series: [{ name: "S", values: ["1", 2, 3] }] })).toBe("bad_chart_series");
    expect(await refuse({ ...BAR, series: [{ name: "S", values: [null, null, null] }] })).toBe("empty_chart_data");
  });

  it("accepts gaps beside at least one number", async () => {
    const { adapter, ref } = await openKitchen();
    adapter.edit(ref, { op: "insert_chart", index: 1, chart: { ...BAR, series: [{ name: "S", values: [null, 2, null] }] } });
    expect(adapter.isDirty(ref)).toBe(true);
  });

  it("refuses a non-positive extent", async () => {
    expect(await refuse(BAR, { w: 0, h: 240 })).toBe("bad_chart_extent");
    expect(await refuse(BAR, { w: 560, h: -1 })).toBe("bad_chart_extent");
    expect(await refuse(BAR, { w: 560 })).toBe("bad_chart_extent");
    expect(await refuse(BAR, "560x240")).toBe("bad_chart_extent");
  });

  it("refuses an out-of-range insert index after the payload passes", async () => {
    const { adapter, ref } = await openKitchen();
    expect(errCode(() => adapter.edit(ref, { op: "insert_chart", index: 99, chart: BAR }))).toBe("bad_index");
  });
});

describe("chart seam module", () => {
  it("stands on its own with the same spec refusals (split out of engine.ts)", () => {
    const extent: DocxChartExtent = { w: 560, h: 262 };
    expect(() => requireDocxNewChart(BAR, extent)).not.toThrow();
    expect(errCode(() => requireDocxNewChart(BAR, { ...extent, w: 0 }))).toBe("bad_chart_extent");
    expect(errCode(() => requireDocxChartExtent("560x262"))).toBe("bad_chart_extent");
    expect(errCode(() => requireDocxNewChart({ ...BAR, kind: "histogram" }))).toBe("bad_chart_kind");
  });
});
