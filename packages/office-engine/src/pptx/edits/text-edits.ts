// A1e (UNI-927) - text formatting edits (logic half): setFont + setParagraphFormat.
//
// Binds the two vendored pptx-ops kinds this area owns to one typed, validated
// op builder. The wire round registers `TextEdit` as `PptxEdit` kinds in
// model.ts and calls the builder mechanically:
//
//   this.txn(buildTextOps(this.opened, this.fitWidthPx, edit))
//
// `edit_text` (vendored setText) already exists as a PptxEdit kind and is NOT
// rebound here - only setFont and setParagraphFormat are new in this module.
//
// Vendored contract (READ ONLY - never imported; cited for every field):
//   setFont            packages/pptx-ops/src/ops/text-ops.ts:233
//                      validate :234-254 -> op.font must be an ElementFontPatch;
//                        font.color hex; font.fontSizePt finite and inside
//                        FONT_SIZE_PT_MIN..FONT_SIZE_PT_MAX
//                      apply    :255-270 -> setElementFont(slide, id, font)
//                      ElementFontPatch pptx-engine/src/index.ts:2915-2924:
//                        fontFamily?: string
//                        fontSizePt?: number
//                        strike?/bold?/italic?/underline?: boolean
//                        color?: string   (#RRGGBB, clears theme/inherit flags)
//                      NOTE: the vendored patch has NO highlight field, so this
//                      builder exposes none either (no invented fields).
//   setParagraphFormat packages/pptx-ops/src/ops/text-ops.ts:277
//                      validate :278-335 -> op.format must be an
//                        EditParagraphFormatPatch; schema ranges
//                        lineSpacingPct 0..13200, spaceBeforePt/spaceAfterPt
//                        0..1584, bulletSizePct 25..400, bulletHangEmu
//                        0..51206400; bulletColor hex; bulletChar/bulletFont/
//                        numType strings; startAt integer >= 1; bullet 'blip'
//                        needs bulletImage {base64,ext}; rtl boolean
//                      apply    :336-358 -> landBulletImage + setElementParagraphFormat
//                      ParagraphFormatPatch pptx-engine/src/index.ts:3110-3140
//                      EditParagraphFormatPatch = ParagraphFormatPatch + {bulletImage}
//                        packages/pptx-ops/src/edit-text.ts:222
//                      align values pptx-engine/src/types.ts:276
//                        (TextAlign = 'left'|'center'|'right'|'justify')
//                      bullet kinds (ParagraphFormatPatch.bullet): 'char' |
//                        'number' | 'blip' | 'none'
//                      FONT_SIZE_PT_MIN/MAX packages/pptx-ops/src/font-size.ts:2-3
//
// Both kinds are geometry-free: each patch formats every paragraph/run of the
// addressed element, so no px->EMU conversion happens here and neither op
// carries a paragraph/run payload (there is nothing to pass through the
// engine's PptxParagraphLike model). `fitWidthPx` stays in the signature only
// because every engine-half builder shares the same mechanical wire call.
import { PptxEngineError, type OpenedPptxLike, type PptxOp, type PptxSlideLike } from "../engine";

/** ST_TextFontSize range in points (font-size.ts:2-3). */
export const PPTX_FONT_SIZE_PT_MIN = 1;
export const PPTX_FONT_SIZE_PT_MAX = 4000;

/** TextAlign values (pptx-engine/src/types.ts:276). */
export const PPTX_TEXT_ALIGNS = ["left", "center", "right", "justify"] as const;
export type PptxTextAlign = (typeof PPTX_TEXT_ALIGNS)[number];

/** ParagraphFormatPatch.bullet values (pptx-engine/src/index.ts:3111-3112). */
export const PPTX_BULLET_KINDS = ["char", "number", "blip", "none"] as const;
export type PptxBulletKind = (typeof PPTX_BULLET_KINDS)[number];

