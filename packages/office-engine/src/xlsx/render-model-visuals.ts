// UNI-953 X02: the charts, pictures and shapes a workbook already ships
// (file-native visuals). Each worksheet's drawing relationship ->
// xl/drawings/drawingN.xml -> one entry per anchor, counted in document order
// with the vendored gateway's own pattern (xlsx-drawing-edit.ts ANCHOR_PATTERN),
// so `index` is exactly the `drawingIndex` the gateway's visualEdits locate an
// anchor by. Charts are read from their cached series (no recalc), pictures
// carry their bytes up to a cap, shapes their preset geometry, solid fill and
// text. Every reader here is tolerant: a missing or malformed part yields no
// visual (or an "other" entry that keeps the index count), never a throw.
import { attribute, decodeXml, elements, sectionInner } from "./render-model-xml.ts";
import type { XlsxVisualAnchor, XlsxVisualChart, XlsxVisualChartSeries, XlsxVisualChartType, XlsxVisualImageType } from "./ops-visuals.ts";

/** Picture bytes one visual may carry in the render model (decoded). A larger
 *  picture is still listed (and can be moved or deleted) but drawn as a frame. */
export const XLSX_FILE_VISUAL_MAX_IMAGE_BYTES = 512 * 1024;
/** Picture bytes the whole render model may carry (decoded). */
export const XLSX_FILE_VISUAL_MAX_TOTAL_IMAGE_BYTES = 8 * 1024 * 1024;
/** Anchors read per drawing; later ones are not listed (never edited). */
const MAX_ANCHORS = 1_000;
const MAX_SERIES = 24;
const MAX_POINTS = 1_000;
const MAX_TEXT = 255;

/** Same pattern as the gateway's applyVisualEdits: the index pairing depends on it. */
const ANCHOR_PATTERN = /<([A-Za-z_][\w.-]*:)?(twoCellAnchor|oneCellAnchor|absoluteAnchor)\b[\s\S]*?<\/\1\2>/g;

export type XlsxFileVisualKind = "chart" | "picture" | "shape" | "other";

/** One anchor of a sheet's drawing as the editor overlay consumes it. */
export interface XlsxRenderVisual {
  /** Anchor index in the drawing, document order (the gateway's drawingIndex). */
  readonly index: number;
  readonly kind: XlsxFileVisualKind;
  /** twoCellAnchor: both markers. oneCellAnchor: `from` plus `extent`. */
  readonly anchor?: XlsxVisualAnchor | undefined;
  /** EMU size of a oneCellAnchor / absoluteAnchor. */
  readonly extent?: { readonly cx: number; readonly cy: number } | undefined;
  /** EMU position of an absoluteAnchor from the sheet's top left. */
  readonly position?: { readonly x: number; readonly y: number } | undefined;
  /** Only a twoCellAnchor outside mc:AlternateContent can be moved, resized
   *  or deleted through the gateway's visualEdits. */
  readonly editable: boolean;
  readonly name?: string | undefined;
  /** Charts of a type the overlay draws; other chart kinds carry `chartTitle` only. */
  readonly chart?: XlsxVisualChart | undefined;
  readonly chartTitle?: string | undefined;
  readonly shape?: { readonly shapeType: string; readonly fillColor?: string | undefined; readonly text?: string | undefined } | undefined;
  /** Present when the picture fits the caps; absent pictures draw as a frame. */
  readonly image?: { readonly mediaType: XlsxVisualImageType; readonly base64: string } | undefined;
}

export type XlsxEntriesReader = (paths: readonly string[]) => Promise<Readonly<Record<string, string | null>>>;
export type XlsxBase64Reader = (paths: readonly string[], maxBytes: number) => Promise<Readonly<Record<string, string | null>>>;

const isOn = (value: string | undefined): boolean => value === "1" || value === "true";

/** `xl/worksheets/sheet1.xml` -> `xl/worksheets/_rels/sheet1.xml.rels`. */
export function partRelsPath(partPath: string): string {
  const slash = partPath.lastIndexOf("/");
  return `${partPath.slice(0, slash + 1)}_rels/${partPath.slice(slash + 1)}.rels`;
}

