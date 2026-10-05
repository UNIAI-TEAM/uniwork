// PPTX chart edit builders (B3e, UNI-927) — binds the vendored pptx-ops chart
// registry ops to one typed, validated op-builder. The UI half (insert dialog,
// data editor, type switcher) is a later task; the wire round registers
// `add_chart` / `set_chart` as PptxEdit kinds in model.ts.
//
// Vendored source of truth (READ ONLY, cited, never imported):
//   packages/office-upstream/upstream/packages/pptx-ops/src/ops/insert-ops.ts:217-262
//     register addChart — target.slide, kind, offset (EMU rect), categories,
//     series, barDir, title, colorScheme (#RRGGBB[]), holeSizePct.
//   packages/office-upstream/upstream/packages/pptx-ops/src/ops/table-ops.ts:312-339
//     register setChart — target.{slide,el} (element type chart) + structural
//     patch (the editChartElement shape from pptx-engine/src/index.ts:2698-2723).
//   packages/office-upstream/upstream/packages/pptx-engine/src/chart-insert.ts:16-32
//     NewChartKind — the accepted `kind` values pinned by CHART_KINDS below.
import { PptxEngineError, type OpenedPptxLike, type PptxOp } from "../engine";
import { makePxToEmu } from "../model";

/** Accepted chart kinds — parity with chart-insert.ts:16-32 (NewChartKind). */
export const CHART_KINDS = [
  "bar",
  "barStacked",
  "barPercentStacked",
  "line",
  "area",
  "pie",
  "doughnut",
  "scatter",
  "radar",
  "comboBarLine",
  "pie3D",
  "bar3D",
] as const;

export type ChartKind = (typeof CHART_KINDS)[number];

/** One chart series — NewChartOptions.series (chart-insert.ts:52). */
export interface ChartSeriesInput {
  name: string;
  values: number[];
}

export type ChartEdit =
  | {
      op: "add_chart";
      slideIndex: number;
      kind: ChartKind;
      /** Insert rect in viewport pixels; converted to EMU with makePxToEmu. */
      xPx: number;
      yPx: number;
      wPx: number;
      hPx: number;
      categories: string[];
      series: ChartSeriesInput[];
      /** 'bar' = horizontal bars; only meaningful for the bar family. */
      barDir?: "col" | "bar";
      title?: string;
      colorScheme?: string[];
      holeSizePct?: number;
    }
  | {
      op: "set_chart";
      slideIndex: number;
      elementId: string;
      /** Structural chart edit (kind/barDir/categories/series/title/colorScheme/
       * legendPos/dataLabels/gridlines/axis titles/gapWidthPct/holeSizePct/
       * switchRowCol/pointColors) — the UI data editor builds it; validated by
       * the vendored editChartElement, so only object shape is checked here. */
      patch: Record<string, unknown>;
    };

/** requireHexColor parity (registry.ts:38-44): #RRGGBB or #RRGGBBAA. */
const HEX_COLOR_RE = /^#?[0-9A-Fa-f]{6}(?:[0-9A-Fa-f]{2})?$/;

const RECT_FIELDS = ["xPx", "yPx", "wPx", "hPx"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type AddChartEdit = Extract<ChartEdit, { op: "add_chart" }>;
type SetChartEdit = Extract<ChartEdit, { op: "set_chart" }>;

/** The insert rect: four finite px values >= 0 (bad_chart_rect otherwise). */
function checkRect(edit: AddChartEdit): void {
  for (const field of RECT_FIELDS) {
    const value: unknown = edit[field];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      throw new PptxEngineError("bad_chart_rect", field + " must be a finite number >= 0");
    }
  }
}

