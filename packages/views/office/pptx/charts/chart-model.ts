/**
 * B3ui (UNI-927) - the Charts panel's pure model: the four ChartEdit payloads
 * the panel emits (insert, data, type, style), the parsers behind its fields,
 * and the validation that mirrors the engine's refusal codes.
 *
 * Provenance (READ ONLY, never imported): the edit union and its guards live in
 * `packages/office-engine/src/pptx/edits/chart-edits.ts` - `ChartEdit` over
 * addChart/setChart, `CHART_KINDS`, `ChartSeriesInput`. This module imports that
 * union's types, so a drift in the engine breaks this file loudly instead of
 * silently emitting a payload the engine would refuse.
 *
 * The three `set_chart` payloads follow the vendored `editChartElement` patch
 * shape (packages/pptx-engine/src/index.ts:2698-2723): kind/barDir/categories/
 * series/title/colorScheme/legendPos/dataLabels/gridlines/gapWidthPct/
 * holeSizePct. The panel never builds a patch key the vendored editor does not
 * read.
 *
 * Pure: no React, no DOM, no engine instance. Every builder returns a result
 * union, never throws, so the panel can show the engine's own refusal reason
 * before the edit reaches the channel.
 */
import {
  CHART_KINDS,
  type ChartEdit,
  type ChartKind,
  type ChartSeriesInput,
} from "@uniwork/office-engine/pptx";

/** Every accepted kind, in the engine's own order (CHART_KINDS). */
export const PPTX_CHART_KINDS: readonly ChartKind[] = CHART_KINDS;

/** One kind offered by the Type section; `labelKey` is under office.pptx.charts. */
export interface PptxChartKindOption {
  kind: ChartKind;
  labelKey: string;
}

/**
 * The i18n key segment for one kind. The engine kind names are camelCase
 * (`barStacked`), but an i18n key must satisfy the panel's lowercase key regex
 * (`/^office\.pptx\.charts\.[a-z0-9_.]+$/`), so the segment is snake_case.
 */
const CHART_KIND_KEY_SEGMENTS: Record<ChartKind, string> = {
  bar: "bar",
  barStacked: "bar_stacked",
  barPercentStacked: "bar_percent_stacked",
  line: "line",
  area: "area",
  pie: "pie",
  doughnut: "doughnut",
  scatter: "scatter",
  radar: "radar",
  comboBarLine: "combo_bar_line",
  pie3D: "pie_3d",
  bar3D: "bar_3d",
};

/** The i18n key for one kind's label: office.pptx.charts.kind.<snake_case>. */
export function chartKindLabelKey(kind: ChartKind): string {
  return "office.pptx.charts.kind." + CHART_KIND_KEY_SEGMENTS[kind];
}

export const PPTX_CHART_KIND_OPTIONS: readonly PptxChartKindOption[] = CHART_KINDS.map((kind) => ({
  kind,
  labelKey: chartKindLabelKey(kind),
}));

/** Bar direction; only the bar family reads it (chart-insert.ts:55). */
export const PPTX_CHART_BAR_DIRS = ["col", "bar"] as const;
export type PptxChartBarDir = (typeof PPTX_CHART_BAR_DIRS)[number];

/** Legend positions the vendored editor accepts ('none' writes no c:legend). */
export const PPTX_CHART_LEGEND_POSITIONS = ["b", "t", "r", "l", "none"] as const;
export type PptxChartLegendPos = (typeof PPTX_CHART_LEGEND_POSITIONS)[number];

/** Insert rect in viewport px - the engine converts it with makePxToEmu. */
export interface PptxChartRect {
  xPx: number;
  yPx: number;
  wPx: number;
  hPx: number;
}

/** Default frame for an inserted chart (the engine's own add_chart shape). */
export const PPTX_CHART_DEFAULT_RECT: PptxChartRect = { xPx: 80, yPx: 70, wPx: 480, hPx: 280 };