/** Resolve a relationship target against the part that owns the rels file. */
export function resolvePartTarget(partPath: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const segments = partPath.split("/").slice(0, -1);
  for (const part of target.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") segments.pop();
    else segments.push(part);
  }
  return segments.join("/");
}

interface Relationship {
  readonly id: string;
  readonly type: string;
  readonly target: string;
  readonly external: boolean;
}

function relationships(relsXml: string | null | undefined): Relationship[] {
  if (!relsXml) return [];
  return elements(relsXml, "Relationship").flatMap((rel) => {
    const id = attribute(rel.tag, "Id");
    const target = attribute(rel.tag, "Target");
    if (id === undefined || target === undefined) return [];
    return [{ id, type: attribute(rel.tag, "Type") ?? "", target: decodeXml(target), external: attribute(rel.tag, "TargetMode") === "External" }];
  });
}

/** The drawing part a worksheet's relationships name (the gateway's
 *  ensureSheetDrawing picks it the same way: the first drawing relationship). */
export function drawingPathOf(sheetPath: string, sheetRelsXml: string | null | undefined): string | null {
  const rel = relationships(sheetRelsXml).find((entry) => /\/drawing$/.test(entry.type) && !entry.external);
  return rel ? resolvePartTarget(sheetPath, rel.target) : null;
}

/** Each worksheet's drawing part, keyed by the sheet name in the package
 *  (workbook.xml -> workbook rels -> worksheet rels). The save path resolves
 *  a file visual's drawing with it; a sheet without a drawing is absent. */
export async function readDrawingPathsBySheet(readText: XlsxEntriesReader): Promise<Map<string, string>> {
  const base = await readText(["xl/workbook.xml", "xl/_rels/workbook.xml.rels"]);
  const workbookRels = relationships(base["xl/_rels/workbook.xml.rels"]);
  const sheets = elements(sectionInner(base["xl/workbook.xml"] ?? "", "sheets"), "sheet").flatMap((sheet) => {
    const name = attribute(sheet.tag, "name");
    const relId = attribute(sheet.tag, "r:id");
    const rel = workbookRels.find((entry) => entry.id === relId && /\/worksheet$/.test(entry.type));
    return name === undefined || !rel ? [] : [{ name: decodeXml(name), path: resolvePartTarget("xl/workbook.xml", rel.target) }];
  });
  const rels = sheets.length > 0 ? await readText(sheets.map((sheet) => partRelsPath(sheet.path))) : {};
  const out = new Map<string, string>();
  for (const sheet of sheets) {
    const drawing = drawingPathOf(sheet.path, rels[partRelsPath(sheet.path)]);
    if (drawing !== null) out.set(sheet.name, drawing);
  }
  return out;
}

const int = (text: string | undefined, fallback = 0): number => {
  const value = Number(text);
  return Number.isFinite(value) ? Math.trunc(value) : fallback;
};

function marker(body: string): { row: number; column: number; rowOffset: number; columnOffset: number } | null {
  const value = (name: string) => sectionInner(body, name).trim();
  if (value("col") === "" || value("row") === "") return null;
  return { column: Math.max(0, int(value("col"))), columnOffset: Math.max(0, int(value("colOff"))), row: Math.max(0, int(value("row"))), rowOffset: Math.max(0, int(value("rowOff"))) };
}

function extentOf(anchorXml: string, tag: string): { cx: number; cy: number } | undefined {
  const ext = elements(anchorXml, tag)[0];
  if (!ext) return undefined;
  const cx = int(attribute(ext.tag, "cx"), -1);
  const cy = int(attribute(ext.tag, "cy"), -1);
  return cx > 0 && cy > 0 ? { cx, cy } : undefined;
}

function textOf(xml: string): string {
  return elements(xml, "t").map((part) => decodeXml(part.body)).join("").slice(0, MAX_TEXT);
}

/** The first `a:srgbClr` of the shape's own fill (not its outline). */
function solidFill(spPr: string): string | undefined {
  const fill = sectionInner(spPr.replace(/<a:ln\b[\s\S]*?<\/a:ln>/g, ""), "solidFill");
  const value = attribute(elements(fill, "srgbClr")[0]?.tag ?? "", "val");
  return value !== undefined && /^[0-9A-Fa-f]{6}$/.test(value) ? `#${value.toUpperCase()}` : undefined;
}

