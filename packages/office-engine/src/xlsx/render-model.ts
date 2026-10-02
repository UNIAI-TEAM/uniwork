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
}

// ── XML helpers (same regex-scanning style the vendored gateway uses) ──────

const decodeXml = (text: string): string =>
  text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec), 10))
    .replace(/&amp;/g, "&");

const attribute = (tag: string, name: string): string | undefined => {
  const match = new RegExp(`\\b${name}="([^"]*)"`).exec(tag);
  return match?.[1];
};

/** All `<name …>body</name>` / `<name …/>` elements, bodies included. */
function elements(xml: string, name: string): { tag: string; body: string }[] {
  const out: { tag: string; body: string }[] = [];
  const pattern = new RegExp(`<${name}\\b([^>]*?)(?:/>|>([\\s\\S]*?)</${name}>)`, "g");
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(xml)) !== null) {
    out.push({ tag: match[1] ?? "", body: match[2] ?? "" });
  }
  return out;
}

function sectionInner(xml: string, name: string): string {
  const pattern = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`);
  return pattern.exec(xml)?.[1] ?? "";
}

// ── Colors ─────────────────────────────────────────────────────────────────

const BUILTIN_NUMBER_FORMATS: Readonly<Record<number, string>> = {
  0: "General",
  1: "0",
  2: "0.00",
  3: "#,##0",
  4: "#,##0.00",
  9: "0%",
  10: "0.00%",
  11: "0.00E+00",
  12: "# ?/?",
  13: "# ??/??",
  14: "m/d/yy",
  15: "d-mmm-yy",
  16: "d-mmm",
  17: "mmm-yy",
  18: "h:mm AM/PM",
  19: "h:mm:ss AM/PM",
  20: "h:mm",
  21: "h:mm:ss",
  22: "m/d/yy h:mm",
  37: "#,##0 ;(#,##0)",
  38: "#,##0 ;[Red](#,##0)",
  39: "#,##0.00;(#,##0.00)",
  40: "#,##0.00;[Red](#,##0.00)",
  45: "mm:ss",
  46: "[h]:mm:ss",
  47: "mmss.0",
  48: "##0.0E+0",
  49: "@",
};

/** The classic OOXML indexed palette (ECMA-376 §18.8.27), 64 entries. */
const INDEXED_COLORS: readonly string[] = [
  "#000000", "#FFFFFF", "#FF0000", "#00FF00", "#0000FF", "#FFFF00", "#FF00FF", "#00FFFF",
  "#000000", "#FFFFFF", "#FF0000", "#00FF00", "#0000FF", "#FFFF00", "#FF00FF", "#00FFFF",
  "#800000", "#008000", "#000080", "#808000", "#800080", "#008080", "#C0C0C0", "#808080",
  "#9999FF", "#993366", "#FFFFCC", "#CCFFFF", "#660066", "#FF8080", "#0066CC", "#CCCCFF",
  "#000080", "#FF00FF", "#FFFF00", "#00FFFF", "#800080", "#800000", "#008080", "#0000FF",
  "#00CCFF", "#CCFFFF", "#CCFFCC", "#FFFF99", "#99CCFF", "#FF99CC", "#CC99FF", "#FFCC99",
  "#3366FF", "#33CCCC", "#99CC00", "#FFCC00", "#FF9900", "#FF6600", "#666699", "#969696",
  "#003366", "#339966", "#003300", "#333300", "#993300", "#993366", "#333399", "#333333",
];

const clampChannel = (value: number): number => Math.max(0, Math.min(255, Math.round(value)));

function rgbToHsl(hex: string): [number, number, number] {
  const value = hex.replace("#", "");
  const r = Number.parseInt(value.slice(0, 2), 16) / 255;
  const g = Number.parseInt(value.slice(2, 4), 16) / 255;
  const b = Number.parseInt(value.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h, s, l];
}

function hslToHex(h: number, s: number, l: number): string {
  const hue2rgb = (p: number, q: number, t: number): number => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  let r: number;
  let g: number;
  let b: number;
  if (s === 0) {
    r = l;
    g = l;
    b = l;
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  const channel = (value: number): string => clampChannel(value * 255).toString(16).padStart(2, "0").toUpperCase();
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

/** OOXML tint applies to luminance: negative darkens, positive lightens. */
function applyTint(hex: string, tint: number | undefined): string {
  if (!tint) return hex.toUpperCase();
  const [h, s, l] = rgbToHsl(hex);
  const next = tint < 0 ? l * (1 + tint) : l + (1 - l) * tint;
  return hslToHex(h, s, next);
}

interface ParsedColor {
  readonly rgb?: string | undefined;
  readonly theme?: number | undefined;
  readonly tint?: number | undefined;
}

function parseColorXml(xml: string | undefined): ParsedColor | undefined {
  if (!xml) return undefined;
  const rgb = attribute(xml, "rgb");
  if (rgb !== undefined && /^[0-9a-fA-F]{6,8}$/.test(rgb)) {
    // ARGB: 8 hex digits carry alpha; the renderer contract is #RRGGBB.
    return { rgb: `#${rgb.slice(-6).toUpperCase()}` };
  }
  const theme = attribute(xml, "theme");
  if (theme !== undefined && Number.isInteger(Number(theme))) {
    const tint = attribute(xml, "tint");
    return { theme: Number(theme), tint: tint === undefined ? undefined : Number(tint) };
  }
  const indexed = attribute(xml, "indexed");
  if (indexed !== undefined && Number.isInteger(Number(indexed))) {
    const value = INDEXED_COLORS[Number(indexed)];
    return value === undefined ? undefined : { rgb: value };
  }
  return undefined;
}