/** indentDelta values (ParagraphFormatPatch, index.ts:3139). */
export const PPTX_INDENT_DELTAS = [1, -1] as const;

/** Schema ranges the vendored setParagraphFormat validate enforces
 * (text-ops.ts:286-292) - pinned by the unit test. */
export const PPTX_PARAGRAPH_RANGES = {
  lineSpacingPct: [0, 13200],
  spaceBeforePt: [0, 1584],
  spaceAfterPt: [0, 1584],
  bulletSizePct: [25, 400],
  bulletHangEmu: [0, 51206400],
} as const;

/** Hex colour guard, mirroring registry.ts:38-46 requireHexColor (#RRGGBB or
 * #RRGGBBAA, leading '#' optional). */
const HEX_COLOR_RE = /^#?[0-9A-Fa-f]{6}(?:[0-9A-Fa-f]{2})?$/;

/** ElementFontPatch (pptx-engine/src/index.ts:2915-2924), typed for the UI. */
export interface PptxFontPatch {
  fontFamily?: string;
  fontSizePt?: number;
  strike?: boolean;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  /** #RRGGBB (or #RRGGBBAA). */
  color?: string;
}

/** ParagraphFormatPatch (pptx-engine/src/index.ts:3110-3140) + the picture
 * bullet source the op layer lands as a media part (edit-text.ts:222). */
export interface PptxParagraphFormatPatch {
  bullet?: PptxBulletKind;
  numType?: string;
  startAt?: number;
  bulletImage?: { base64: string; ext: string };
  bulletChar?: string;
  bulletFont?: string;
  bulletHangEmu?: number;
  bulletSizePct?: number;
  bulletColor?: string;
  lineSpacingPct?: number;
  spaceBeforePt?: number;
  spaceAfterPt?: number;
  align?: PptxTextAlign;
  rtl?: boolean;
  indentDelta?: 1 | -1;
}

/** The edit kinds this module builds (registered as PptxEdit kinds by the wire
 * round):
 *  - set_font              -> vendored `setFont` (element target + font patch);
 *  - set_paragraph_format  -> vendored `setParagraphFormat` (element target +
 *                            paragraph-format patch). */
export type TextEdit =
  | { op: "set_font"; slideIndex: number; elementId: string; font: PptxFontPatch }
  | { op: "set_paragraph_format"; slideIndex: number; elementId: string; format: PptxParagraphFormatPatch };

const requireSlide = (opened: OpenedPptxLike, slideIndex: number, op: string): PptxSlideLike => {
  const slide =
    Number.isInteger(slideIndex) && slideIndex >= 0 ? opened.deck.slides[slideIndex] : undefined;
  if (!slide) {
    throw new PptxEngineError("text_no_slide", op + ": slide index " + String(slideIndex) + " does not exist");
  }
  return slide;
};

const requireElement = (slide: PptxSlideLike, elementId: string, op: string, slideIndex: number): void => {
  if (typeof elementId !== "string" || elementId.length === 0) {
    throw new PptxEngineError("text_no_element", op + ": elementId must be a non-empty string");
  }
  const found = slide.elements.some((candidate) => candidate.id === elementId);
  if (!found) {
    throw new PptxEngineError(
      "text_no_element",
      op + ': no element "' + elementId + '" on slide ' + String(slideIndex),
    );
  }
};

const requireBoolean = (value: unknown, op: string, field: string): boolean => {
  if (typeof value !== "boolean") {
    throw new PptxEngineError("text_bad_font", op + ': "' + field + '" must be a boolean');
  }
  return value;
};

const requireHexColor = (value: unknown, op: string, field: string): string => {
  if (typeof value !== "string" || !HEX_COLOR_RE.test(value)) {
    throw new PptxEngineError("text_bad_color", op + ': "' + field + '" must be a hex color "#RRGGBB"');
  }
  return value;
};

