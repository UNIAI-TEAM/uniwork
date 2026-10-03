// B8 (UNI-924): pure chart logic for the insert flow — table extraction, draft
// validation, and the DocxNewChart / chartDisplay payloads the engine op and
// the vendored docProtected node view consume. No editor, no DOM: the TipTap
// glue lives in ./docx-chart-commands.
import type { DocxNewChart } from "@uniwork/office-engine/docx";

export type DocxChartKind = "bar" | "line" | "pie";

/** The kinds the vendored buildChartPartXml embeds (NewChart union). */
export const DOCX_CHART_KINDS: readonly DocxChartKind[] = ["bar", "line", "pie"];

/** Display defaults mirroring the vendored renderer: chartPlotWidth =
 * widthPx ?? 560, drawChartSvg height = heightPx ?? 240 minus the title row
 * drawn above the plot (CHART_TITLE_ROW_PX). */
export const DOCX_CHART_WIDTH_PX = 560;
export const DOCX_CHART_PLOT_HEIGHT_PX = 240;
export const DOCX_CHART_TITLE_ROW_PX = 22;

export interface DocxChartSeriesDraft {
  name: string;
  values: Array<number | null>;
}

/** One draft chart the insert dialog edits; values stay aligned with
 * categories (one entry per category). */
export interface DocxChartDraft {
  kind: DocxChartKind;
  title: string;
  categories: string[];
  series: DocxChartSeriesDraft[];
}

/** The vendored ChartDisplay fields the protected node view reads. partPath is
 * "" for a chart inserted in this session — the first save writes the chart
 * part and the next parse fills the real path. */
export interface DocxChartDisplay {
  partPath: string;
  kind: DocxChartKind;
  title?: string;
  categories: string[];
  series: DocxChartSeriesDraft[];
  widthPx: number;
  heightPx: number;
}

/** The parsed table shape this flow reads (vendored TableModel subset). */
export interface DocxChartTableModel {
  rows: Array<Array<{ paras?: string[] }>>;
}

export interface DocxChartTableData {
  categories: string[];
  series: DocxChartSeriesDraft[];
}

export type DocxChartDraftError = "noCategories" | "noSeries" | "seriesName" | "seriesLength" | "noValues";

/** A blank grid: three categories, one unnamed series, no numbers — the
 * dialog's Insert entry stays disabled until at least one number arrives. */
export function emptyDocxChartDraft(kind: DocxChartKind = "bar"): DocxChartDraft {
  return {
    kind,
    title: "",
    categories: ["", "", ""],
    series: [{ name: "", values: [null, null, null] }],
  };
}

/** Grid text → value: thousands separators are stripped, anything else
 * unparseable (letters, empty, Infinity) is a gap. */
export function parseDocxChartNumber(raw: string): number | null {
  const text = raw.trim().replace(/\s/g, "").replace(/,/g, "");
  if (text === "") return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

export function formatDocxChartValue(value: number | null): string {
  return value === null ? "" : String(value);
}

function cellText(cell: { paras?: string[] } | undefined): string {
  return (cell?.paras ?? []).join(" ").trim();
}

/** Read a parsed table as chart data (Word/Excel layout): the first row names
 * the series, the first column labels the categories, every other cell is a
 * value. Null when the table is missing or has fewer than two rows/columns —
 * nothing to plot. */
export function chartDataFromTable(table: DocxChartTableModel | null | undefined): DocxChartTableData | null {
  const rows = Array.isArray(table?.rows) ? table.rows : [];
  const columns = rows[0]?.length ?? 0;
  if (rows.length < 2 || columns < 2) return null;
  const body = rows.slice(1);
  const series = rows[0]!.slice(1).map((header, column) => ({
    name: cellText(header),
    values: body.map((row) => parseDocxChartNumber(cellText(row[column + 1]))),
  }));
  if (series.length === 0) return null;
  return { categories: body.map((row) => cellText(row[0])), series };
}

/** Blank series names become visible defaults; everything else is kept. */
export function normalizeDocxChartDraft(draft: DocxChartDraft, seriesName: (index: number) => string): DocxChartDraft {
  return {
    ...draft,
    series: draft.series.map((series, index) => ({
      ...series,
      name: series.name.trim() === "" ? seriesName(index) : series.name,
    })),
  };
}

/** First refusal for a draft, mirroring the engine's insert_chart rules; null
 * when the draft is insertable. */
export function chartDraftError(draft: DocxChartDraft): DocxChartDraftError | null {
  if (draft.categories.length === 0) return "noCategories";
  if (draft.series.length === 0) return "noSeries";
  for (const series of draft.series) {
    if (series.name.trim() === "") return "seriesName";
    if (series.values.length !== draft.categories.length) return "seriesLength";
  }
  return draft.series.some((series) => series.values.some((value) => value !== null)) ? null : "noValues";
}

/** The engine's insert_chart payload; null when the draft is not insertable
 * (the same refusals the engine would throw, surfaced before the call). */
export function chartDraftToSpec(draft: DocxChartDraft): DocxNewChart | null {
  if (chartDraftError(draft) !== null) return null;
  const title = draft.title.trim();
  return {
    kind: draft.kind,
    ...(title === "" ? {} : { title }),
    categories: [...draft.categories],
    series: draft.series.map((series) => ({ name: series.name.trim(), values: [...series.values] })),
  };
}

/** The node view's display model for a fresh insert: an explicit size (the
 * save writes it as wp:extent) and the title row reserved inside the box. */
export function chartDisplayFromSpec(spec: DocxNewChart): DocxChartDisplay {
  return {
    partPath: "",
    kind: spec.kind,
    ...(spec.title === undefined ? {} : { title: spec.title }),
    categories: [...spec.categories],
    series: spec.series.map((series) => ({ name: series.name, values: [...series.values] })),
    widthPx: DOCX_CHART_WIDTH_PX,
    heightPx: DOCX_CHART_PLOT_HEIGHT_PX + (spec.title === undefined ? 0 : DOCX_CHART_TITLE_ROW_PX),
  };
}