const CHART_PLOTS: Readonly<Record<string, XlsxVisualChartType>> = {
  lineChart: "line",
  line3DChart: "line",
  pieChart: "pie",
  pie3DChart: "pie",
  areaChart: "area",
  area3DChart: "area",
  doughnutChart: "doughnut",
};

function cachedPoints(xml: string): (string | undefined)[] {
  const cache = sectionInner(xml, "numCache") || sectionInner(xml, "strCache");
  const count = Math.min(int(attribute(elements(cache, "ptCount")[0]?.tag ?? "", "val")), MAX_POINTS);
  const points: (string | undefined)[] = Array.from({ length: Math.max(count, 0) }, () => undefined);
  for (const point of elements(cache, "pt")) {
    const at = int(attribute(point.tag, "idx"), -1);
    if (at < 0 || at >= MAX_POINTS) continue;
    points[at] = decodeXml(sectionInner(point.body, "v"));
  }
  return points;
}

function chartSeries(ser: string): XlsxVisualChartSeries | null {
  const tx = sectionInner(ser, "tx");
  const name = (cachedPoints(tx)[0] ?? decodeXml(sectionInner(tx, "v"))).slice(0, MAX_TEXT);
  const valXml = sectionInner(ser, "val") || sectionInner(ser, "yVal");
  const catXml = sectionInner(ser, "cat") || sectionInner(ser, "xVal");
  const raw = cachedPoints(valXml);
  if (raw.length === 0) return null;
  const values = raw.map((value) => (value === undefined || !Number.isFinite(Number(value)) ? 0 : Number(value)));
  const categories = cachedPoints(catXml).map((value) => value ?? "").slice(0, values.length);
  const valuesRef = decodeXml(sectionInner(valXml, "f")).trim();
  const categoriesRef = decodeXml(sectionInner(catXml, "f")).trim();
  return {
    name,
    categories,
    values,
    ...(valuesRef ? { valuesRef } : {}),
    ...(categoriesRef ? { categoriesRef } : {}),
  };
}

/** A chart part's first plot, title and cached series. */
export function parseChartXml(chartXml: string): { chart?: XlsxVisualChart; title: string } {
  const chartBody = sectionInner(chartXml, "chart");
  const autoDeleted = isOn(attribute(elements(chartBody, "autoTitleDeleted")[0]?.tag ?? "", "val"));
  const title = autoDeleted ? "" : textOf(sectionInner(chartBody, "title"));
  const plotArea = sectionInner(chartBody, "plotArea");
  const plot = /<(?:[A-Za-z_][\w.-]*:)?(\w+Chart)\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?\1>/.exec(plotArea);
  if (!plot) return { title };
  const [, plotName = "", plotBody = ""] = plot;
  let chartType = CHART_PLOTS[plotName];
  if (plotName === "barChart" || plotName === "bar3DChart") {
    chartType = attribute(elements(plotBody, "barDir")[0]?.tag ?? "", "val") === "bar" ? "bar" : "column";
  }
  if (chartType === undefined) return { title };
  const series = elements(plotBody, "ser").slice(0, MAX_SERIES).flatMap((ser) => chartSeries(ser.body) ?? []);
  if (series.length === 0) return { title };
  return { chart: { chartType, title, series }, title };
}

const IMAGE_TYPES: Readonly<Record<string, XlsxVisualImageType>> = { png: "image/png", jpeg: "image/jpeg", jpg: "image/jpeg", gif: "image/gif" };

interface ParsedAnchor {
  readonly visual: Omit<XlsxRenderVisual, "chart" | "chartTitle" | "image">;
  readonly chartRel?: string | undefined;
  readonly imageRel?: string | undefined;
}

/** Anchors nested in mc:AlternateContent are counted (the gateway counts
 *  them) but never edited; the Fallback copy is not drawn at all. */
function alternateDepth(xml: string, at: number): { inside: boolean; fallback: boolean } {
  const before = xml.slice(0, at);
  const opens = (before.match(/<mc:AlternateContent\b/g) ?? []).length;
  const closes = (before.match(/<\/mc:AlternateContent>/g) ?? []).length;
  const fallbackOpen = before.lastIndexOf("<mc:Fallback");
  return { inside: opens > closes, fallback: opens > closes && fallbackOpen > before.lastIndexOf("</mc:Fallback>") };
}