function resolvedColor(color: ParsedColor | undefined, palette: readonly string[] | undefined): { rgb?: string; theme?: number; tint?: number } {
  if (!color) return {};
  if (color.rgb !== undefined) return { rgb: color.rgb };
  if (color.theme !== undefined && palette !== undefined) {
    const base = palette[color.theme] ?? palette[0] ?? "#000000";
    return {
      rgb: applyTint(base, color.tint),
      theme: color.theme,
      ...(color.tint === undefined ? {} : { tint: color.tint }),
    };
  }
  return {};
}

// ── styles.xml ─────────────────────────────────────────────────────────────

interface ParsedStyles {
  readonly styles: XlsxRenderStyle[];
  readonly dxfStyles: XlsxRenderStyle[];
  readonly normalFontName?: string | undefined;
}

function parseFont(xml: string, palette: readonly string[] | undefined): {
  fontFamily?: string;
  fontSize?: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strikethrough: boolean;
  color: ReturnType<typeof resolvedColor>;
  scheme?: "major" | "minor";
} {
  const name = elements(xml, "name")[0];
  const size = elements(xml, "sz")[0];
  const family = name ? decodeXml(attribute(name.tag, "val") ?? "") : undefined;
  const sizeValue = size ? Number(attribute(size.tag, "val")) : undefined;
  const colorXml = xml.match(/<color\b[^>]*\/?>/)?.[0];
  const underlineTag = xml.match(/<u\b[^>]*\/?>/)?.[0];
  const underlineValue = underlineTag ? (attribute(underlineTag, "val") ?? "single") : undefined;
  const scheme = attribute(xml.match(/<scheme\b[^>]*\/?>/)?.[0] ?? "", "val");
  return {
    ...(family !== undefined && family !== "" ? { fontFamily: family } : {}),
    ...(sizeValue !== undefined && Number.isFinite(sizeValue) ? { fontSize: sizeValue } : {}),
    bold: /<b\b[^>]*\/?>/.test(xml) && attribute(xml.match(/<b\b[^>]*\/?>/)?.[0] ?? "", "val") !== "0",
    italic: /<i\b[^>]*\/?>/.test(xml) && attribute(xml.match(/<i\b[^>]*\/?>/)?.[0] ?? "", "val") !== "0",
    underline: underlineValue !== undefined && underlineValue !== "none",
    strikethrough: /<strike\b[^>]*\/?>/.test(xml) && attribute(xml.match(/<strike\b[^>]*\/?>/)?.[0] ?? "", "val") !== "0",
    color: resolvedColor(parseColorXml(colorXml), palette),
    ...(scheme === "major" || scheme === "minor" ? { scheme } : {}),
  };
}

function parseBorderEdge(xml: string, name: string, palette: readonly string[] | undefined): XlsxRenderBorderEdge | undefined {
  const edge = elements(xml, name)[0];
  if (!edge) return undefined;
  const style = attribute(edge.tag, "style");
  if (!style) return undefined;
  const color = resolvedColor(parseColorXml(edge.body.match(/<color\b[^>]*\/?>/)?.[0]), palette);
  return { style, ...(color.rgb ? { color: color.rgb } : {}) };
}

