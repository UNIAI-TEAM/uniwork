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

/** One parsed table cell (vendored TableCell subset): `paras` is the text,
 * `colSpan`/`gridGap`/`vMerge` decide which grid column it occupies and
 * whether it carries content. `hMerge` never reaches the model — the vendored
 * parse folds its continuations into the cell to their left (parse.ts:4681). */
export interface DocxChartTableCell {
  paras?: string[];
  /** w:gridSpan: one array entry covering this many grid columns. */
  colSpan?: number;
  /** w:gridBefore/w:gridAfter placeholder: occupies columns, has no cell. */
  gridGap?: boolean;
  /** 'continue' is merged away: the content belongs to the restart cell above. */
  vMerge?: "restart" | "continue";
}

/** The parsed table shape this flow reads (vendored TableModel subset). */
export interface DocxChartTableModel {
  rows: Array<Array<DocxChartTableCell>>;
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

function cellText(cell: DocxChartTableCell | undefined): string {
  // A merged-away cell has no content of its own even when a producer left
  // text in it: Word renders the restart cell above.
  if (!cell || cell.vMerge === "continue") return "";
  return (cell.paras ?? []).join(" ").trim();
}

/** Lay a parsed row over the table grid: index = grid column, undefined = a
 * w:gridBefore/w:gridAfter pad. A colSpan cell repeats across the columns it
 * spans (one array entry covers several grid columns), so names and values
 * below are read by grid column and stay paired even in merged tables. */
function gridRow(cells: DocxChartTableCell[] | undefined): Array<DocxChartTableCell | undefined> {
  const grid: Array<DocxChartTableCell | undefined> = [];
  for (const cell of cells ?? []) {
    const span = Number.isInteger(cell.colSpan) && (cell.colSpan ?? 1) > 1 ? (cell.colSpan as number) : 1;
    for (let i = 0; i < span; i += 1) grid.push(cell.gridGap ? undefined : cell);
  }
  return grid;
}

/** First grid column the body actually fills: a leading gridGap pad is not
 * the category column. */
function firstContentColumn(body: Array<Array<DocxChartTableCell | undefined>>): number {
  const columns = Math.max(0, ...body.map((row) => row.length));
  for (let column = 0; column < columns; column += 1) {
    if (body.some((row) => row[column] !== undefined)) return column;
  }
  return 0;
}

/** Read a parsed table as chart data (Word/Excel layout): the first row names
 * the series, the first content column labels the categories, every other
 * grid column holding a cell is a value. Null when the table is missing or
 * has fewer than two rows/columns — nothing to plot. */
export function chartDataFromTable(table: DocxChartTableModel | null | undefined): DocxChartTableData | null {
  const rows = Array.isArray(table?.rows) ? table.rows.map(gridRow) : [];
  if (rows.length < 2) return null;
  const body = rows.slice(1);
  const categoryColumn = firstContentColumn(body);
  const columns = Math.max(0, ...rows.map((row) => row.length));
  const seriesColumns: number[] = [];
  for (let column = categoryColumn + 1; column < columns; column += 1) {
    if (rows.some((row) => row[column] !== undefined)) seriesColumns.push(column);
  }
  const series = seriesColumns.map((column) => ({
    name: cellText(rows[0]![column]),
    values: body.map((row) => parseDocxChartNumber(cellText(row[column]))),
  }));
  if (series.length === 0) return null;
  return { categories: body.map((row) => cellText(row[categoryColumn])), series };
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
  // A grid with no number anywhere is the blank state the dialog opens on: it
  // reads as noValues even though the seeded series name is also blank, so the
  // first refusal is the one the user has to act on (enter a value).
  if (!draft.series.some((series) => series.values.some((value) => value !== null))) return "noValues";
  for (const series of draft.series) {
    if (series.name.trim() === "") return "seriesName";
    if (series.values.length !== draft.categories.length) return "seriesLength";
  }
  return null;
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