function parseAnchor(anchorXml: string, kindTag: string, index: number, alternate: boolean): ParsedAnchor {
  const from = marker(sectionInner(anchorXml, "from"));
  const to = kindTag === "twoCellAnchor" ? marker(sectionInner(anchorXml, "to")) : null;
  const anchor: XlsxVisualAnchor | undefined = from
    ? {
        fromRow: from.row, fromColumn: from.column, fromRowOffset: from.rowOffset, fromColumnOffset: from.columnOffset,
        toRow: to?.row ?? from.row, toColumn: to?.column ?? from.column, toRowOffset: to?.rowOffset ?? from.rowOffset, toColumnOffset: to?.columnOffset ?? from.columnOffset,
      }
    : undefined;
  const pos = elements(anchorXml, "pos")[0];
  const placement = {
    index,
    ...(anchor && kindTag !== "absoluteAnchor" ? { anchor } : {}),
    ...(kindTag === "twoCellAnchor" ? {} : { extent: extentOf(anchorXml, "ext") }),
    ...(kindTag === "absoluteAnchor" && pos ? { position: { x: int(attribute(pos.tag, "x")), y: int(attribute(pos.tag, "y")) } } : {}),
    editable: kindTag === "twoCellAnchor" && to !== null && from !== null && !alternate,
  };
  const name = (body: string) => {
    const value = attribute(elements(body, "cNvPr")[0]?.tag ?? "", "name");
    return value === undefined ? {} : { name: decodeXml(value).slice(0, MAX_TEXT) };
  };
  const frame = /<(?:[A-Za-z_][\w.-]*:)?graphicFrame\b/.test(anchorXml);
  if (frame) {
    const rel = /<(?:[A-Za-z_][\w.-]*:)?chart\b[^>]*\br:id="([^"]+)"/.exec(anchorXml)?.[1];
    return rel ? { visual: { ...placement, kind: "chart", ...name(anchorXml) }, chartRel: rel } : { visual: { ...placement, kind: "other", editable: false } };
  }
  if (/<(?:[A-Za-z_][\w.-]*:)?grpSp\b/.test(anchorXml)) return { visual: { ...placement, kind: "other", editable: false } };
  const pic = elements(anchorXml, "pic")[0];
  if (pic) {
    const embed = /\br:embed="([^"]+)"/.exec(pic.body)?.[1];
    return { visual: { ...placement, kind: "picture", ...name(pic.body) }, imageRel: embed };
  }
  const sp = elements(anchorXml, "sp")[0] ?? elements(anchorXml, "cxnSp")[0];
  if (sp) {
    const spPr = sectionInner(sp.body, "spPr");
    const preset = attribute(elements(spPr, "prstGeom")[0]?.tag ?? "", "prst");
    const connector = /<(?:[A-Za-z_][\w.-]*:)?cxnSp\b/.test(anchorXml);
    const fillColor = solidFill(spPr);
    const text = textOf(sectionInner(sp.body, "txBody"));
    const shape = {
      shapeType: connector ? "line" : preset ?? "rect",
      ...(fillColor === undefined ? {} : { fillColor }),
      ...(text === "" ? {} : { text }),
    };
    return { visual: { ...placement, kind: "shape", ...name(sp.body), shape } };
  }
  return { visual: { ...placement, kind: "other", editable: false } };
}

/** One drawing part's anchors in document order (the drawingIndex pairing). */
export function parseDrawingXml(drawingXml: string): ParsedAnchor[] {
  const out: ParsedAnchor[] = [];
  let index = 0;
  for (const match of drawingXml.matchAll(ANCHOR_PATTERN)) {
    if (index >= MAX_ANCHORS) break;
    const alternate = alternateDepth(drawingXml, match.index ?? 0);
    const parsed = parseAnchor(match[0], match[2] ?? "", index, alternate.inside);
    index += 1;
    // A Fallback copy duplicates its Choice on screen; keep its index slot only.
    out.push(alternate.fallback ? { visual: { index: parsed.visual.index, kind: "other", editable: false } } : parsed);
  }
  return out;
}

/**
 * Read every listed worksheet's file-native visuals. `sheets[i].path` is the
 * worksheet part (absent = no part, no visuals). Pictures are read through
 * `readBase64` when given, each under the per-picture cap and all under the
 * workbook cap; without it pictures are listed without bytes.
 */
