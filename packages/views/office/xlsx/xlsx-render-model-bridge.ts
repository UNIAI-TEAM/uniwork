// G3-05c (UNI-824) - bridge from the G2 render model (XlsxRenderModel, read
// by the open:xlsx job) to the shapes the vendored genoffice sheets renderer
// consumes (WorkbookFile + WorkbookRangeResult). The vendored code is not
// edited: this module is the boundary that lets it run unchanged in UniWork.
import type { XlsxRenderModel, XlsxRenderSheet, XlsxRenderStyle } from "@uniwork/office-engine/xlsx";

/** The subset of the genoffice WorkbookFile the vendored loader reads. */
export interface RendererWorkbookFile {
  sessionId: string;
  name: string;
  sha256: string;
  fileBytes?: number;
  entryCount: number;
  sheets: RendererWorkbookSheet[];
  styles: RendererWorkbookStyle[];
  dxfStyles: RendererWorkbookStyle[];
  visuals: never[];
  definedNames: never[];
  activeTab: number;
  readOnly: boolean;
  themeColors?: string[];
  themeFonts?: { major: string; minor: string; minorEa?: string };
  normalFontName?: string;
  shortDateFormat?: string;
  date1904?: boolean;
}

export interface RendererWorkbookSheet {
  id: string;
  name: string;
  rowCount: number;
  columnCount: number;
  hidden: boolean;
  showGridLines: boolean;
  showFormulas: boolean;
  showRowColHeaders: boolean;
  rightToLeft: boolean;
  tabColor: string | null;
  defaultRowHeight: number | null;
  defaultRowHeightFixed: boolean;
  defaultColumnWidth?: number;
  baseColumnWidth?: number;
  freeze: { frozenRows: number; frozenColumns: number } | null;
  zoomScale?: number;
  columnWidths: {
    startColumn: number;
    endColumn: number;
    width?: number;
    customWidth?: boolean;
    hidden?: boolean;
    outlineLevel?: number;
    collapsed?: boolean;
    styleIndex?: number;
  }[];
  pivotTables: never[];
}

type RendererWorkbookStyle = XlsxRenderStyle;

export interface RendererRangeCell {
  row: number;
  column: number;
  value: string | number | boolean | null;
  formula?: string;
  styleIndex?: number;
}

export interface RendererRangeResult {
  cells: RendererRangeCell[];
  rows: {
    row: number;
    height?: number;
    customHeight?: boolean;
    hidden: boolean;
    outlineLevel?: number;
    collapsed?: boolean;
    styleIndex?: number;
  }[];
  merges: { startRow: number; endRow: number; startColumn: number; endColumn: number }[];
  hyperlinks: { row: number; column: number; target: string }[];
  conditionalRules: never[];
  autoFilter: null;
  autoFilterColumns: never[];
  dataValidations: never[];
  sheetProtection: null;
  protectedRanges: never[];
  pageSetup: null;
  rowBreaks: never[];
  colBreaks: never[];
  /** A client-side model is fully readable; the field keeps the loader's
   *  retry heuristics from waiting on a sidecar that will never index. */
  indexedThroughRow: number | null;
  [key: string]: unknown;
}

export interface RenderModelMeta {
  sessionId: string;
  name: string;
  sha256: string;
  fileBytes?: number;
  entryCount?: number;
  shortDateFormat?: string;
}

export function toRendererWorkbookFile(model: XlsxRenderModel, meta: RenderModelMeta): RendererWorkbookFile {
  return {
    sessionId: meta.sessionId,
    name: meta.name,
    sha256: meta.sha256,
    ...(meta.fileBytes === undefined ? {} : { fileBytes: meta.fileBytes }),
    entryCount: meta.entryCount ?? 0,
    sheets: model.sheets.map((sheet) => toRendererWorkbookSheet(sheet)),
    styles: model.styles as RendererWorkbookStyle[],
    dxfStyles: model.dxfStyles as RendererWorkbookStyle[],
    visuals: [],
    definedNames: [],
    activeTab: model.activeTab,
    readOnly: false,
    ...(model.theme === undefined ? {} : { themeColors: [...model.theme.colors] }),
    ...(model.theme === undefined || (model.theme.majorFont === undefined && model.theme.minorFont === undefined)
      ? {}
      : {
          themeFonts: {
            major: model.theme.majorFont ?? model.theme.minorFont ?? "Calibri",
            minor: model.theme.minorFont ?? model.theme.majorFont ?? "Calibri",
            ...(model.theme.minorEa === undefined ? {} : { minorEa: model.theme.minorEa }),
          },
        }),
    ...(model.normalFontName === undefined ? {} : { normalFontName: model.normalFontName }),
    ...(meta.shortDateFormat === undefined ? {} : { shortDateFormat: meta.shortDateFormat }),
    ...(model.date1904 ? { date1904: true } : {}),
  };
}