/** Data/type payload checks mirroring the vendored addChart validate block. */
function checkAddChartFields(edit: AddChartEdit): void {
  if (typeof edit.kind !== "string" || !(CHART_KINDS as readonly string[]).includes(edit.kind)) {
    throw new PptxEngineError("bad_chart_kind", "kind must be one of " + CHART_KINDS.join(", "));
  }
  if (edit.barDir !== undefined && edit.barDir !== "col" && edit.barDir !== "bar") {
    throw new PptxEngineError("bad_chart_kind", 'barDir must be "col" or "bar"');
  }
  if (
    !Array.isArray(edit.categories) ||
    edit.categories.length === 0 ||
    edit.categories.some((category) => typeof category !== "string")
  ) {
    throw new PptxEngineError("bad_chart_data", "categories must be a non-empty array of strings");
  }
  if (!Array.isArray(edit.series) || edit.series.length === 0) {
    throw new PptxEngineError("bad_chart_data", "series must hold at least one {name, values[]}");
  }
  for (const series of edit.series) {
    if (
      !isRecord(series) ||
      typeof series.name !== "string" ||
      !Array.isArray(series.values) ||
      series.values.some((value: unknown) => typeof value !== "number" || !Number.isFinite(value))
    ) {
      throw new PptxEngineError(
        "bad_chart_data",
        "every series needs a string name and finite numeric values",
      );
    }
  }
  if (edit.holeSizePct !== undefined && !Number.isFinite(edit.holeSizePct)) {
    throw new PptxEngineError("bad_chart_data", "holeSizePct must be a finite number");
  }
  if (edit.title !== undefined && typeof edit.title !== "string") {
    throw new PptxEngineError("bad_chart_data", "title must be a string");
  }
  if (
    edit.colorScheme !== undefined &&
    (!Array.isArray(edit.colorScheme) ||
      edit.colorScheme.length === 0 ||
      edit.colorScheme.some((color) => typeof color !== "string" || !HEX_COLOR_RE.test(color)))
  ) {
    throw new PptxEngineError(
      "bad_chart_color",
      "colorScheme must be a non-empty array of #RRGGBB colors",
    );
  }
}

/** addChart op — insert-ops.ts:247-261: px rect -> EMU offset, data verbatim. */
function buildAddChartOp(opened: OpenedPptxLike, fitWidthPx: number, edit: AddChartEdit): PptxOp {
  if (!opened.deck.slides[edit.slideIndex]) {
    throw new PptxEngineError("no_slide", "no slide " + edit.slideIndex);
  }
  checkRect(edit);
  checkAddChartFields(edit);
  const toEmu = makePxToEmu(opened, fitWidthPx);
  return {
    op: "addChart",
    target: { slide: edit.slideIndex },
    kind: edit.kind,
    offset: {
      x: toEmu(edit.xPx),
      y: toEmu(edit.yPx),
      cx: Math.max(1, toEmu(edit.wPx)),
      cy: Math.max(1, toEmu(edit.hPx)),
    },
    categories: edit.categories,
    series: edit.series,
    ...(edit.barDir !== undefined ? { barDir: edit.barDir } : {}),
    ...(edit.title ? { title: edit.title } : {}),
    ...(edit.colorScheme !== undefined ? { colorScheme: edit.colorScheme } : {}),
    ...(edit.holeSizePct !== undefined ? { holeSizePct: edit.holeSizePct } : {}),
  };
}

/** setChart op — table-ops.ts:323-338: target a chart element, pass the patch. */
function buildSetChartOp(opened: OpenedPptxLike, edit: SetChartEdit): PptxOp {
  const slide = opened.deck.slides[edit.slideIndex];
  if (!slide) throw new PptxEngineError("no_slide", "no slide " + edit.slideIndex);
  const element = slide.elements.find((candidate) => candidate.id === edit.elementId);
  if (!element) {
    throw new PptxEngineError(
      "no_element",
      "no element " + edit.elementId + " on slide " + edit.slideIndex,
    );
  }
  if (element.type !== "chart") {
    throw new PptxEngineError(
      "no_element",
      "element " + edit.elementId + " is a " + element.type + ", not a chart",
    );
  }
  if (!isRecord(edit.patch)) {
    throw new PptxEngineError("bad_chart_patch", "patch must be a non-null chart edit object");
  }
  return { op: "setChart", target: { slide: edit.slideIndex, el: edit.elementId }, patch: edit.patch };
}

/** One validated edit -> the vendored pptx-ops op list for runTxn. */
export function buildChartOps(opened: OpenedPptxLike, fitWidthPx: number, edit: ChartEdit): PptxOp[] {
  if (edit.op === "add_chart") return [buildAddChartOp(opened, fitWidthPx, edit)];
  return [buildSetChartOp(opened, edit)];
}