const requireFinite = (value: unknown, op: string, field: string): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new PptxEngineError("text_bad_paragraph", op + ': "' + field + '" must be a finite number');
  }
  return value;
};

const requireRange = (value: unknown, op: string, field: string, min: number, max: number): number => {
  const n = requireFinite(value, op, field);
  if (n < min || n > max) {
    throw new PptxEngineError("text_bad_paragraph", op + ': "' + field + '" must be ' + min + ".." + max);
  }
  return n;
};

const requireString = (value: unknown, op: string, field: string): string => {
  if (typeof value !== "string") {
    throw new PptxEngineError("text_bad_paragraph", op + ': "' + field + '" must be a string');
  }
  return value;
};

/** Validate an ElementFontPatch and copy only its known fields. */
const normalizeFont = (font: unknown): PptxFontPatch => {
  if (typeof font !== "object" || font === null || Array.isArray(font)) {
    throw new PptxEngineError("text_bad_font", 'set_font "font" must be an ElementFontPatch object');
  }
  const input = font as Record<string, unknown>;
  const out: PptxFontPatch = {};
  if (input.fontFamily !== undefined) {
    if (typeof input.fontFamily !== "string" || input.fontFamily.length === 0) {
      throw new PptxEngineError("text_bad_font", 'set_font "font.fontFamily" must be a non-empty string');
    }
    out.fontFamily = input.fontFamily;
  }
  if (input.fontSizePt !== undefined) {
    const size = requireFinite(input.fontSizePt, "set_font", "font.fontSizePt");
    if (size < PPTX_FONT_SIZE_PT_MIN || size > PPTX_FONT_SIZE_PT_MAX) {
      throw new PptxEngineError(
        "text_bad_font",
        "set_font \"font.fontSizePt\" must be " + PPTX_FONT_SIZE_PT_MIN + ".." + PPTX_FONT_SIZE_PT_MAX,
      );
    }
    out.fontSizePt = size;
  }
  for (const key of ["strike", "bold", "italic", "underline"] as const) {
    if (input[key] !== undefined) out[key] = requireBoolean(input[key], "set_font", "font." + key);
  }
  if (input.color !== undefined) out.color = requireHexColor(input.color, "set_font", "font.color");
  if (Object.keys(out).length === 0) {
    throw new PptxEngineError("text_bad_font", "set_font \"font\" must set at least one font field");
  }
  return out;
};