function parseFill(xml: string, palette: readonly string[] | undefined): { fillColor?: string; fillTheme?: number; fillTint?: number } {
  const pattern = elements(xml, "patternFill")[0];
  if (pattern) {
    const patternType = attribute(pattern.tag, "patternType");
    if (patternType === undefined || patternType === "none") return {};
    const fg = resolvedColor(parseColorXml(pattern.body.match(/<fgColor\b[^>]*\/?>/)?.[0]), palette);
    if (fg.rgb) {
      return {
        fillColor: fg.rgb,
        ...(fg.theme === undefined ? {} : { fillTheme: fg.theme }),
        ...(fg.tint === undefined ? {} : { fillTint: fg.tint }),
      };
    }
    return {};
  }
  const gradient = elements(xml, "gradientFill")[0];
  if (gradient) {
    // Flat approximation from the first stop (the renderer takes a fill color).
    const stop = elements(gradient.body, "stop")[0];
    const color = resolvedColor(parseColorXml(stop?.body.match(/<color\b[^>]*\/?>/)?.[0]), palette);
    if (color.rgb) return { fillColor: color.rgb };
  }
  return {};
}

function parseStylesXml(xml: string, palette: readonly string[] | undefined): ParsedStyles {
  const numFmts = new Map<number, string>();
  for (const numFmt of elements(sectionInner(xml, "numFmts"), "numFmt")) {
    const id = Number(attribute(numFmt.tag, "numFmtId"));
    const code = attribute(numFmt.tag, "formatCode");
    if (Number.isInteger(id) && code !== undefined) numFmts.set(id, decodeXml(code));
  }
  const fonts = elements(sectionInner(xml, "fonts"), "font").map((font) => parseFont(font.body, palette));
  const fills = elements(sectionInner(xml, "fills"), "fill").map((fill) => parseFill(fill.body, palette));
  const borders = elements(sectionInner(xml, "borders"), "border").map((border) => ({
    top: parseBorderEdge(border.body, "top", palette),
    bottom: parseBorderEdge(border.body, "bottom", palette),
    left: parseBorderEdge(border.body, "left", palette),
    right: parseBorderEdge(border.body, "right", palette),
    diagonal: parseBorderEdge(border.body, "diagonal", palette),
    diagonalUp: attribute(border.tag, "diagonalUp") === "1" || attribute(border.tag, "diagonalUp") === "true",
    diagonalDown: attribute(border.tag, "diagonalDown") === "1" || attribute(border.tag, "diagonalDown") === "true",
  }));

  const toStyle = (xfTag: string, xfBody: string): XlsxRenderStyle => {
    const fontId = Number(attribute(xfTag, "fontId") ?? 0);
    const fillId = Number(attribute(xfTag, "fillId") ?? 0);
    const borderId = Number(attribute(xfTag, "borderId") ?? 0);
    const numFmtId = Number(attribute(xfTag, "numFmtId") ?? 0);
    const font = fonts[fontId];
    const fill = fills[fillId];
    const border = borders[borderId];
    const alignment = elements(xfBody, "alignment")[0];
    const indent = alignment ? Number(attribute(alignment.tag, "indent") ?? 0) : 0;
    const textRotation = alignment ? Number(attribute(alignment.tag, "textRotation") ?? 0) : 0;
    const numberFormat = numFmts.get(numFmtId) ?? BUILTIN_NUMBER_FORMATS[numFmtId];
    return {
      ...(font?.fontFamily === undefined ? {} : { fontFamily: font.fontFamily }),
      ...(font?.fontSize === undefined ? {} : { fontSize: font.fontSize }),
      bold: font?.bold ?? false,
      italic: font?.italic ?? false,
      underline: font?.underline ?? false,
      strikethrough: font?.strikethrough ?? false,
      wrapText: alignment ? attribute(alignment.tag, "wrapText") === "1" || attribute(alignment.tag, "wrapText") === "true" : false,
      ...(alignment && (attribute(alignment.tag, "shrinkToFit") === "1" || attribute(alignment.tag, "shrinkToFit") === "true")
        ? { shrinkToFit: true }
        : {}),
      ...(font?.color.rgb === undefined ? {} : { fontColor: font.color.rgb }),
      ...(font?.color.theme === undefined ? {} : { fontColorTheme: font.color.theme }),
      ...(font?.color.tint === undefined ? {} : { fontColorTint: font.color.tint }),
      ...(fill?.fillColor === undefined ? {} : { fillColor: fill.fillColor }),
      ...(fill?.fillTheme === undefined ? {} : { fillColorTheme: fill.fillTheme }),
      ...(fill?.fillTint === undefined ? {} : { fillColorTint: fill.fillTint }),
      ...(font?.scheme === undefined ? {} : { fontScheme: font.scheme }),
      ...(alignment ? { horizontalAlignment: attribute(alignment.tag, "horizontal") } : {}),
      ...(alignment ? { verticalAlignment: attribute(alignment.tag, "vertical") } : {}),
      ...(Number.isInteger(indent) && indent > 0 ? { indent } : {}),
      ...(Number.isInteger(textRotation) && textRotation > 0 ? { textRotation } : {}),
      ...(numberFormat === undefined ? {} : { numberFormat }),
      ...(border?.top === undefined ? {} : { borderTop: border.top }),
      ...(border?.bottom === undefined ? {} : { borderBottom: border.bottom }),
      ...(border?.left === undefined ? {} : { borderLeft: border.left }),
      ...(border?.right === undefined ? {} : { borderRight: border.right }),
      ...(border?.diagonal === undefined ? {} : { borderDiagonal: border.diagonal }),
      diagonalUp: border?.diagonalUp ?? false,
      diagonalDown: border?.diagonalDown ?? false,
    };
  };

  const styles = elements(sectionInner(xml, "cellXfs"), "xf").map((xf) => toStyle(xf.tag, xf.body));
  const dxfStyles = elements(sectionInner(xml, "dxfs"), "dxf").map((dxf) => toStyle(dxf.tag, dxf.body));
  const normalFontName = fonts[0]?.fontFamily;
  return { styles, dxfStyles, ...(normalFontName === undefined ? {} : { normalFontName }) };
}