/** The Office theme accents 1..6, the engine's default series cycle. */
export const PPTX_CHART_DEFAULT_COLORS: readonly string[] = [
  "#4472C4",
  "#ED7D31",
  "#A5A5A5",
  "#FFC000",
  "#5B9BD5",
  "#70AD47",
];

/** One colour scheme the Style section offers (cycled over the series). */
export interface PptxChartPalette {
  id: string;
  labelKey: string;
  colors: readonly string[];
}

export const PPTX_CHART_PALETTES: readonly PptxChartPalette[] = [
  { id: "office", labelKey: "office.pptx.charts.palette.office", colors: PPTX_CHART_DEFAULT_COLORS },
  {
    id: "warm",
    labelKey: "office.pptx.charts.palette.warm",
    colors: ["#C43E1C", "#E97132", "#F2A65A", "#B45309", "#9A3412", "#A33517"],
  },
  {
    id: "cool",
    labelKey: "office.pptx.charts.palette.cool",
    colors: ["#4338CA", "#0EA5E9", "#06B6D4", "#14B8A6", "#6366F1", "#0F766E"],
  },
  {
    id: "mono",
    labelKey: "office.pptx.charts.palette.mono",
    colors: ["#1F2937", "#475569", "#64748B", "#94A3B8", "#CBD5E1", "#E2E8F0"],
  },
];

/** Chart data: categories plus one entry per series (ChartSeriesInput). */
export interface PptxChartData {
  categories: string[];
  series: ChartSeriesInput[];
}

/** Starter data for a fresh insert: three categories, one series. */
export const PPTX_CHART_DEFAULT_DATA: PptxChartData = {
  categories: ["A", "B", "C"],
  series: [{ name: "Series 1", values: [1, 2, 3] }],
};

/** The engine's `PptxEngineError` codes this panel can produce or forward. */
export type PptxChartRefusalCode =
  | "bad_chart_kind"
  | "bad_chart_rect"
  | "bad_chart_data"
  | "bad_chart_color"
  | "bad_chart_patch"
  | "no_slide"
  | "no_element";

/** A refused input: the engine's code plus a human-readable detail. */
export interface PptxChartRefusal {
  ok: false;
  code: PptxChartRefusalCode;
  message: string;
}

/** Builder result: exactly one validated edit, or the reason it was refused. */
export type PptxChartResult = { ok: true; edit: ChartEdit } | PptxChartRefusal;

/** Data-text parse result (the Data section's editor field). */
export type PptxChartDataParse = { ok: true; data: PptxChartData } | PptxChartRefusal;

function refuse(code: PptxChartRefusalCode, message: string): PptxChartRefusal {
  return { ok: false, code, message };
}

/** Whether a candidate is one of the engine's chart kinds. */
export function isChartKind(value: unknown): value is ChartKind {
  return typeof value === "string" && (CHART_KINDS as readonly string[]).includes(value);
}

export function isChartBarDir(value: unknown): value is PptxChartBarDir {
  return value === "col" || value === "bar";
}

export function isChartLegendPos(value: unknown): value is PptxChartLegendPos {
  return typeof value === "string" && (PPTX_CHART_LEGEND_POSITIONS as readonly string[]).includes(value);
}

/** The kind a panel should show as selected: the reported one, else the first. */
export function resolveChartKind(value: unknown): ChartKind {
  return isChartKind(value) ? value : (CHART_KINDS[0] as ChartKind);
}

/** Bar-family kinds: only these read `barDir` (chart-insert.ts:235). */
export const PPTX_CHART_BAR_KINDS: readonly ChartKind[] = [
  "bar",
  "barStacked",
  "barPercentStacked",
  "bar3D",
];

/** Whether a kind reads a bar direction, so the field can be shown/hidden. */
export function chartKindUsesBarDir(kind: ChartKind): boolean {
  return PPTX_CHART_BAR_KINDS.includes(kind);
}

