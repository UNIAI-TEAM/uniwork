// DOCX chart insert surface (B8): the spec types the vendored save embeds and
// the refusals that keep a malformed payload out of the save plan.
//
// Why a module of its own: the chart block pushed engine.ts past the 500-line
// budget (494 → 580 lines), and the seam's established pattern is a
// per-feature sibling for exactly this kind of code (`fields.ts`,
// `protection.ts`, `page-decor.ts`, `shapes.ts`). The move is
// behaviour-neutral; `DocxSaveBlock` still declares the chart row and
// index.ts re-exports this surface, so importers are untouched.
//
// Upstream shape this mirrors (READ ONLY, never imported):
//   NewChart      packages/docx-engine/src/types.ts:1122
//   embedChart    packages/docx-engine/src/patch.ts:536 (the save writes a
//                 fresh word/charts/chartN.xml + embedded workbook + rels +
//                 the wp:inline drawing)
import { DocxEngineError } from "./engine";

/** One series of a NEW chart: the name plus one value per category; null is a
 * gap (upstream buildChartPartXml writes no c:pt for it). */
export interface DocxNewChartSeries {
  name: string;
  values: Array<number | null>;
}

/** DocxNewChart — upstream types.ts:1122 NewChart verbatim: the three kinds
 * the vendored buildChartPartXml draws. The save writes word/charts/chartN.xml
 * + the embedded workbook + the drawing paragraph (patch.ts:527 ff.). */
export interface DocxNewChart {
  kind: "bar" | "line" | "pie";
  title?: string;
  categories: string[];
  series: DocxNewChartSeries[];
}

/** Chart display size in px — upstream patch.ts:105 extentPx. */
export interface DocxChartExtent {
  w: number;
  h: number;
}

function requireChartSeries(name: unknown, values: unknown, categoryCount: number): asserts values is Array<number | null> {
  if (typeof name !== "string" || name.trim().length === 0) {
    throw new DocxEngineError("bad_chart_series", "every chart series needs a non-blank name");
  }
  if (!Array.isArray(values) || values.length !== categoryCount) {
    throw new DocxEngineError(
      "bad_chart_series",
      "series " + name + " needs one value per category (" + categoryCount + ")",
    );
  }
  for (const value of values) {
    if (value !== null && (typeof value !== "number" || !Number.isFinite(value))) {
      throw new DocxEngineError("bad_chart_series", "series " + name + " has a value that is not a finite number or null");
    }
  }
}

/** Refuse a malformed insert_chart payload before it reaches the save plan.
 * The vendored save embeds whatever it is handed, so the seam is the only
 * place a dropped category, a misaligned series or a non-finite number is
 * caught; callers branch on the DocxEngineError code, never the message. */
export function requireDocxNewChart(chart: unknown, extentPx?: unknown): asserts chart is DocxNewChart {
  if (!chart || typeof chart !== "object") {
    throw new DocxEngineError("bad_chart", "insert_chart needs a chart spec");
  }
  const spec = chart as DocxNewChart;
  if (spec.kind !== "bar" && spec.kind !== "line" && spec.kind !== "pie") {
    throw new DocxEngineError("bad_chart_kind", "chart kind " + String(spec.kind) + " is not bar/line/pie");
  }
  if (spec.title !== undefined && (typeof spec.title !== "string" || spec.title.trim().length === 0)) {
    throw new DocxEngineError("empty_chart_title", "chart title must be omitted or non-blank text");
  }
  if (!Array.isArray(spec.categories) || spec.categories.length === 0 || spec.categories.some((c) => typeof c !== "string")) {
    throw new DocxEngineError("empty_chart_data", "chart categories must be a non-empty string list");
  }
  if (!Array.isArray(spec.series) || spec.series.length === 0) {
    throw new DocxEngineError("empty_chart_data", "chart series must be a non-empty list");
  }
  let numeric = false;
  for (const series of spec.series) {
    requireChartSeries(series?.name, series?.values, spec.categories.length);
    if (!numeric) numeric = series.values.some((value) => value !== null);
  }
  if (!numeric) {
    throw new DocxEngineError("empty_chart_data", "chart has no numeric value to draw");
  }
  if (extentPx !== undefined) requireDocxChartExtent(extentPx);
}

/** Positive finite display size or a typed refusal (mirrors bad_image_size). */
export function requireDocxChartExtent(extentPx: unknown): asserts extentPx is DocxChartExtent {
  const extent = extentPx as Partial<DocxChartExtent> | null;
  const w = extent?.w;
  const h = extent?.h;
  const bad =
    typeof w !== "number" ||
    typeof h !== "number" ||
    !Number.isFinite(w) ||
    !Number.isFinite(h) ||
    w <= 0 ||
    h <= 0;
  if (bad) {
    throw new DocxEngineError(
      "bad_chart_extent",
      "insert_chart extentPx needs positive w/h, got " + String(w) + "x" + String(h),
    );
  }
}
