/**
 * Text-format panel model (UNI-927, task WIRE-TEXT) - the pure half of the
 * text-formatting surface, built over the committed A1e engine kinds
 * (`packages/office-engine/src/pptx/edits/text-edits.ts`).
 *
 * Every control the panel renders turns UI state into exactly ONE committed
 * `TextEdit` union member - `set_font` or `set_paragraph_format` - never a raw
 * vendored op and never a second write path. The engine's own `PptxFontPatch`
 * and `PptxParagraphFormatPatch` types are the parameter types of the builders,
 * so a wrong field name is a compile error, not a runtime refusal.
 *
 * Field shapes mirror the vendored validators the A1e module cites
 * (`pptx-ops/src/ops/text-ops.ts:233` setFont, `:277` setParagraphFormat;
 * `ElementFontPatch` index.ts:2915-2924; `ParagraphFormatPatch` index.ts:3110-3140):
 *   font   : fontFamily | fontSizePt | strike | bold | italic | underline | color
 *   format : align | bullet | numType | bulletChar | bulletFont | lineSpacingPct
 *            (spaceBeforePt/spaceAfterPt/bulletSizePct/bulletHangEmu/bulletColor/
 *             startAt/rtl/indentDelta/bulletImage are not surfaced by this panel)
 *
 * KNOWN GAP (recorded, not invented): the vendored `ElementFontPatch` has no
 * highlight field, so the panel's highlight control is honestly disabled -
 * there is no committed edit that could carry a highlight colour. Closing it
 * needs an engine change (a highlight field on the patch), which is out of this
 * task's scope; A1e recorded the same limitation.
 *
 * Units: font size is points and line spacing is percent (100 = single), the
 * vendored units. Neither kind is geometry-dependent, so no px->EMU conversion
 * happens here.
 */
import {
  PPTX_BULLET_KINDS,
  PPTX_FONT_SIZE_PT_MAX,
  PPTX_FONT_SIZE_PT_MIN,
  PPTX_PARAGRAPH_RANGES,
  PPTX_TEXT_ALIGNS,
  PptxEngineError,
  type PptxFontPatch,
  type PptxParagraphFormatPatch,
  type PptxTextAlign,
  type TextEdit,
} from "@uniwork/office-engine/pptx";

/** The four character toggles the panel offers, in render order. */
export const PPTX_TEXT_FONT_TOGGLES = ["bold", "italic", "underline", "strike"] as const;
export type PptxTextFontToggle = (typeof PPTX_TEXT_FONT_TOGGLES)[number];

/** Bullet choices the panel offers (a picture bullet needs an image source the
 *  panel does not collect, so `blip` is deliberately not offered). */
export const PPTX_TEXT_BULLET_OPTIONS = ["none", "char", "number"] as const;
export type PptxTextBulletChoice = (typeof PPTX_TEXT_BULLET_OPTIONS)[number];

/** A small, safe font-family list: widely available families plus the OOXML
 *  theme references the deck already uses. The vendored op stores the string
 *  verbatim, so a value outside this list is still valid input. */
export const PPTX_TEXT_FONT_FAMILIES = [
  "Calibri",
  "Arial",
  "Helvetica",
  "Times New Roman",
  "Georgia",
  "Verdana",
  "Tahoma",
  "Courier New",
  "Consolas",
  "Segoe UI",
  "Roboto",
  "+mj-lt",
  "+mn-lt",
] as const;

/** Common font sizes in points (the op accepts any 1..4000). */
export const PPTX_TEXT_FONT_SIZE_PT_PRESETS = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 44, 54, 66, 80] as const;

/** Common line-spacing percentages (100 = single; the op accepts 0..13200). */
export const PPTX_TEXT_LINE_SPACING_PCT_PRESETS = [50, 75, 100, 115, 150, 200, 250, 300] as const;

/** Element types the committed text kinds can format: the vendored
 *  `setElementFont` / `setElementParagraphFormat` accept text and shape (and
 *  table cells, which this element-scoped panel does not target). */
export const PPTX_TEXT_FORMAT_ELEMENT_TYPES = ["text", "shape"] as const;

/** True when a font/paragraph edit may target an element of `elementType`; the
 *  panel disables its controls instead of sending an edit the engine would refuse. */
