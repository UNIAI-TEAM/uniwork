// UNI-952 (D-xlsx): cell styles of the print copy. One CSS class per workbook
// style index the printed range uses; every value that reaches CSS is either
// a number we computed or passes a strict whitelist (hex colour, font name
// characters, known border keyword), so a hostile style cannot break out of
// its declaration.
import type { XlsxRenderBorderEdge, XlsxRenderStyle } from "@uniwork/office-engine/xlsx";

/** Escape text for HTML element content and quoted attribute values. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** "#RRGGBB" from "RRGGBB" / "#RRGGBB" / "AARRGGBB"; null for anything else. */
export function cssColor(value: string | undefined): string | null {
  if (!value) return null;
  const hex = value.trim().replace(/^#/, "");
  if (/^[0-9a-f]{8}$/i.test(hex)) return `#${hex.slice(2)}`;
  if (/^[0-9a-f]{6}$/i.test(hex)) return `#${hex}`;
  return null;
}

/** A CSS font-family list from a workbook font name, letters/digits/spaces only. */
export function cssFontFamily(name: string | undefined): string | null {
  const clean = (name ?? "").replace(/[^\p{L}\p{N} _-]/gu, "").trim();
  return clean === "" ? null : `"${clean}", sans-serif`;
}

const BORDER_STYLES: Readonly<Record<string, string>> = {
  thin: "0.75pt solid",
  hair: "0.5pt dotted",
  dotted: "0.75pt dotted",
  dashed: "0.75pt dashed",
  dashDot: "0.75pt dashed",
  dashDotDot: "0.75pt dashed",
  medium: "1.5pt solid",
  mediumDashed: "1.5pt dashed",
  mediumDashDot: "1.5pt dashed",
  mediumDashDotDot: "1.5pt dashed",
  slantDashDot: "1.5pt dashed",
  thick: "2.25pt solid",
  double: "2.25pt double",
};

function borderCss(edge: XlsxRenderBorderEdge | undefined): string | null {
  if (!edge) return null;
  const line = BORDER_STYLES[edge.style];
  if (!line) return null;
  return `${line} ${cssColor(edge.color) ?? "#000000"}`;
}

const HORIZONTAL: Readonly<Record<string, string>> = {
  left: "left",
  center: "center",
  centerContinuous: "center",
  right: "right",
  justify: "justify",
  distributed: "justify",
  fill: "left",
};

const VERTICAL: Readonly<Record<string, string>> = {
  top: "top",
  center: "middle",
  bottom: "bottom",
  justify: "middle",
  distributed: "middle",
};

/** The style's explicit horizontal alignment, or null for General. */
export function horizontalAlignment(style: XlsxRenderStyle | undefined): string | null {
  return style?.horizontalAlignment ? (HORIZONTAL[style.horizontalAlignment] ?? null) : null;
}

/** True when the style wraps text (no spill into neighbours). */
export function wrapsText(style: XlsxRenderStyle | undefined): boolean {
  return style?.wrapText === true;
}

/** The declarations for one workbook style at print scale `scale`. */
export function styleDeclarations(style: XlsxRenderStyle, scale: number): string[] {
  const out: string[] = [];
  const family = cssFontFamily(style.fontFamily);
  if (family) out.push(`font-family:${family}`);
  if (style.fontSize !== undefined && Number.isFinite(style.fontSize) && style.fontSize > 0) {
    out.push(`font-size:${round(style.fontSize * scale)}pt`);
  }
  if (style.bold) out.push("font-weight:700");
  if (style.italic) out.push("font-style:italic");
  const decorations = [style.underline ? "underline" : "", style.strikethrough ? "line-through" : ""].filter(Boolean);
  if (decorations.length > 0) out.push(`text-decoration:${decorations.join(" ")}`);
  const color = cssColor(style.fontColor);
  if (color) out.push(`color:${color}`);
  const fill = cssColor(style.fillColor);
  if (fill) out.push(`background-color:${fill}`);
  const horizontal = horizontalAlignment(style);
  if (horizontal) out.push(`text-align:${horizontal}`);
  const vertical = style.verticalAlignment ? VERTICAL[style.verticalAlignment] : undefined;
  if (vertical) out.push(`vertical-align:${vertical}`);
  if (style.indent !== undefined && Number.isFinite(style.indent) && style.indent > 0) {
    out.push(`padding-left:${round(style.indent * 9 * scale)}pt`);
  }
  if (style.wrapText) out.push("white-space:pre-wrap", "overflow-wrap:anywhere");
  const edges = [
    ["top", style.borderTop],
    ["bottom", style.borderBottom],
    ["left", style.borderLeft],
    ["right", style.borderRight],
  ] as const;
  for (const [side, edge] of edges) {
    const css = borderCss(edge);
    if (css) out.push(`border-${side}:${css}`);
  }
  return out;
}

/** The declarations that turn a cell's text (its `.rt` wrapper) by the
 *  style's OOXML rotation: 1-90 counterclockwise, 91-180 clockwise by
 *  value-90, 255 stacked top to bottom. Empty without a rotation. */
export function rotationDeclarations(style: XlsxRenderStyle): string[] {
  const rotation = style.textRotation;
  if (rotation === undefined || !Number.isFinite(rotation) || rotation === 0) return [];
  if (rotation === 255) return ["display:inline-block", "writing-mode:vertical-rl", "text-orientation:upright"];
  if (rotation < 0 || rotation > 180) return [];
  const degrees = rotation <= 90 ? -rotation : rotation - 90;
  return ["display:inline-block", "white-space:nowrap", `transform:rotate(${Math.round(degrees)}deg)`];
}

/** Two decimals, no trailing noise. */
export function round(value: number): number {
  return Math.round(value * 100) / 100;
}
