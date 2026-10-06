// G3-05c (UNI-824) - the XLSX render model reader.
//
// The G3-D3 measurement found the G3-05b snapshot cannot render a workbook:
// `readBasicWorkbook` carries values/formulas only, drops the cached `<v>` of
// formula cells and knows nothing about styles, merges, column widths, row
// heights, frozen panes or hyperlinks. This reader reads the same package
// parts again through the vendored gateway's entry source (ONE inflate pass)
// and produces the model the vendored genoffice sheets renderer needs, so the
// browser can build its Univer grid without parsing OOXML itself.
//
// Placement (checkpoint option A, Advisor-approved): this lives in the
// browser-safe xlsx lane and is consumed by the `open:xlsx` job and by the
// renderer controller; it never touches the Rust sidecar.
import { readSheetTables, type XlsxRenderTable } from "./render-model-tables.ts";
export type { XlsxRenderTable };
import { attribute, decodeXml, elements, parseDefinedNamesXml, sectionInner, type XlsxParsedDefinedName } from "./render-model-xml.ts";
import { parseColorXml, parseStylesXml, parseThemeXml, resolvedColor } from "./render-model-styles.ts";
import { parseConditionalRules, type XlsxRenderConditionalRule } from "./render-model-conditional.ts";
export { parseThemeXml } from "./render-model-styles.ts";

import type { XlsxCellScalar, XlsxGatewayFunctions } from "./engine.ts";

/** One cell as the renderer consumes it. `c` is the cached formula result. */
export interface XlsxRenderCell {
  readonly v?: XlsxCellScalar | undefined;
  readonly f?: string | undefined;
  readonly c?: XlsxCellScalar | undefined;
  readonly s?: number | undefined;
}

export interface XlsxRenderMerge {
  readonly startRow: number;
  readonly endRow: number;
  readonly startColumn: number;
  readonly endColumn: number;
}

export interface XlsxRenderColumn {
  readonly startColumn: number;
  readonly endColumn: number;
  readonly width?: number | undefined;
  readonly customWidth?: boolean | undefined;
  readonly hidden?: boolean | undefined;
  readonly outlineLevel?: number | undefined;
  readonly collapsed?: boolean | undefined;
  readonly styleIndex?: number | undefined;
}

export interface XlsxRenderRow {
  readonly row: number;
  readonly height?: number | undefined;
  readonly customHeight?: boolean | undefined;
  readonly hidden?: boolean | undefined;
  readonly outlineLevel?: number | undefined;
  readonly collapsed?: boolean | undefined;
  readonly styleIndex?: number | undefined;
}

export interface XlsxRenderHyperlink {
  readonly row: number;
  readonly column: number;
  readonly target: string;
}

export interface XlsxRenderSheet {
  /** genoffice sheet id shape (`sheet-<sheetId>`); the gateway uses the same. */
  readonly id: string;
  readonly name: string;
  readonly rowCount: number;
  readonly columnCount: number;
  readonly defaultRowHeight?: number | undefined;
  readonly defaultColumnWidth?: number | undefined;
  readonly baseColWidth?: number | undefined;
  readonly hidden?: boolean | undefined;
  readonly showGridLines?: boolean | undefined;
  readonly showFormulas?: boolean | undefined;
  readonly showRowColHeaders?: boolean | undefined;
  readonly rightToLeft?: boolean | undefined;
  readonly tabColor?: string | null | undefined;
  readonly zoomScale?: number | undefined;
  readonly freeze?: { readonly frozenRows: number; readonly frozenColumns: number } | null | undefined;
  readonly merges: readonly XlsxRenderMerge[];
  readonly columnWidths: readonly XlsxRenderColumn[];
  readonly rowsMeta: readonly XlsxRenderRow[];
  readonly hyperlinks: readonly XlsxRenderHyperlink[];
  readonly cells: Readonly<Record<string, XlsxRenderCell>>;
  readonly conditionalRules?: readonly XlsxRenderConditionalRule[] | undefined;
  /** Tables the file ships (xl/tables/tableN.xml). Additive: an absent value
   *  reads as no tables. Read-only; the write path is the table ops. */
  readonly tables?: readonly XlsxRenderTable[] | undefined;
}