export function pptxTextFormatAllowed(elementType: string | null | undefined): boolean {
  return typeof elementType === "string" && (PPTX_TEXT_FORMAT_ELEMENT_TYPES as readonly string[]).includes(elementType);
}

/** Hex colour guard, mirroring the engine's `requireHexColor` (#RRGGBB or
 *  #RRGGBBAA, leading '#' optional) - registry.ts:38-46. */
const HEX_COLOR_RE = /^#?[0-9A-Fa-f]{6}(?:[0-9A-Fa-f]{2})?$/;

/** True when `value` is a colour the text ops accept (alpha allowed). */
export function isPptxHexColor(value: string): boolean {
  return HEX_COLOR_RE.test(value);
}

/** "#rrggbb" -> "#RRGGBB"; anything else is returned trimmed and unchanged, so a
 *  half-typed field is never silently rewritten into a valid colour. */
function normalizePptxHex(value: string): string {
  const trimmed = value.trim();
  if (!HEX_COLOR_RE.test(trimmed)) return trimmed;
  return ("#" + trimmed.replace(/^#/, "")).toUpperCase();
}

/** The `type="color"` input value for a field: a valid "#RRGGBB" (the 8-digit
 *  alpha form sliced to its RGB half), else the caller's fallback. */
export function pptxColorInputValue(value: string, fallback: string): string {
  if (!isPptxHexColor(value)) return fallback;
  const normalized = normalizePptxHex(value);
  return normalized.length > 7 ? normalized.slice(0, 7) : normalized;
}

/** A field value -> a font size inside the vendored 1..4000 pt range, or null. */
export function parsePptxFontSizePt(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < PPTX_FONT_SIZE_PT_MIN || value > PPTX_FONT_SIZE_PT_MAX) return null;
  return value;
}

/** A field value -> an integer line-spacing percent in the vendored 0..13200
 *  range, or null. */
export function parsePptxLineSpacingPct(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  const value = Number(trimmed);
  const [min, max] = PPTX_PARAGRAPH_RANGES.lineSpacingPct;
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < min || value > max) return null;
  return value;
}

/** The honest refusal the engine throws: a `PptxEngineError` with the same
 *  stable `text_*` code `buildTextOps` would answer. */
function refusal(code: string, message: string): PptxEngineError {
  return new PptxEngineError(code, message);
}

/**
 * `set_font` from a `PptxFontPatch`. Validates every known field the way the
 * vendored `normalizeFont` does and copies only those fields, so a stray key
 * never reaches the deck. Refusals: text_bad_font (shape / family / size /
 * toggles / empty patch), text_bad_color (colour hex).
 */
function buildSetFontEdit(slideIndex: number, elementId: string, font: PptxFontPatch): TextEdit {
  if (typeof font !== "object" || font === null || Array.isArray(font)) {
    throw refusal("text_bad_font", 'set_font "font" must be a PptxFontPatch object');
  }
  const out: PptxFontPatch = {};
  if (font.fontFamily !== undefined) {
    if (typeof font.fontFamily !== "string" || font.fontFamily.trim().length === 0) {
      throw refusal("text_bad_font", 'set_font "font.fontFamily" must be a non-empty string');
    }
    out.fontFamily = font.fontFamily.trim();
  }
  if (font.fontSizePt !== undefined) {
    const size = font.fontSizePt;
    if (typeof size !== "number" || !Number.isFinite(size) || size < PPTX_FONT_SIZE_PT_MIN || size > PPTX_FONT_SIZE_PT_MAX) {
      throw refusal(
        "text_bad_font",
        "set_font \"font.fontSizePt\" must be " + PPTX_FONT_SIZE_PT_MIN + ".." + PPTX_FONT_SIZE_PT_MAX,
      );
    }
    out.fontSizePt = size;
  }
  for (const key of PPTX_TEXT_FONT_TOGGLES) {
    const value = font[key];
    if (value === undefined) continue;
    if (typeof value !== "boolean") throw refusal("text_bad_font", 'set_font "font.' + key + '" must be a boolean');
    out[key] = value;
  }
  if (font.color !== undefined) {
    if (typeof font.color !== "string" || !isPptxHexColor(font.color)) {
      throw refusal("text_bad_color", 'set_font "font.color" must be a hex color "#RRGGBB"');
    }
    out.color = normalizePptxHex(font.color);
  }
  if (Object.keys(out).length === 0) {
    throw refusal("text_bad_font", 'set_font "font" must set at least one font field');
  }
  return { op: "set_font", slideIndex, elementId, font: out };
}