export async function readSheetVisuals(
  sheets: readonly { readonly path?: string | undefined }[],
  readText: XlsxEntriesReader,
  readBase64?: XlsxBase64Reader,
): Promise<XlsxRenderVisual[][]> {
  try {
    return await readVisuals(sheets, readText, readBase64);
  } catch {
    // A failing entry read leaves the workbook openable, without visuals.
    return sheets.map(() => []);
  }
}

async function readVisuals(
  sheets: readonly { readonly path?: string | undefined }[],
  readText: XlsxEntriesReader,
  readBase64?: XlsxBase64Reader,
): Promise<XlsxRenderVisual[][]> {
  const sheetPaths = sheets.map((sheet) => sheet.path).filter((path): path is string => path !== undefined);
  if (sheetPaths.length === 0) return sheets.map(() => []);
  const sheetRels = await readText(sheetPaths.map(partRelsPath));
  const drawingPaths = sheets.map((sheet) => (sheet.path ? drawingPathOf(sheet.path, sheetRels[partRelsPath(sheet.path)]) : null));
  const uniqueDrawings = [...new Set(drawingPaths.filter((path): path is string => path !== null))];
  if (uniqueDrawings.length === 0) return sheets.map(() => []);
  const drawingTexts = await readText([...uniqueDrawings, ...uniqueDrawings.map(partRelsPath)]);

  const parsedByDrawing = new Map<string, { anchors: ParsedAnchor[]; rels: Relationship[] }>();
  const chartPaths = new Set<string>();
  const imagePaths = new Set<string>();
  for (const path of uniqueDrawings) {
    const anchors = parseDrawingXml(drawingTexts[path] ?? "");
    const rels = relationships(drawingTexts[partRelsPath(path)]);
    parsedByDrawing.set(path, { anchors, rels });
    const targetOf = (id: string | undefined) => {
      const rel = id === undefined ? undefined : rels.find((entry) => entry.id === id && !entry.external);
      return rel ? resolvePartTarget(path, rel.target) : undefined;
    };
    for (const anchor of anchors) {
      const chart = targetOf(anchor.chartRel);
      const image = targetOf(anchor.imageRel);
      if (chart) chartPaths.add(chart);
      if (image && IMAGE_TYPES[image.split(".").pop()?.toLowerCase() ?? ""]) imagePaths.add(image);
    }
  }
  const chartTexts = chartPaths.size > 0 ? await readText([...chartPaths]) : {};
  const images = readBase64 && imagePaths.size > 0 ? await readBase64([...imagePaths], XLSX_FILE_VISUAL_MAX_IMAGE_BYTES) : {};
  let imageBudget = XLSX_FILE_VISUAL_MAX_TOTAL_IMAGE_BYTES;

  return drawingPaths.map((drawingPath) => {
    const parsed = drawingPath ? parsedByDrawing.get(drawingPath) : undefined;
    if (!drawingPath || !parsed) return [];
    const targetOf = (id: string | undefined) => {
      const rel = id === undefined ? undefined : parsed.rels.find((entry) => entry.id === id && !entry.external);
      return rel ? resolvePartTarget(drawingPath, rel.target) : undefined;
    };
    return parsed.anchors.map(({ visual, chartRel, imageRel }): XlsxRenderVisual => {
      if (visual.kind === "chart") {
        const xml = chartTexts[targetOf(chartRel) ?? ""];
        if (!xml) return { ...visual, kind: "other", editable: false };
        const read = parseChartXml(xml);
        return { ...visual, ...(read.chart ? { chart: read.chart } : {}), chartTitle: read.title };
      }
      if (visual.kind === "picture") {
        const path = targetOf(imageRel);
        const mediaType = IMAGE_TYPES[path?.split(".").pop()?.toLowerCase() ?? ""];
        const base64 = path ? images[path] : null;
        const bytes = base64 ? Math.floor((base64.length * 3) / 4) : 0;
        if (!mediaType || !base64 || bytes > XLSX_FILE_VISUAL_MAX_IMAGE_BYTES || bytes > imageBudget) return visual;
        imageBudget -= bytes;
        return { ...visual, image: { mediaType, base64 } };
      }
      return visual;
    });
  });
}