/** Validate an EditParagraphFormatPatch and copy only its known fields. */
const normalizeParagraphFormat = (format: unknown): PptxParagraphFormatPatch => {
  if (typeof format !== "object" || format === null || Array.isArray(format)) {
    throw new PptxEngineError(
      "text_bad_paragraph",
      'set_paragraph_format "format" must be a ParagraphFormatPatch object',
    );
  }
  const input = format as Record<string, unknown>;
  const out: PptxParagraphFormatPatch = {};
  if (input.bullet !== undefined) {
    if (!(PPTX_BULLET_KINDS as readonly unknown[]).includes(input.bullet)) {
      throw new PptxEngineError(
        "text_bad_paragraph",
        'set_paragraph_format "format.bullet" must be one of ' + PPTX_BULLET_KINDS.join(", "),
      );
    }
    out.bullet = input.bullet as PptxBulletKind;
  }
  if (input.align !== undefined) {
    if (!(PPTX_TEXT_ALIGNS as readonly unknown[]).includes(input.align)) {
      throw new PptxEngineError(
        "text_bad_paragraph",
        'set_paragraph_format "format.align" must be one of ' + PPTX_TEXT_ALIGNS.join(", "),
      );
    }
    out.align = input.align as PptxTextAlign;
  }
  if (input.numType !== undefined) out.numType = requireString(input.numType, "set_paragraph_format", "format.numType");
  if (input.bulletChar !== undefined) {
    out.bulletChar = requireString(input.bulletChar, "set_paragraph_format", "format.bulletChar");
  }
  if (input.bulletFont !== undefined) {
    out.bulletFont = requireString(input.bulletFont, "set_paragraph_format", "format.bulletFont");
  }
  if (input.startAt !== undefined) {
    const startAt = requireFinite(input.startAt, "set_paragraph_format", "format.startAt");
    if (!Number.isInteger(startAt) || startAt < 1) {
      throw new PptxEngineError("text_bad_paragraph", 'set_paragraph_format "format.startAt" must be an integer >= 1');
    }
    out.startAt = startAt;
  }
  for (const key of ["lineSpacingPct", "spaceBeforePt", "spaceAfterPt", "bulletSizePct", "bulletHangEmu"] as const) {
    if (input[key] !== undefined) {
      const [min, max] = PPTX_PARAGRAPH_RANGES[key];
      out[key] = requireRange(input[key], "set_paragraph_format", "format." + key, min, max);
    }
  }
  if (input.bulletColor !== undefined) {
    out.bulletColor = requireHexColor(input.bulletColor, "set_paragraph_format", "format.bulletColor");
  }
  if (input.rtl !== undefined) out.rtl = requireBoolean(input.rtl, "set_paragraph_format", "format.rtl");
  if (input.indentDelta !== undefined) {
    if (!(PPTX_INDENT_DELTAS as readonly unknown[]).includes(input.indentDelta)) {
      throw new PptxEngineError("text_bad_paragraph", 'set_paragraph_format "format.indentDelta" must be 1 or -1');
    }
    out.indentDelta = input.indentDelta as 1 | -1;
  }
  if (input.bulletImage !== undefined) {
    const image = input.bulletImage as { base64?: unknown; ext?: unknown } | null;
    if (typeof image?.base64 !== "string" || typeof image.ext !== "string") {
      throw new PptxEngineError(
        "text_bad_paragraph",
        'set_paragraph_format "format.bulletImage" must be { base64: string, ext: string }',
      );
    }
    out.bulletImage = { base64: image.base64, ext: image.ext };
  }
  if (out.bullet === "blip" && !out.bulletImage) {
    throw new PptxEngineError(
      "text_bad_paragraph",
      'set_paragraph_format bullet "blip" needs "format.bulletImage": { base64, ext }',
    );
  }
  if (Object.keys(out).length === 0) {
    throw new PptxEngineError(
      "text_bad_paragraph",
      'set_paragraph_format "format" must set at least one paragraph-format field',
    );
  }
  return out;
};

/** One validated edit -> the vendored op(s) the executor runs. Refusals are
 * typed PptxEngineError codes: text_no_slide (slide index absent from the
 * deck), text_no_element (target element missing), text_bad_font (font patch
 * shape / family / size / toggles), text_bad_color (color / bulletColor hex),
 * text_bad_paragraph (paragraph patch shape, align, bullet, indentDelta,
 * ranges, blip image). */
export function buildTextOps(opened: OpenedPptxLike, fitWidthPx: number, edit: TextEdit): PptxOp[] {
  // Element-scoped wholesale patches: nothing to convert (see the module
  // header). `void` keeps the uniform wire signature honest about the
  // deliberate non-use of the fit width.
  void fitWidthPx;
  switch (edit.op) {
    case "set_font": {
      const slide = requireSlide(opened, edit.slideIndex, "set_font");
      requireElement(slide, edit.elementId, "set_font", edit.slideIndex);
      const font = normalizeFont(edit.font);
      return [{ op: "setFont", target: { slide: edit.slideIndex, el: edit.elementId }, font }];
    }
    case "set_paragraph_format": {
      const slide = requireSlide(opened, edit.slideIndex, "set_paragraph_format");
      requireElement(slide, edit.elementId, "set_paragraph_format", edit.slideIndex);
      const format = normalizeParagraphFormat(edit.format);
      return [{ op: "setParagraphFormat", target: { slide: edit.slideIndex, el: edit.elementId }, format }];
    }
  }
}