/** Border edge; mirrors the genoffice cell-style contract. */
export interface XlsxRenderBorderEdge {
  readonly style: string;
  readonly color?: string | undefined;
}

/** Cell style; field names mirror the genoffice renderer contract. */
export interface XlsxRenderStyle {
  readonly fontFamily?: string | undefined;
  readonly fontSize?: number | undefined;
  readonly bold: boolean;
  readonly italic: boolean;
  readonly underline: boolean;
  readonly strikethrough: boolean;
  readonly wrapText: boolean;
  readonly shrinkToFit?: boolean | undefined;
  readonly fontColor?: string | undefined;
  readonly fillColor?: string | undefined;
  readonly fontColorTheme?: number | undefined;
  readonly fontColorTint?: number | undefined;
  readonly fillColorTheme?: number | undefined;
  readonly fillColorTint?: number | undefined;
  readonly fontScheme?: "major" | "minor" | undefined;
  readonly horizontalAlignment?: string | undefined;
  readonly verticalAlignment?: string | undefined;
  readonly indent?: number | undefined;
  readonly textRotation?: number | undefined;
  readonly numberFormat?: string | undefined;
  readonly borderTop?: XlsxRenderBorderEdge | undefined;
  readonly borderBottom?: XlsxRenderBorderEdge | undefined;
  readonly borderLeft?: XlsxRenderBorderEdge | undefined;
  readonly borderRight?: XlsxRenderBorderEdge | undefined;
  readonly borderDiagonal?: XlsxRenderBorderEdge | undefined;
  readonly diagonalUp: boolean;
  readonly diagonalDown: boolean;
}

export interface XlsxRenderTheme {
  /** Theme palette in OOXML index order: lt1, dk1, lt2, dk2, accent1-6, hlink, folHlink. */
  readonly colors: readonly string[];
  readonly majorFont?: string | undefined;
  readonly minorFont?: string | undefined;
  readonly minorEa?: string | undefined;
}

/** One workbook defined name as the render model carries it. `sheetIndex` is
 *  the 0-based sheet position (`localSheetId`); `hidden` names are readable but
 *  cannot be modelled by the name-manager form, so consumers preserve them. */
export type XlsxRenderDefinedName = XlsxParsedDefinedName;

export interface XlsxRenderModel {
  readonly revision: number;
  readonly activeTab: number;
  readonly date1904: boolean;
  readonly sheets: readonly XlsxRenderSheet[];
  readonly styles: readonly XlsxRenderStyle[];
  readonly dxfStyles: readonly XlsxRenderStyle[];
  readonly theme?: XlsxRenderTheme | undefined;
  readonly normalFontName?: string | undefined;
  readonly shortDateFormat?: string | undefined;
  /** The workbook's own <definedNames> entries (B7 F1). Additive: readers that
   *  predate the field treat an absent value as an empty list. */
  readonly definedNames?: readonly XlsxRenderDefinedName[] | undefined;
}

// ── XML helpers (same regex-scanning style the vendored gateway uses) ──────

function parseRefRange(ref: string): { startRow: number; endRow: number; startColumn: number; endColumn: number } | null {
  const parts = ref.split(":");
  const toPoint = (address: string): { row: number; column: number } | null => {
    const match = /^\$?([A-Za-z]{1,3})\$?([0-9]+)$/.exec(address.trim());
    if (!match) return null;
    let column = 0;
    for (const char of match[1]!.toUpperCase()) column = column * 26 + char.charCodeAt(0) - 64;
    return { row: Number(match[2]) - 1, column: column - 1 };
  };
  const start = toPoint(parts[0] ?? "");
  const end = toPoint(parts[1] ?? parts[0] ?? "");
  if (!start || !end) return null;
  return {
    startRow: Math.min(start.row, end.row),
    endRow: Math.max(start.row, end.row),
    startColumn: Math.min(start.column, end.column),
    endColumn: Math.max(start.column, end.column),
  };
}