/** Doughnut is the only kind that reads holeSizePct. */
export function chartKindUsesHoleSize(kind: ChartKind): boolean {
  return kind === "doughnut";
}

/** The engine's `requireHexColor` (registry.ts:38-44): #RRGGBB or #RRGGBBAA. */
const HEX_COLOR_RE = /^#?[0-9A-Fa-f]{6}(?:[0-9A-Fa-f]{2})?$/;

/** True when a series colour is one the engine accepts. */
export function isChartColor(value: string): boolean {
  return HEX_COLOR_RE.test(value);
}

/** "#rrggbb" -> "#RRGGBB"; anything else returns trimmed and unchanged. */
export function normalizeChartColor(value: string): string {
  const trimmed = value.trim();
  if (!HEX_COLOR_RE.test(trimmed)) return trimmed;
  return ("#" + trimmed.replace(/^#/, "")).toUpperCase();
}

/** The four rect fields, in the engine's own order (chart-edits.ts RECT_FIELDS). */
export function validateChartRect(rect: PptxChartRect): PptxChartRefusal | null {
  const fields: Array<keyof PptxChartRect> = ["xPx", "yPx", "wPx", "hPx"];
  for (const field of fields) {
    const value = rect[field];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      return refuse("bad_chart_rect", field + " must be a finite number >= 0");
    }
  }
  return null;
}

/** The engine's add_chart data checks (chart-edits.ts checkAddChartFields). */
export function validateChartData(data: PptxChartData): PptxChartRefusal | null {
  if (!Array.isArray(data.categories) || data.categories.length === 0) {
    return refuse("bad_chart_data", "categories must be a non-empty array of strings");
  }
  if (data.categories.some((category) => typeof category !== "string")) {
    return refuse("bad_chart_data", "every category must be a string");
  }
  if (!Array.isArray(data.series) || data.series.length === 0) {
    return refuse("bad_chart_data", "series must hold at least one {name, values[]}");
  }
  for (const series of data.series) {
    if (typeof series?.name !== "string" || series.name.length === 0) {
      return refuse("bad_chart_data", "every series needs a non-empty name");
    }
    if (!Array.isArray(series.values) || series.values.some((value) => !Number.isFinite(value))) {
      return refuse("bad_chart_data", "every series value must be a finite number");
    }
  }
  return null;
}

/** A colour scheme check mirroring `bad_chart_color`. */
export function validateChartColors(colors: readonly string[]): PptxChartRefusal | null {
  if (!Array.isArray(colors) || colors.length === 0) {
    return refuse("bad_chart_color", "colorScheme must be a non-empty array of #RRGGBB colors");
  }
  for (const color of colors) {
    if (typeof color !== "string" || !isChartColor(color)) {
      return refuse("bad_chart_color", "colorScheme must be a non-empty array of #RRGGBB colors");
    }
  }
  return null;
}

/** Insert request: kind, target slide, optional rect/data/title/style. */
export interface PptxChartInsertRequest {
  slideIndex: number;
  kind: ChartKind;
  rect?: PptxChartRect;
  data?: PptxChartData;
  title?: string;
  barDir?: PptxChartBarDir;
  colors?: readonly string[];
  holeSizePct?: number;
}

/**
 * `add_chart` for an insert. The rect defaults to PPTX_CHART_DEFAULT_RECT and the
 * data to PPTX_CHART_DEFAULT_DATA, so the Insert button never sends an empty
 * chart; every supplied field is validated with the engine's own rules.
 */
export function buildInsertChartEdit(request: PptxChartInsertRequest): PptxChartResult {
  if (!isChartKind(request.kind)) {
    return refuse("bad_chart_kind", "kind must be one of " + CHART_KINDS.join(", "));
  }
  const rect = request.rect ?? PPTX_CHART_DEFAULT_RECT;
  const rectRefusal = validateChartRect(rect);
  if (rectRefusal) return rectRefusal;
  const data = request.data ?? PPTX_CHART_DEFAULT_DATA;
  const dataRefusal = validateChartData(data);
  if (dataRefusal) return dataRefusal;
  if (request.barDir !== undefined && !isChartBarDir(request.barDir)) {
    return refuse("bad_chart_kind", 'barDir must be "col" or "bar"');
  }
  if (request.colors !== undefined) {
    const colorRefusal = validateChartColors(request.colors);
    if (colorRefusal) return colorRefusal;
  }
  if (request.holeSizePct !== undefined && !Number.isFinite(request.holeSizePct)) {
    return refuse("bad_chart_data", "holeSizePct must be a finite number");
  }
  const title = request.title?.trim();
  const edit: Extract<ChartEdit, { op: "add_chart" }> = {
    op: "add_chart",
    slideIndex: request.slideIndex,
    kind: request.kind,
    xPx: rect.xPx,
    yPx: rect.yPx,
    wPx: rect.wPx,
    hPx: rect.hPx,
    categories: [...data.categories],
    series: data.series.map((series) => ({ name: series.name, values: [...series.values] })),
    ...(request.barDir !== undefined ? { barDir: request.barDir } : {}),
    ...(title ? { title } : {}),
    ...(request.colors !== undefined ? { colorScheme: [...request.colors] } : {}),
    ...(request.holeSizePct !== undefined ? { holeSizePct: request.holeSizePct } : {}),
  };
  return { ok: true, edit };
}

/** `set_chart` for the Data section: replace categories + series wholesale. */
export function buildChartDataEdit(
  slideIndex: number,
  elementId: string,
  data: PptxChartData,
): PptxChartResult {
  if (elementId.length === 0) return refuse("no_element", "no chart element is selected");
  const dataRefusal = validateChartData(data);
  if (dataRefusal) return dataRefusal;
  return {
    ok: true,
    edit: {
      op: "set_chart",
      slideIndex,
      elementId,
      patch: {
        categories: [...data.categories],
        series: data.series.map((series) => ({ name: series.name, values: [...series.values] })),
      },
    },
  };
}

/** `set_chart` for the Type section: change kind, optionally the bar direction. */
export function buildChartTypeEdit(
  slideIndex: number,
  elementId: string,
  kind: ChartKind,
  barDir?: PptxChartBarDir,
): PptxChartResult {
  if (elementId.length === 0) return refuse("no_element", "no chart element is selected");
  if (!isChartKind(kind)) {
    return refuse("bad_chart_kind", "kind must be one of " + CHART_KINDS.join(", "));
  }
  if (barDir !== undefined && !isChartBarDir(barDir)) {
    return refuse("bad_chart_kind", 'barDir must be "col" or "bar"');
  }
  return {
    ok: true,
    edit: {
      op: "set_chart",
      slideIndex,
      elementId,
      patch: { kind, ...(barDir !== undefined ? { barDir } : {}) },
    },
  };
}

/** Style request: every field optional; only supplied keys reach the patch. */
export interface PptxChartStyleRequest {
  title?: string;
  legendPos?: PptxChartLegendPos;
  dataLabels?: boolean;
  gridlines?: boolean;
  colors?: readonly string[];
  gapWidthPct?: number;
  holeSizePct?: number;
}

/** `set_chart` for the Style section: title, legend, labels, gridlines, colours. */
export function buildChartStyleEdit(
  slideIndex: number,
  elementId: string,
  style: PptxChartStyleRequest,
): PptxChartResult {
  if (elementId.length === 0) return refuse("no_element", "no chart element is selected");
  const patch: Record<string, unknown> = {};
  if (style.title !== undefined) patch.title = style.title;
  if (style.legendPos !== undefined) {
    if (!isChartLegendPos(style.legendPos)) {
      return refuse("bad_chart_patch", "legendPos must be one of " + PPTX_CHART_LEGEND_POSITIONS.join(", "));
    }
    patch.legendPos = style.legendPos;
  }
  if (style.dataLabels !== undefined) patch.dataLabels = style.dataLabels;
  if (style.gridlines !== undefined) patch.gridlines = style.gridlines;
  if (style.colors !== undefined) {
    const colorRefusal = validateChartColors(style.colors);
    if (colorRefusal) return colorRefusal;
    patch.colorScheme = [...style.colors];
  }
  if (style.gapWidthPct !== undefined) {
    if (!Number.isFinite(style.gapWidthPct) || style.gapWidthPct < 0) {
      return refuse("bad_chart_patch", "gapWidthPct must be a finite number >= 0");
    }
    patch.gapWidthPct = style.gapWidthPct;
  }
  if (style.holeSizePct !== undefined) {
    if (!Number.isFinite(style.holeSizePct)) {
      return refuse("bad_chart_patch", "holeSizePct must be a finite number");
    }
    patch.holeSizePct = style.holeSizePct;
  }
  if (Object.keys(patch).length === 0) {
    return refuse("bad_chart_patch", "the style change is empty");
  }
  return { ok: true, edit: { op: "set_chart", slideIndex, elementId, patch } };
}

/** The palette whose colours match the reported scheme, or null for a custom one. */
export function matchChartPalette(colors: readonly string[] | null | undefined): string | null {
  if (!colors || colors.length === 0) return null;
  const normalized = colors.map((color) => normalizeChartColor(color));
  const hit = PPTX_CHART_PALETTES.find(
    (palette) =>
      palette.colors.length === normalized.length &&
      palette.colors.every((color, index) => color.toUpperCase() === normalized[index]),
  );
  return hit ? hit.id : null;
}

/** Split a data row on tabs, else commas - both paste shapes are common. */
function splitCells(line: string): string[] {
  const separator = line.includes("\t") ? "\t" : ",";
  return line.split(separator).map((cell) => cell.trim());
}

/**
 * Data editor text -> `PptxChartData`. The first row names the series (its first
 * cell is the category-column heading and is ignored); every later row is one
 * category followed by one value per series. A blank cell reads as 0 so a
 * half-filled paste is usable, but a non-numeric cell is refused outright.
 */
export function parseChartData(text: string): PptxChartDataParse {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length < 2) {
    return refuse("bad_chart_data", "enter a header row and at least one data row");
  }
  const header = splitCells(lines[0] as string);
  const seriesNames = header.slice(1).map((name, index) => (name.length > 0 ? name : "Series " + (index + 1)));
  if (seriesNames.length === 0) {
    return refuse("bad_chart_data", "the header row needs at least one series name");
  }
  const categories: string[] = [];
  const values: number[][] = seriesNames.map(() => []);
  for (let row = 1; row < lines.length; row += 1) {
    const cells = splitCells(lines[row] as string);
    const label = (cells[0] ?? "").trim();
    categories.push(label.length > 0 ? label : String(row));
    for (let column = 0; column < seriesNames.length; column += 1) {
      const raw = (cells[column + 1] ?? "").trim();
      const value = raw.length === 0 ? 0 : Number(raw);
      if (!Number.isFinite(value)) {
        return refuse("bad_chart_data", "row " + row + " has a non-numeric value: " + raw);
      }
      (values[column] as number[]).push(value);
    }
  }
  const data: PptxChartData = {
    categories,
    series: seriesNames.map((name, index) => ({ name, values: values[index] as number[] })),
  };
  const refusal = validateChartData(data);
  return refusal ?? { ok: true, data };
}

/** `PptxChartData` -> the tab-separated text the Data editor shows. */
export function formatChartData(data: PptxChartData): string {
  const header = ["", ...data.series.map((series) => series.name)].join("\t");
  const rows = data.categories.map((category, index) => {
    const cells = data.series.map((series) => {
      const value = series.values[index];
      return value === undefined ? "0" : String(value);
    });
    return [category, ...cells].join("\t");
  });
  return [header, ...rows].join("\n");
}