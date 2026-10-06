// XLSX styles and workbook theme parsing.
import type { XlsxRenderBorderEdge, XlsxRenderStyle, XlsxRenderTheme } from "./render-model.ts";
import { attribute, decodeXml, elements, sectionInner } from "./render-model-xml.ts";

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

export function parseColorXml(xml: string | undefined): ParsedColor | undefined {
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

export function resolvedColor(color: ParsedColor | undefined, palette: readonly string[] | undefined): { rgb?: string; theme?: number; tint?: number } {
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

function parseFill(xml: string, palette: readonly string[] | undefined, differential = false): { fillColor?: string; fillTheme?: number; fillTint?: number } {
  const pattern = elements(xml, "patternFill")[0];
  if (pattern) {
    const patternType = attribute(pattern.tag, "patternType");
    if (!differential && (patternType === undefined || patternType === "none")) return {};
    const fg = resolvedColor(parseColorXml(pattern.body.match(differential ? /<(?:fgColor|bgColor)\b[^>]*\/?>/ : /<fgColor\b[^>]*\/?>/)?.[0]), palette);
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

export function parseStylesXml(xml: string, palette: readonly string[] | undefined): ParsedStyles {
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

  const toStyle = (xfTag: string, xfBody: string, differential = false): XlsxRenderStyle => {
    const fontId = Number(attribute(xfTag, "fontId") ?? 0);
    const fillId = Number(attribute(xfTag, "fillId") ?? 0);
    const borderId = Number(attribute(xfTag, "borderId") ?? 0);
    const numFmtId = Number(attribute(xfTag, "numFmtId") ?? 0);
    const font = differential ? parseFont(sectionInner(xfBody, "font"), palette) : fonts[fontId];
    const fill = differential ? parseFill(sectionInner(xfBody, "fill"), palette, true) : fills[fillId];
    const inlineBorder = sectionInner(xfBody, "border");
    const border = differential ? {
      top: parseBorderEdge(inlineBorder, "top", palette), bottom: parseBorderEdge(inlineBorder, "bottom", palette),
      left: parseBorderEdge(inlineBorder, "left", palette), right: parseBorderEdge(inlineBorder, "right", palette),
      diagonal: parseBorderEdge(inlineBorder, "diagonal", palette), diagonalUp: false, diagonalDown: false,
    } : borders[borderId];
    const alignment = elements(xfBody, "alignment")[0];
    const indent = alignment ? Number(attribute(alignment.tag, "indent") ?? 0) : 0;
    const textRotation = alignment ? Number(attribute(alignment.tag, "textRotation") ?? 0) : 0;
    const numberFormat = differential
      ? attribute(elements(xfBody, "numFmt")[0]?.tag ?? "", "formatCode")
      : numFmts.get(numFmtId) ?? BUILTIN_NUMBER_FORMATS[numFmtId];
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
      ...(numberFormat === undefined ? {} : { numberFormat: differential ? decodeXml(numberFormat) : numberFormat }),
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
  const dxfStyles = elements(sectionInner(xml, "dxfs"), "dxf").map((dxf) => toStyle(dxf.tag, dxf.body, true));
  const normalFontName = fonts[0]?.fontFamily;
  return { styles, dxfStyles, ...(normalFontName === undefined ? {} : { normalFontName }) };
}

// ── theme1.xml ─────────────────────────────────────────────────────────────

export function parseThemeXml(xml: string): XlsxRenderTheme | undefined {
  const scheme = sectionInner(xml, "clrScheme");
  if (!scheme) return undefined;
  const slot = (name: string): string | undefined => {
    const inner = sectionInner(scheme, name);
    const srgb = elements(inner, "srgbClr")[0];
    const system = elements(inner, "sysClr")[0];
    const rgb = srgb ? attribute(srgb.tag, "val") : system ? attribute(system.tag, "lastClr") : undefined;
    return rgb !== undefined && /^[0-9a-f]{6}$/i.test(rgb) ? `#${rgb.toUpperCase()}` : undefined;
  };
  // Document order is dk1, lt1, dk2, lt2, …; OOXML theme indexes are
  // lt1, dk1, lt2, dk2, accent1-6, hlink, folHlink.
  const colors = [
    slot("lt1"), slot("dk1"), slot("lt2"), slot("dk2"),
    slot("accent1"), slot("accent2"), slot("accent3"), slot("accent4"), slot("accent5"), slot("accent6"),
    slot("hlink"), slot("folHlink"),
  ].map((value) => value ?? "#000000");
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