function cellValueOf(type: string | undefined, raw: string, sharedStrings: readonly string[]): XlsxCellScalar | undefined {
  if (type === "s") return sharedStrings[Number(raw)] ?? "";
  if (type === "b") return raw === "1";
  if (type === "str") return decodeXml(raw);
  if (type === "e") return decodeXml(raw);
  const numeric = Number(raw);
  return Number.isFinite(numeric) ? numeric : decodeXml(raw);
}

function parseWorksheetXml(
  xml: string,
  sheetId: string,
  name: string,
  sharedStrings: readonly string[],
  rels: Readonly<Record<string, string>>,
  palette?: readonly string[],
): XlsxRenderSheet {
  const formatPr = elements(xml, "sheetFormatPr")[0];
  const defaultRowHeight = formatPr ? Number(attribute(formatPr.tag, "defaultRowHeight")) : undefined;
  const baseColWidth = formatPr ? Number(attribute(formatPr.tag, "baseColWidth")) : undefined;
  const defaultColumnWidth = formatPr ? Number(attribute(formatPr.tag, "defaultColWidth")) : undefined;

  const sheetViews = elements(sectionInner(xml, "sheetViews"), "sheetView")[0];
  const showGridLines = sheetViews ? attribute(sheetViews.tag, "showGridLines") !== "0" : undefined;
  const showFormulas = sheetViews ? attribute(sheetViews.tag, "showFormulas") === "1" : undefined;
  const rightToLeft = sheetViews ? attribute(sheetViews.tag, "rightToLeft") === "1" : undefined;
  const showRowColHeaders = sheetViews ? attribute(sheetViews.tag, "showRowColHeaders") !== "0" : undefined;
  const zoomScaleRaw = sheetViews ? Number(attribute(sheetViews.tag, "zoomScale") ?? 100) : undefined;
  const tabColor = resolvedColor(parseColorXml(sectionInner(xml, "sheetPr").match(/<tabColor\b[^>]*\/?>/)?.[0]), undefined).rgb;
  const pane = sheetViews ? elements(sheetViews.body, "pane")[0] : undefined;
  const freeze = pane
    ? {
        frozenRows: Number(attribute(pane.tag, "ySplit") ?? 0),
        frozenColumns: Number(attribute(pane.tag, "xSplit") ?? 0),
      }
    : null;

  const merges: XlsxRenderMerge[] = [];
  for (const merge of elements(sectionInner(xml, "mergeCells"), "mergeCell")) {
    const ref = attribute(merge.tag, "ref");
    const range = ref ? parseRefRange(ref) : null;
    if (range) merges.push(range);
  }

  const columns: XlsxRenderColumn[] = [];
  for (const col of elements(sectionInner(xml, "cols"), "col")) {
    const min = Number(attribute(col.tag, "min") ?? 1) - 1;
    const max = Number(attribute(col.tag, "max") ?? 1) - 1;
    const width = attribute(col.tag, "width");
    const customWidth = attribute(col.tag, "customWidth");
    const hidden = attribute(col.tag, "hidden");
    const outlineLevel = attribute(col.tag, "outlineLevel");
    const collapsed = attribute(col.tag, "collapsed");
    const style = attribute(col.tag, "style");
    if (min < 0 || max < min) continue;
    columns.push({
      startColumn: min,
      endColumn: max,
      ...(width === undefined ? {} : { width: Number(width) }),
      ...(customWidth === undefined ? {} : { customWidth: customWidth === "1" || customWidth === "true" }),
      ...(hidden === undefined ? {} : { hidden: hidden === "1" || hidden === "true" }),
      ...(outlineLevel === undefined ? {} : { outlineLevel: Number(outlineLevel) }),
      ...(collapsed === undefined ? {} : { collapsed: collapsed === "1" || collapsed === "true" }),
      ...(style === undefined ? {} : { styleIndex: Number(style) }),
    });
  }

  const rowsMeta: XlsxRenderRow[] = [];
  const cells: Record<string, XlsxRenderCell> = {};
  let maxRow = 0;
  let maxColumn = 0;
  for (const row of elements(xml, "row")) {
    const rowIndex = Number(attribute(row.tag, "r") ?? 0) - 1;
    if (rowIndex < 0) continue;
    const height = attribute(row.tag, "ht");
    const customHeight = attribute(row.tag, "customHeight");
    const hidden = attribute(row.tag, "hidden");
    const outlineLevel = attribute(row.tag, "outlineLevel");
    const collapsed = attribute(row.tag, "collapsed");
    const style = attribute(row.tag, "s");
    const customFormat = attribute(row.tag, "customFormat");
    rowsMeta.push({
      row: rowIndex,
      ...(height === undefined ? {} : { height: Number(height) }),
      ...(customHeight === undefined ? {} : { customHeight: customHeight === "1" || customHeight === "true" }),
      ...(hidden === undefined ? {} : { hidden: hidden === "1" || hidden === "true" }),
      ...(outlineLevel === undefined ? {} : { outlineLevel: Number(outlineLevel) }),
      ...(collapsed === undefined ? {} : { collapsed: collapsed === "1" || collapsed === "true" }),
      ...(style === undefined || (customFormat !== "1" && customFormat !== "true") ? {} : { styleIndex: Number(style) }),
    });
    for (const cell of elements(row.body, "c")) {
      const address = attribute(cell.tag, "r");
      if (!address || !/^[A-Z]{1,3}[1-9][0-9]{0,6}$/.test(address)) continue;
      const point = parseRefRange(address);
      if (!point) continue;
      maxRow = Math.max(maxRow, point.startRow);
      maxColumn = Math.max(maxColumn, point.startColumn);
      const styleIndex = attribute(cell.tag, "s");
      const type = attribute(cell.tag, "t");
      const formula = /<f(?:\s[^>]*[^/>])?>([\s\S]*?)<\/f>/.exec(cell.body)?.[1];
      const rawValue = /<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/.exec(cell.body)?.[1];
      if (formula !== undefined) {
        const cached = rawValue === undefined ? undefined : cellValueOf(type, rawValue, sharedStrings);
        cells[address] = {
          f: `=${decodeXml(formula)}`,
          ...(cached === undefined ? {} : { c: cached }),
          ...(styleIndex === undefined ? {} : { s: Number(styleIndex) }),
        };
        continue;
      }
      const value = type === "inlineStr"
        ? elements(sectionInner(cell.body, "is"), "t").map((part) => decodeXml(part.body)).join("")
        : rawValue === undefined ? undefined : cellValueOf(type, rawValue, sharedStrings);
      cells[address] = {
        ...(value === undefined ? {} : { v: value }),
        ...(styleIndex === undefined ? {} : { s: Number(styleIndex) }),
      };
    }
  }

  const hyperlinks: XlsxRenderHyperlink[] = [];
  for (const link of elements(sectionInner(xml, "hyperlinks"), "hyperlink")) {
    const ref = attribute(link.tag, "ref");
    const relId = attribute(link.tag, "r:id") ?? attribute(link.tag, "id");
    const location = attribute(link.tag, "location");
    const point = ref ? parseRefRange(ref.split(":")[0] ?? "") : null;
    if (!point) continue;
    const target = relId !== undefined ? rels[relId] : location !== undefined ? `#${decodeXml(location)}` : undefined;
    if (!target) continue;
    hyperlinks.push({ row: point.startRow, column: point.startColumn, target });
  }

  const dimension = elements(xml, "dimension")[0];
  const dimensionRange = dimension ? parseRefRange(attribute(dimension.tag, "ref") ?? "") : null;
  const rows = Math.max(maxRow + 1, (dimensionRange?.endRow ?? -1) + 1, 1);
  const columnCount = Math.max(maxColumn + 1, (dimensionRange?.endColumn ?? -1) + 1, 1);

  return {
    id: sheetId,
    name,
    rowCount: rows,
    columnCount,
    ...(defaultRowHeight === undefined || !Number.isFinite(defaultRowHeight) ? {} : { defaultRowHeight }),
    ...(defaultColumnWidth === undefined || !Number.isFinite(defaultColumnWidth) ? {} : { defaultColumnWidth }),
    ...(baseColWidth === undefined || !Number.isFinite(baseColWidth) ? {} : { baseColWidth }),
    ...(showGridLines === undefined ? {} : { showGridLines }),
    ...(showFormulas === undefined ? {} : { showFormulas }),
    ...(showRowColHeaders === undefined ? {} : { showRowColHeaders }),
    ...(rightToLeft === undefined ? {} : { rightToLeft }),
    ...(tabColor === undefined ? {} : { tabColor }),
    ...(zoomScaleRaw === undefined || !Number.isFinite(zoomScaleRaw) ? {} : { zoomScale: zoomScaleRaw }),
    freeze,
    merges,
    columnWidths: columns,
    rowsMeta,
    hyperlinks,
    cells,
    conditionalRules: parseConditionalRules(xml, parseRefRange, palette),
  };
}