/**
 * `set_paragraph_format` from a `PptxParagraphFormatPatch`. Validates the fields
 * this panel can produce (align, bullet, lineSpacingPct) with the vendored
 * ranges and copies only known fields. Refusals: text_bad_paragraph.
 */
function buildSetParagraphFormatEdit(
  slideIndex: number,
  elementId: string,
  format: PptxParagraphFormatPatch,
): TextEdit {
  if (typeof format !== "object" || format === null || Array.isArray(format)) {
    throw refusal("text_bad_paragraph", 'set_paragraph_format "format" must be a PptxParagraphFormatPatch object');
  }
  const out: PptxParagraphFormatPatch = {};
  if (format.align !== undefined) {
    if (!(PPTX_TEXT_ALIGNS as readonly unknown[]).includes(format.align)) {
      throw refusal("text_bad_paragraph", 'set_paragraph_format "format.align" must be one of ' + PPTX_TEXT_ALIGNS.join(", "));
    }
    out.align = format.align;
  }
  if (format.bullet !== undefined) {
    if (!(PPTX_BULLET_KINDS as readonly unknown[]).includes(format.bullet)) {
      throw refusal("text_bad_paragraph", 'set_paragraph_format "format.bullet" must be one of ' + PPTX_BULLET_KINDS.join(", "));
    }
    out.bullet = format.bullet;
  }
  if (format.lineSpacingPct !== undefined) {
    const [min, max] = PPTX_PARAGRAPH_RANGES.lineSpacingPct;
    const value = format.lineSpacingPct;
    if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
      throw refusal("text_bad_paragraph", 'set_paragraph_format "format.lineSpacingPct" must be ' + min + ".." + max);
    }
    out.lineSpacingPct = value;
  }
  if (Object.keys(out).length === 0) {
    throw refusal("text_bad_paragraph", 'set_paragraph_format "format" must set at least one paragraph-format field');
  }
  return { op: "set_paragraph_format", slideIndex, elementId, format: out };
}

/** Bold / italic / underline / strike -> one `set_font` with that single toggle. */
export function buildFontToggleEdit(
  slideIndex: number,
  elementId: string,
  toggle: PptxTextFontToggle,
  next: boolean,
): TextEdit {
  const font: PptxFontPatch = {};
  font[toggle] = next;
  return buildSetFontEdit(slideIndex, elementId, font);
}

/** Font family -> one `set_font`. */
export function buildFontFamilyEdit(slideIndex: number, elementId: string, family: string): TextEdit {
  return buildSetFontEdit(slideIndex, elementId, { fontFamily: family });
}

/** Font size (pt) -> one `set_font`; refuses a size outside 1..4000. */
export function buildFontSizeEdit(slideIndex: number, elementId: string, sizePt: number): TextEdit {
  return buildSetFontEdit(slideIndex, elementId, { fontSizePt: sizePt });
}

/** Text colour -> one `set_font`; refuses a non-hex colour. */
export function buildTextColorEdit(slideIndex: number, elementId: string, color: string): TextEdit {
  return buildSetFontEdit(slideIndex, elementId, { color });
}

/** Horizontal alignment -> one `set_paragraph_format`. */
export function buildAlignEdit(slideIndex: number, elementId: string, align: PptxTextAlign): TextEdit {
  return buildSetParagraphFormatEdit(slideIndex, elementId, { align });
}

/** Bullets / numbering -> one `set_paragraph_format`. */
export function buildBulletEdit(slideIndex: number, elementId: string, bullet: PptxTextBulletChoice): TextEdit {
  return buildSetParagraphFormatEdit(slideIndex, elementId, { bullet });
}

/** Line spacing (percent, 100 = single) -> one `set_paragraph_format`. */
export function buildLineSpacingEdit(slideIndex: number, elementId: string, pct: number): TextEdit {
  return buildSetParagraphFormatEdit(slideIndex, elementId, { lineSpacingPct: pct });
}