function toRendererWorkbookSheet(sheet: XlsxRenderSheet): RendererWorkbookSheet {
  return {
    id: sheet.id,
    name: sheet.name,
    rowCount: sheet.rowCount,
    columnCount: sheet.columnCount,
    hidden: sheet.hidden ?? false,
    showGridLines: sheet.showGridLines ?? true,
    showFormulas: sheet.showFormulas ?? false,
    showRowColHeaders: sheet.showRowColHeaders ?? true,
    rightToLeft: sheet.rightToLeft ?? false,
    tabColor: sheet.tabColor ?? null,
    defaultRowHeight: sheet.defaultRowHeight ?? null,
    defaultRowHeightFixed: false,
    ...(sheet.defaultColumnWidth === undefined ? {} : { defaultColumnWidth: sheet.defaultColumnWidth }),
    ...(sheet.baseColWidth === undefined ? {} : { baseColumnWidth: sheet.baseColWidth }),
    freeze: sheet.freeze ?? null,
    ...(sheet.zoomScale === undefined ? {} : { zoomScale: sheet.zoomScale }),
    columnWidths: sheet.columnWidths.map((column) => ({ ...column })),
    pivotTables: [],
  };
}

/** A1 address for a 0-based row/column (shared with the editor selection). */
export const toA1Address = (row: number, column: number): string => A1(row, column);

const A1 = (row: number, column: number): string => {
  let name = "";
  for (let value = column + 1; value > 0; value = Math.floor((value - 1) / 26)) {
    name = String.fromCharCode(65 + ((value - 1) % 26)) + name;
  }
  return `${name}${row + 1}`;
};

export interface XlsxModelRange {
  startRow: number;
  endRow: number;
  startColumn: number;
  endColumn: number;
}

const intersects = (range: XlsxModelRange, area: XlsxModelRange): boolean =>
  area.startRow <= range.endRow && area.endRow >= range.startRow && area.startColumn <= range.endColumn && area.endColumn >= range.startColumn;

/**
 * Serve one viewport window from the in-browser model (checkpoint option A:
 * no service round trip per window). Formula cells carry their cached result
 * as `value` and the formula text in `formula`, exactly like the genoffice
 * sidecar's read_range payload.
 */
export function readRangeFromModel(model: XlsxRenderModel, sheetIdOrName: string, range: XlsxModelRange): RendererRangeResult {
  const sheet = model.sheets.find((candidate) => candidate.id === sheetIdOrName || candidate.name === sheetIdOrName);
  if (!sheet) throw new Error(`xlsx_range_unknown_sheet:${sheetIdOrName}`);
  const cells: RendererRangeCell[] = [];
  for (let row = range.startRow; row <= range.endRow; row += 1) {
    for (let column = range.startColumn; column <= range.endColumn; column += 1) {
      const address = A1(row, column);
      const cell = sheet.cells[address];
      if (!cell) continue;
      cells.push({
        row,
        column,
        value: cell.f !== undefined ? (cell.c ?? null) : (cell.v ?? null),
        ...(cell.f === undefined ? {} : { formula: cell.f }),
        ...(cell.s === undefined ? {} : { styleIndex: cell.s }),
      });
    }
  }
  const rows = sheet.rowsMeta
    .filter((row) => row.row >= range.startRow && row.row <= range.endRow)
    .map((row) => ({
      row: row.row,
      ...(row.height === undefined ? {} : { height: row.height }),
      ...(row.customHeight === undefined ? {} : { customHeight: row.customHeight }),
      hidden: row.hidden ?? false,
      ...(row.outlineLevel === undefined ? {} : { outlineLevel: row.outlineLevel }),
      ...(row.collapsed === undefined ? {} : { collapsed: row.collapsed }),
      ...(row.styleIndex === undefined ? {} : { styleIndex: row.styleIndex }),
    }));
  return {
    cells,
    rows,
    merges: sheet.merges.filter((merge) => intersects(range, merge)).map((merge) => ({ ...merge })),
    hyperlinks: sheet.hyperlinks.filter((link) => link.row >= range.startRow && link.row <= range.endRow && link.column >= range.startColumn && link.column <= range.endColumn),
    conditionalRules: [],
    autoFilter: null,
    autoFilterColumns: [],
    dataValidations: [],
    sheetProtection: null,
    protectedRanges: [],
    pageSetup: null,
    rowBreaks: [],
    colBreaks: [],
    indexedThroughRow: sheet.rowCount - 1,
  };
}

/** The host the renderer controller is mounted with for a local model. */
export interface XlsxModelHost {
  file: RendererWorkbookFile;
  readRange(input: {
    sessionId: string;
    sheetId: string;
    range: XlsxModelRange;
  }): Promise<RendererRangeResult>;
}

export function createXlsxModelHost(model: XlsxRenderModel, meta: RenderModelMeta): XlsxModelHost {
  const file = toRendererWorkbookFile(model, meta);
  return {
    file,
    async readRange(input) {
      return readRangeFromModel(model, input.sheetId, input.range);
    },
  };
}
