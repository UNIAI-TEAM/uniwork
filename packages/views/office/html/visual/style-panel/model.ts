/**
 * Pure model for the H7 HTML style panel.
 *
 * The panel is presentational: it renders the style values the caller holds and
 * reports intent through callbacks. Every shape it speaks and every piece of
 * arithmetic it needs lives here, with no React, no DOM and no engine call, so
 * the aspect-lock maths and the defaults/merge can be unit-tested on their own
 * and the component stays a thin renderer.
 *
 * Nothing in this file reads or writes a document, calls an H3 op or sends an
 * inspector command: a style value is data the caller owns, and the panel only
 * reports the patch the person asked for.
 */

/** Font weights the panel offers, as CSS numbers. */
export const HTML_STYLE_FONT_WEIGHTS = [400, 500, 600, 700] as const;

export type HtmlStyleFontWeight = (typeof HTML_STYLE_FONT_WEIGHTS)[number];

/** The text alignments the panel offers. */
export const HTML_STYLE_ALIGNMENTS = ["left", "center", "right", "justify"] as const;

export type HtmlStyleAlign = (typeof HTML_STYLE_ALIGNMENTS)[number];

/** The image fits the brief names: contain / cover / fill. */
export const HTML_STYLE_FITS = ["contain", "cover", "fill"] as const;

export type HtmlStyleFit = (typeof HTML_STYLE_FITS)[number];

/**
 * Convenience list for the family picker. It is not a whitelist: the current
 * family is added to the options when it is not in the list, so a document that
 * names any font still shows the family it carries.
 */
export const HTML_STYLE_FONT_FAMILIES: readonly string[] = [
  "system-ui",
  "Arial",
  "Georgia",
  "Times New Roman",
  "Courier New",
  "Verdana",
];

/**
 * The picker's "inherit" row. A select cannot carry a null value, so the row
 * uses a sentinel and the two helpers below translate it both ways - the
 * component never branches on it.
 */
export const HTML_STYLE_FONT_INHERIT = "__inherit__";

/** The picker value for a family, or null when the element inherits. */
export function fontFamilyFromSelectValue(value: string): string | null {
  return value === HTML_STYLE_FONT_INHERIT ? null : value;
}

/** The picker value that shows `family`, or the inherit row for null. */
export function selectValueForFontFamily(family: string | null): string {
  return family ?? HTML_STYLE_FONT_INHERIT;
}

/** Size bounds in px. A value outside them is not a size the panel will report. */
export const STYLE_SIZE_MIN = 1;
export const STYLE_SIZE_MAX = 8192;

/** Opacity is a whole percentage, so the field and the readout cannot disagree. */
export const STYLE_OPACITY_MIN = 0;
export const STYLE_OPACITY_MAX = 100;
export const STYLE_OPACITY_DEFAULT = 100;

/** The textarea's cap: CSS the panel will never inject, only report. */
export const CUSTOM_CSS_MAX_LENGTH = 4000;

/**
 * The size half of the style values. `aspectRatio` is the element's natural
 * width / height (the caller reads it off the image); null means "not known",
 * and the lock then keeps the two sides equal instead of guessing a ratio.
 */
export interface HtmlStyleSize {
  width: number | null;
  height: number | null;
  aspectLocked: boolean;
  aspectRatio: number | null;
}

/** Everything the panel renders. A null means "not set" (inherit / none). */
export interface HtmlStyleValues {
  fontFamily: string | null;
  fontWeight: HtmlStyleFontWeight | null;
  textAlign: HtmlStyleAlign | null;
  size: HtmlStyleSize;
  /** A colour value (`#rrggbb`), i.e. document data - never a theme token. */
  background: string | null;
  /** Whole percent, 0-100. */
  opacity: number;
  alt: string | null;
  fit: HtmlStyleFit | null;
  customCss: string;
}

/**
 * What the panel reports. Only the groups the person touched are present, and a
 * null clears the field (inherit / none) - the caller decides how a patch
 * becomes an H3 op, and this type never carries one.
 */
export interface HtmlStylePatch {
  typography?: {
    fontFamily?: string | null;
    fontWeight?: HtmlStyleFontWeight | null;
    textAlign?: HtmlStyleAlign | null;
  };
  size?: {
    width?: number | null;
    height?: number | null;
    aspectLocked?: boolean;
  };
  background?: string | null;
  opacity?: number;
  alt?: string | null;
  fit?: HtmlStyleFit | null;
  customCss?: string;
}

