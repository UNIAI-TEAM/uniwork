// G3-05c (UNI-824) - bridge from the G2 render model (XlsxRenderModel, read
// by the open:xlsx job) to the shapes the vendored genoffice sheets renderer
// consumes (WorkbookFile + WorkbookRangeResult). The vendored code is not
// edited: this module is the boundary that lets it run unchanged in UniWork.
import { seedFittedColumnWidths } from "./xlsx-column-autofit";
import type { XlsxRenderDefinedName, XlsxRenderModel, XlsxRenderSheet, XlsxRenderStyle, XlsxRenderTable } from "@uniwork/office-engine/xlsx";

/** One file-native table in the genoffice `WorkbookFile` sheet shape (the
 *  subset the vendored loader and the ribbon read). `styleName` is left out on
 *  purpose: the loader paints banding only for a named style, and the style
 *  colours are resolved sidecar-side, so omitting it keeps the file's cells
 *  unpainted rather than inventing colours. */
export interface RendererWorkbookTable {
  range: { startRow: number; startColumn: number; endRow: number; endColumn: number };
  headerRowCount: number;
  showRowStripes: boolean;
  showColumnStripes: boolean;
  name: string;
  columns: string[];
  totalsRowCount?: number;
}

/** One workbook defined name as the vendored loader consumes it (the
 *  genoffice `DefinedNameEntry` shape). `sheetIndex` is the 0-based sheet
 *  position; absent means workbook scope. */
export interface RendererWorkbookDefinedName {
  name: string;
  formula: string;
  sheetIndex?: number;
  /** Reader-only: the loader ignores it, the name manager needs it to know the
   *  name cannot be modelled and must ride preserveNames instead. */
  hidden?: boolean;
}

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
  definedNames: RendererWorkbookDefinedName[];
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
  tables: RendererWorkbookTable[];
  comments: never[];
  pivotRanges: never[];
  /** X01: per family, whether the file ships no rules, classic rules, or
   *  Excel extended (x14) rules the declarative save cannot rewrite. The
   *  loader ignores it; the renderer's rule-set policy and the DV/CF ribbon
   *  groups read it. */
  ruleSets?: { conditionalFormats: XlsxRuleSetFileState; dataValidations: XlsxRuleSetFileState };
  /** The file's raw classic rule element counts per family (review r2 M-B):
   *  the policy refuses a family whose installed rules fall short of it. */
  ruleCounts?: { conditionalFormats: number; dataValidations: number };
}

type XlsxRuleSetFileState = "none" | "classic" | "x14";

/** A rule the parser skipped (no priority, an unreadable sqref) still counts:
 *  the raw element count makes the family classic (review r2 m-4). */