// ── theme1.xml ─────────────────────────────────────────────────────────────

export function parseThemeXml(xml: string): XlsxRenderTheme | undefined {
  const scheme = sectionInner(xml, "clrScheme");
  if (!scheme) return undefined;
  const slot = (name: string): string | undefined => {
    const inner = sectionInner(scheme, name);
    const color = inner.match(/<a:(?:srgbClr|sysClr)\b[^>]*\/?>/)?.[0];
    if (!color) return undefined;
    const rgb = attribute(color, "val") ?? attribute(color, "lastClr");
    return rgb === undefined ? undefined : `#${rgb.slice(-6).toUpperCase()}`;
  };
  // Document order is dk1, lt1, dk2, lt2, …; OOXML theme indexes are
  // lt1, dk1, lt2, dk2, accent1-6, hlink, folHlink.
  const colors = [
    slot("lt1"), slot("dk1"), slot("lt2"), slot("dk2"),
    slot("accent1"), slot("accent2"), slot("accent3"), slot("accent4"), slot("accent5"), slot("accent6"),
    slot("hlink"), slot("folHlink"),
  ].map((value, index) => value ?? "#000000");
  const majorFont = sectionInner(xml, "majorFont");
  const minorFont = sectionInner(xml, "minorFont");
  const face = (inner: string, tag: string): string | undefined => {
    const latin = elements(sectionInner(inner, tag), "latin")[0] ?? elements(inner, tag)[0];
    const value = latin ? attribute(latin.tag, "typeface") : undefined;
    return value === undefined || value === "" ? undefined : value;
  };
  const minorEa = elements(minorFont, "ea")[0];
  const minorEaFace = minorEa ? attribute(minorEa.tag, "typeface") : undefined;
  return {
    colors,
    ...(face(majorFont, "latin") === undefined ? {} : { majorFont: face(majorFont, "latin")! }),
    ...(face(minorFont, "latin") === undefined ? {} : { minorFont: face(minorFont, "latin")! }),
    ...(minorEaFace === undefined || minorEaFace === "" ? {} : { minorEa: minorEaFace }),
  };
}

// ── worksheet.xml ──────────────────────────────────────────────────────────

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
      const value = rawValue === undefined ? undefined : cellValueOf(type, rawValue, sharedStrings);
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

  const sheets = ordered.map((sheet, index) => {
    const xml = sheet.path ? sheetXmls[sheet.path] : null;
    const parsed: XlsxRenderSheet = xml
      ? parseWorksheetXml(xml, sheet.id, sheet.name, sharedStrings, rels)
      : { id: sheet.id, name: sheet.name, rowCount: 1, columnCount: 1, merges: [], columnWidths: [], rowsMeta: [], hyperlinks: [], cells: {} };
    return { ...parsed, hidden: sheet.hidden ?? false, index };
  });

  const view = elements(sectionInner(workbookXml, "workbookView"), "workbookView")[0];
  const activeTab = view ? Number(attribute(view.tag, "activeTab") ?? 0) : 0;
  const date1904 = /<workbookPr\b[^>]*date1904="(1|true)"/.test(workbookXml);

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
  };
}

/** Total cell count of a render model — the payload bound's input. */
export function renderModelCellCount(model: XlsxRenderModel): number {
  return model.sheets.reduce((sum, sheet) => sum + countCells(sheet), 0);
}