/** The panel's starting point: nothing set, full opacity, no custom CSS. */
export function defaultHtmlStyleValues(): HtmlStyleValues {
  return {
    fontFamily: null,
    fontWeight: null,
    textAlign: null,
    size: { width: null, height: null, aspectLocked: false, aspectRatio: null },
    background: null,
    opacity: STYLE_OPACITY_DEFAULT,
    alt: null,
    fit: null,
    customCss: "",
  };
}

/** A size in px, rounded and clamped; null when there is no honest number. */
export function clampStyleSize(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.min(STYLE_SIZE_MAX, Math.max(STYLE_SIZE_MIN, Math.round(value)));
}

/** A whole-percent opacity in 0-100; a missing or broken value is the default. */
export function clampOpacity(value: number | null | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return STYLE_OPACITY_DEFAULT;
  return Math.min(STYLE_OPACITY_MAX, Math.max(STYLE_OPACITY_MIN, Math.round(value)));
}

/** A ratio is usable only when it is a positive finite number. */
function knownRatio(ratio: number | null): number | null {
  if (typeof ratio !== "number" || !Number.isFinite(ratio) || ratio <= 0) return null;
  return ratio;
}

/**
 * Recompute the size after one dimension is edited.
 *
 * - Lock off: only the edited side changes.
 * - Lock on with a known ratio: the other side follows (`height = width /
 *   ratio`), rounded like every other size, so the two stay in ratio.
 * - Lock on with no usable ratio: both sides take the edited value, which keeps
 *   the box square rather than emitting a NaN height.
 * - A cleared side stays cleared even when locked: there is nothing to derive
 *   the other side from.
 */
export function applyAspectLock(size: HtmlStyleSize, field: "width" | "height", next: number | null): HtmlStyleSize {
  const value = clampStyleSize(next);
  if (!size.aspectLocked) {
    return field === "width" ? { ...size, width: value } : { ...size, height: value };
  }
  if (value === null) {
    return field === "width" ? { ...size, width: null } : { ...size, height: null };
  }
  const ratio = knownRatio(size.aspectRatio);
  if (ratio === null) return { ...size, width: value, height: value };
  if (field === "width") return { ...size, width: value, height: clampStyleSize(value / ratio) };
  return { ...size, width: clampStyleSize(value * ratio), height: value };
}

/**
 * Fold a patch into the current values. Only the fields the patch carries move;
 * sizes and opacity are clamped on the way in, so a value the caller reads back
 * is always one the panel would have reported.
 */
export function mergeHtmlStyleValues(values: HtmlStyleValues, patch: HtmlStylePatch): HtmlStyleValues {
  const typography = patch.typography;
  const size = patch.size;
  return {
    fontFamily: typography?.fontFamily !== undefined ? typography.fontFamily : values.fontFamily,
    fontWeight: typography?.fontWeight !== undefined ? typography.fontWeight : values.fontWeight,
    textAlign: typography?.textAlign !== undefined ? typography.textAlign : values.textAlign,
    size: {
      width: size?.width !== undefined ? clampStyleSize(size.width) : values.size.width,
      height: size?.height !== undefined ? clampStyleSize(size.height) : values.size.height,
      aspectLocked: size?.aspectLocked !== undefined ? size.aspectLocked : values.size.aspectLocked,
      aspectRatio: values.size.aspectRatio,
    },
    background: patch.background !== undefined ? patch.background : values.background,
    opacity: patch.opacity !== undefined ? clampOpacity(patch.opacity) : values.opacity,
    alt: patch.alt !== undefined ? patch.alt : values.alt,
    fit: patch.fit !== undefined ? patch.fit : values.fit,
    customCss: patch.customCss !== undefined ? normalizeCustomCss(patch.customCss) : values.customCss,
  };
}

/** True only for a string: the panel hands CSS on as text and never as markup. */
export function isPlainCssString(value: unknown): value is string {
  return typeof value === "string";
}

/** The CSS text the panel reports: NUL stripped, length capped, nothing else. */
export function normalizeCustomCss(value: unknown): string {
  if (!isPlainCssString(value)) return "";
  return value.replaceAll("\u0000", "").slice(0, CUSTOM_CSS_MAX_LENGTH);
}

const HEX_COLOUR_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** `#rgb` / `#rrggbb` to lowercase `#rrggbb`; anything else is not a colour. */
export function normalizeHexColour(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!HEX_COLOUR_RE.test(trimmed)) return null;
  const hex = trimmed.slice(1).toLowerCase();
  const full = hex.length === 3 ? hex.split("").map((character) => character + character).join("") : hex;
  return "#" + full;
}