function ruleSetFileState(x14: boolean | undefined, rules: readonly unknown[] | undefined, raw: number | undefined): XlsxRuleSetFileState {
  if (x14) return "x14";
  return (rules && rules.length > 0) || (raw ?? 0) > 0 ? "classic" : "none";
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
  conditionalRules: NonNullable<XlsxRenderSheet["conditionalRules"]>[number][];
  autoFilter: null;
  autoFilterColumns: never[];
  dataValidations: NonNullable<XlsxRenderSheet["dataValidations"]>[number][];
  sheetProtection: null;
  protectedRanges: never[];
  pageSetup: null;
  rowBreaks: never[];
  colBreaks: never[];
  /** A client-side model is fully readable; the field keeps the loader's
   *  retry heuristics from waiting on a sidecar that will never index. */
  indexedThroughRow: number | null;
  indexingComplete: boolean;
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
    sheets: model.sheets.map((sheet) => toRendererWorkbookSheet(sheet, model.styles)),
    styles: model.styles as RendererWorkbookStyle[],
    dxfStyles: model.dxfStyles as RendererWorkbookStyle[],
    visuals: [],
    definedNames: (model.definedNames ?? []).map((name) => toRendererDefinedName(name)),
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

/** Map the render model's name entry to the loader's shape. The reader-only
 *  `hidden` flag is deliberately kept (the loader ignores it) so the name
 *  manager can tell a hidden name cannot be modelled and must ride
 *  preserveNames. */
function toRendererDefinedName(defined: XlsxRenderDefinedName): RendererWorkbookDefinedName {
  return {
    name: defined.name,
    formula: defined.formula,
    ...(defined.sheetIndex === undefined ? {} : { sheetIndex: defined.sheetIndex }),
    ...(defined.hidden ? { hidden: true } : {}),
  };
}

function toRendererWorkbookTable(table: XlsxRenderTable): RendererWorkbookTable {
  return {
    range: { ...table.area },
    headerRowCount: table.headerRow ? 1 : 0,
    showRowStripes: table.bandedRows,
    showColumnStripes: false,
    name: table.name,
    columns: [...table.columnNames],
    ...(table.totalsRow ? { totalsRowCount: 1 } : {}),
  };
}

function toRendererWorkbookSheet(sheet: XlsxRenderSheet, styles: readonly XlsxRenderStyle[]): RendererWorkbookSheet {
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
    // Renderer-only: unsized columns get a content-fitted width (never a
    // customWidth); the model the save path reads is not touched.
    columnWidths: seedFittedColumnWidths(sheet, styles),
    pivotTables: [],
    tables: (sheet.tables ?? []).map((table) => toRendererWorkbookTable(table)),
    comments: [],
    pivotRanges: [],
    ruleSets: {
      conditionalFormats: ruleSetFileState(sheet.x14ConditionalFormats, sheet.conditionalRules, sheet.ruleCounts?.conditionalFormats),
      dataValidations: ruleSetFileState(sheet.x14DataValidations, sheet.dataValidations, sheet.ruleCounts?.dataValidations),
    },
    ...(sheet.ruleCounts ? { ruleCounts: { ...sheet.ruleCounts } } : {}),
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
  const rowStyles = new Map(sheet.rowsMeta.map((row) => [row.row, row.styleIndex]));
  for (let row = range.startRow; row <= range.endRow; row += 1) {
    for (let column = range.startColumn; column <= range.endColumn; column += 1) {
      const address = A1(row, column);
      const cell = sheet.cells[address];
      if (!cell) continue;
      const columnStyle = sheet.columnWidths.findLast((span) => span.styleIndex !== undefined &&
        column >= span.startColumn && column <= span.endColumn)?.styleIndex;
      const styleIndex = cell.s ?? rowStyles.get(row) ?? columnStyle ?? (model.styles[0] ? 0 : undefined);
      cells.push({
        row,
        column,
        value: cell.f !== undefined ? (cell.c ?? null) : (cell.v ?? null),
        ...(cell.f === undefined ? {} : { formula: cell.f }),
        ...(styleIndex === undefined ? {} : { styleIndex }),
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
    // The pinned loader installs sheet-wide rules once, including offscreen
    // ranges. Do not clip them to the first requested viewport.
    conditionalRules: (sheet.conditionalRules ?? []).map((rule) => ({ ...rule,
      ranges: rule.ranges.map((area) => ({ ...area })), formulas: [...rule.formulas],
      cfvos: rule.cfvos.map((value) => ({ ...value })), colors: [...rule.colors],
    })),
    autoFilter: null,
    autoFilterColumns: [],
    // X01: sheet-wide like CF - the pinned loader installs them once (it
    // marks the sheet even without rules, which unlocks DV/CF editing).
    // An absent errorStyle is OOXML's "stop" (the save writes Univer's STOP
    // that way); the loader would install it as undefined, which Univer
    // treats as allow-invalid, so a reopened rule would stop rejecting.
    dataValidations: (sheet.dataValidations ?? []).map((rule) => ({ ...rule,
      ranges: rule.ranges.map((area) => ({ ...area })), formulas: [...rule.formulas],
      errorStyle: rule.errorStyle ?? "stop",
    })),
    sheetProtection: null,
    protectedRanges: [],
    pageSetup: null,
    rowBreaks: [],
    colBreaks: [],
    indexedThroughRow: sheet.rowCount - 1,
    indexingComplete: true,
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
