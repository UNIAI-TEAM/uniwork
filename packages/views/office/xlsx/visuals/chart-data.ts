import type { XlsxVisualChart, XlsxVisualChartType } from "@uniwork/office-engine/xlsx";

type RawCell = string | number | boolean | null;

interface BuildChartInput {
  /** Live raw values, row-major, the selected range. */
  values: readonly (readonly RawCell[])[];
  /** Same shape as values, as the grid displays them. */
  display: readonly (readonly string[])[];
  /** 0-based inclusive bounds matching `values`. */
  range: { startRow: number; startColumn: number; endRow: number; endColumn: number };
  sheetName: string;
  chartType: XlsxVisualChartType;
}

const MAX_SERIES = 24;
const MAX_POINTS = 1000;
const MAX_NAME = 255;
const MAX_CATEGORY = 1024;

function columnLetters(index: number): string {
  let n = index + 1;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

function absoluteRef(sheetName: string, column: number, firstRow: number, lastRow: number): string {
  const quoted = `'${sheetName.replace(/'/g, "''")}'`;
  const letters = columnLetters(column);
  return `${quoted}!$${letters}$${firstRow + 1}:$${letters}$${lastRow + 1}`;
}

const isNumber = (v: RawCell | undefined): v is number => typeof v === "number" && Number.isFinite(v);
const isBlank = (v: RawCell | undefined): boolean => v === null || v === undefined || v === "";

function cellAt(grid: readonly (readonly RawCell[])[], r: number, c: number): RawCell {
  return grid[r]?.[c] ?? null;
}

/** Build a chart definition from a selected range using Excel-like header/category detection. */
export function buildChartFromRange(input: BuildChartInput): XlsxVisualChart | null {
  const { values, display, range, sheetName, chartType } = input;
  const rowCount = values.length;
  const colCount = values.reduce((max, row) => Math.max(max, row.length), 0);
  if (rowCount === 0 || colCount === 0 || (rowCount === 1 && colCount === 1)) return null;

  // Header row: no numbers in the data columns of the first row.
  let hasHeader = false;
  if (rowCount > 1) {
    const from = colCount > 1 ? 1 : 0;
    hasHeader = true;
    for (let c = from; c < colCount; c += 1) {
      if (isNumber(cellAt(values, 0, c))) hasHeader = false;
    }
    if (colCount === 1 && isBlank(cellAt(values, 0, 0))) hasHeader = false;
  }
  const dataStart = hasHeader ? 1 : 0;

  // Category column: first column without numbers below the header, with some text.
  let hasCategories = false;
  if (colCount > 1) {
    let anyText = false;
    let anyNumber = false;
    for (let r = dataStart; r < rowCount; r += 1) {
      const v = cellAt(values, r, 0);
      if (isNumber(v)) anyNumber = true;
      else if (!isBlank(v)) anyText = true;
    }
    hasCategories = anyText && !anyNumber;
  }
  const firstDataColumn = hasCategories ? 1 : 0;

  const pointCount = Math.min(rowCount - dataStart, MAX_POINTS);
  if (pointCount <= 0 || firstDataColumn >= colCount) return null;

  let anyNumeric = false;
  for (let r = dataStart; r < dataStart + pointCount && !anyNumeric; r += 1) {
    for (let c = firstDataColumn; c < colCount; c += 1) {
      if (isNumber(cellAt(values, r, c))) {
        anyNumeric = true;
        break;
      }
    }
  }
  if (!anyNumeric) return null;

  const categories: string[] = [];
  for (let i = 0; i < pointCount; i += 1) {
    const text = hasCategories ? (display[dataStart + i]?.[0] ?? "") : "";
    categories.push(text === "" ? String(i + 1) : text.slice(0, MAX_CATEGORY));
  }

  const firstRow = range.startRow + dataStart;
  const lastRow = firstRow + pointCount - 1;
  const categoriesRef = hasCategories ? absoluteRef(sheetName, range.startColumn, firstRow, lastRow) : undefined;

  const lastColumn = chartType === "pie" || chartType === "doughnut" ? firstDataColumn : colCount - 1;
  const series: XlsxVisualChart["series"][number][] = [];
  for (let c = firstDataColumn; c <= lastColumn && series.length < MAX_SERIES; c += 1) {
    const name = hasHeader ? (display[0]?.[c] ?? "").slice(0, MAX_NAME) : "";
    const points: number[] = [];
    for (let i = 0; i < pointCount; i += 1) {
      const v = cellAt(values, dataStart + i, c);
      points.push(isNumber(v) ? v : 0);
    }
    series.push({
      name,
      categories,
      values: points,
      valuesRef: absoluteRef(sheetName, range.startColumn + c, firstRow, lastRow),
      ...(categoriesRef ? { categoriesRef } : {}),
    });
  }

  return { chartType, title: series.length === 1 ? (series[0]?.name ?? "") : "", series };
}

type ChartRange = BuildChartInput["range"];

/** The most of a selection Insert Chart reads: a header row plus the point
 *  cap, a category column plus the series cap. A whole-column or whole-sheet
 *  selection never materialises more than this from the grid. */
export function clampChartRange(range: ChartRange): ChartRange {
  return {
    startRow: range.startRow,
    startColumn: range.startColumn,
    endRow: Math.min(range.endRow, range.startRow + MAX_POINTS),
    endColumn: Math.min(range.endColumn, range.startColumn + MAX_SERIES),
  };
}

/** Drops the blank rows and columns trailing a read (the empty tail of a
 *  whole-column selection), and says whether data reached the read's last
 *  row or column, i.e. whether clamping may have cut data off. */
export function trimBlankEdges(
  values: readonly (readonly RawCell[])[],
  display: readonly (readonly string[])[],
): { values: RawCell[][]; display: string[][]; lastRowFilled: boolean; lastColumnFilled: boolean } {
  const columnCount = values.reduce((max, row) => Math.max(max, row.length), 0);
  let rows = values.length;
  while (rows > 0 && (values[rows - 1] ?? []).every((cell) => isBlank(cell))) rows -= 1;
  let columns = columnCount;
  while (columns > 0 && values.slice(0, rows).every((row) => isBlank(row[columns - 1]))) columns -= 1;
  return {
    values: values.slice(0, rows).map((row) => Array.from({ length: columns }, (_, column) => row[column] ?? null)),
    display: display.slice(0, rows).map((row) => Array.from({ length: columns }, (_, column) => row[column] ?? "")),
    lastRowFilled: rows > 0 && rows === values.length,
    lastColumnFilled: columns > 0 && columns === columnCount,
  };
}