// ── reader ─────────────────────────────────────────────────────────────────

const countCells = (sheet: XlsxRenderSheet): number => Object.keys(sheet.cells).length;

/**
 * Read the full render model for one package. The package is inflated once
 * (one entry source) and every part is read from it; the basic workbook parse
 * still supplies the shared-string table and the authoritative sheet ids.
 */
export async function readXlsxRenderModel(engine: XlsxGatewayFunctions, bytes: Uint8Array): Promise<XlsxRenderModel> {
  const imported = await engine.readWorkbook(bytes);
  const sheetNamesById = imported.sheetNamesById;
  const sheetEntries = Object.entries(sheetNamesById).map(([id, name]) => ({ id, name }));

  // Discover the package layout first: workbook relationships name the
  // worksheet parts; the theme/styles parts are conventional.
  const basePaths = ["xl/workbook.xml", "xl/_rels/workbook.xml.rels", "xl/styles.xml", "xl/theme/theme1.xml", "xl/sharedStrings.xml"];
  const base = await engine.readEntriesText(bytes, basePaths);
  const workbookXml = base["xl/workbook.xml"] ?? "";
  const relsXml = base["xl/_rels/workbook.xml.rels"] ?? "";

  // `rels` keeps RAW targets (hyperlink targets are URLs / #fragments);
  // worksheet parts are additionally normalized to package paths.
  const rels: Record<string, string> = {};
  const sheetPathById = new Map<string, string>();
  for (const rel of elements(relsXml, "Relationship")) {
    const id = attribute(rel.tag, "Id");
    const target = attribute(rel.tag, "Target");
    const type = attribute(rel.tag, "Type") ?? "";
    if (!id || !target) continue;
    rels[id] = target;
    if (/\/worksheet$/.test(type)) {
      const normalized = target.startsWith("/") ? target.slice(1) : `xl/${target}`.replace(/\/\.\//g, "/");
      sheetPathById.set(id, normalized);
    }
  }

  const theme = base["xl/theme/theme1.xml"] ? parseThemeXml(base["xl/theme/theme1.xml"]!) : undefined;
  const palette = theme?.colors;
  const parsedStyles = base["xl/styles.xml"]
    ? parseStylesXml(base["xl/styles.xml"]!, palette)
    : { styles: [], dxfStyles: [] as XlsxRenderStyle[] };

  // sharedStrings: readBasicWorkbook already resolved values, but the render
  // cells keep raw text for formula caches, which also use the table.
  const sharedStrings: string[] = [];
  const sharedXml = base["xl/sharedStrings.xml"];
  if (sharedXml) {
    for (const item of elements(sharedXml, "si")) {
      const text = [...item.body.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => decodeXml(m[1] ?? "")).join("");
      sharedStrings.push(text);
    }
  }

  // Sheet elements in workbook order: name + r:id + state (hidden).
  const sheetElements = elements(sectionInner(workbookXml, "sheets"), "sheet");
  const ordered: { id: string; name: string; path?: string; hidden?: boolean }[] = [];
  for (const sheet of sheetElements) {
    const name = attribute(sheet.tag, "name");
    const relId = attribute(sheet.tag, "r:id");
    if (!name) continue;
    const state = attribute(sheet.tag, "state");
    const entry = sheetEntries.find((candidate) => candidate.name === name);
    ordered.push({
      id: entry?.id ?? `sheet-${ordered.length + 1}`,
      name: decodeXml(name),
      ...(relId === undefined ? {} : { path: sheetPathById.get(relId) }),
      ...(state === "hidden" || state === "veryHidden" ? { hidden: true } : {}),
    });
  }
  // Fall back to the basic read's order when workbook.xml is unreadable.
  if (ordered.length === 0) for (const entry of sheetEntries) ordered.push(entry);

  const sheetPaths = ordered.map((sheet) => sheet.path).filter((value): value is string => value !== undefined);
  const sheetXmls = sheetPaths.length ? await engine.readEntriesText(bytes, sheetPaths) : {};

  const sheetTables = await readSheetTables(
    ordered.map((sheet) => ({ path: sheet.path, xml: sheet.path ? sheetXmls[sheet.path] : null })),
    (paths) => engine.readEntriesText(bytes, paths),
    parseRefRange,
  );

  const sheets = ordered.map((sheet, index) => {
    const xml = sheet.path ? sheetXmls[sheet.path] : null;
    const parsed: XlsxRenderSheet = xml
      ? parseWorksheetXml(xml, sheet.id, sheet.name, sharedStrings, rels, palette)
      : { id: sheet.id, name: sheet.name, rowCount: 1, columnCount: 1, merges: [], columnWidths: [], rowsMeta: [], hyperlinks: [], cells: {} };
    return { ...parsed, hidden: sheet.hidden ?? false, index, tables: sheetTables[index] ?? [] };
  });

  const view = elements(sectionInner(workbookXml, "workbookView"), "workbookView")[0];
  const activeTab = view ? Number(attribute(view.tag, "activeTab") ?? 0) : 0;
  const date1904 = /<workbookPr\b[^>]*date1904="(1|true)"/.test(workbookXml);
  // B7 F1: the workbook's own defined names, so the name manager can seed its
  // rows from them instead of rewriting <definedNames> from an empty snapshot.
  const definedNames = parseDefinedNamesXml(workbookXml);

  // The gateway's revision is carried through so consumers can compare the
  // render model with the value snapshot they received together.
  const revision = imported.snapshot.revision;
  return {
    revision,
    activeTab: Number.isInteger(activeTab) && activeTab >= 0 ? activeTab : 0,
    date1904,
    sheets,
    styles: parsedStyles.styles,
    dxfStyles: parsedStyles.dxfStyles,
    ...(theme === undefined ? {} : { theme }),
    ...(parsedStyles.normalFontName === undefined ? {} : { normalFontName: parsedStyles.normalFontName }),
    definedNames,
  };
}

/** Total cell count of a render model — the payload bound's input. */
export function renderModelCellCount(model: XlsxRenderModel): number {
  return model.sheets.reduce((sum, sheet) => sum + countCells(sheet), 0);
}
