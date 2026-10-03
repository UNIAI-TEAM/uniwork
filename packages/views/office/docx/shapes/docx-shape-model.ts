// B9 (UNI-924): pure shape model for the Shapes toolbar group, its insert
// gallery and the properties panel. No editor and no React here; the TipTap
// glue lives in ./docx-shape-actions. The node attrs read/written are exactly
// the ones pmDocToSavePlan reads back from an editor-created genXml node
// (renderer/editor/convert.ts:2007-2068): textboxes[0] (fill/borderColor/
// widthPx/heightPx/prst) plus imageWrap and imageOffsetXEmu/YEmu.
import {
  DOCX_IMAGE_WRAPS,
  type DocxImageWrap,
  type DocxShapeDisplay,
  type DocxShapeKind,
} from "@uniwork/office-engine/docx";

/** The Basic Shapes gallery, in picker order (this task's set). */
export const DOCX_SHAPE_GALLERY: readonly { kind: DocxShapeKind; labelKey: string }[] = [
  { kind: "rect", labelKey: "office.docx.shapes.kind.rect" },
  { kind: "ellipse", labelKey: "office.docx.shapes.kind.ellipse" },
  { kind: "line", labelKey: "office.docx.shapes.kind.line" },
  { kind: "arrow", labelKey: "office.docx.shapes.kind.arrow" },
  { kind: "textBox", labelKey: "office.docx.shapes.kind.textBox" },
];

const MIN_SHAPE_PX = 1;
const MAX_SHAPE_PX = 10000;
const MIN_OFFSET_PX = -10000;
const MAX_OFFSET_PX = 10000;
const INT_RE = /^-?\d+$/;

/** Digits only: Number.parseInt would accept a numeric prefix of a typo. */
function parseIntExact(value: string): number | null {
  const text = value.trim();
  return INT_RE.test(text) ? Number(text) : null;
}

/** Numeric field text → whole px, null when out of range. */
export function parseShapePx(value: string): number | null {
  const parsed = parseIntExact(value);
  if (parsed === null || parsed < MIN_SHAPE_PX || parsed > MAX_SHAPE_PX) return null;
  return parsed;
}

/** Offset field text → whole px; empty is "no offset" (align-based position). */
export function parseOffsetPx(value: string): number | null {
  if (value.trim() === "") return null;
  const parsed = parseIntExact(value);
  if (parsed === null || parsed < MIN_OFFSET_PX || parsed > MAX_OFFSET_PX) return null;
  return parsed;
}

/** Straight line/connector prsts: the panel locks their height (Word keeps a
 * 12 px grab band; convert.ts:2046 skips their saved height). */
const STRAIGHT_LINE_PRSTS = new Set(["line", "lineArrow", "lineArrowDouble"]);

export interface DocxShapeInfo {
  prst: string | null;
  /** Straight line/connector: the height input is locked. */
  straight: boolean;
  fill: string | null;
  borderColor: string | null;
  widthPx: number;
  heightPx: number;
  wrap: DocxImageWrap | null;
  offsetXEmu: number | null;
  offsetYEmu: number | null;
}

const finite = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

function pickWrap(value: unknown): DocxImageWrap | null {
  return typeof value === "string" && (DOCX_IMAGE_WRAPS as readonly string[]).includes(value)
    ? (value as DocxImageWrap)
    : null;
}

/** Read a document node's shape surface; null when it carries no textboxes
 * (another protected kind, or an ordinary block). */
export function readDocxShapeInfo(attrs: Record<string, unknown> | null | undefined): DocxShapeInfo | null {
  if (!attrs) return null;
  const boxes = attrs.textboxes;
  if (!Array.isArray(boxes) || boxes.length === 0) return null;
  const box = boxes[0] as DocxShapeDisplay | null;
  if (!box || typeof box !== "object") return null;
  const prst = typeof box.prst === "string" ? box.prst : null;
  return {
    prst,
    straight: prst !== null && STRAIGHT_LINE_PRSTS.has(prst),
    fill: typeof box.fill === "string" ? box.fill : null,
    borderColor: typeof box.borderColor === "string" ? box.borderColor : null,
    widthPx: finite(box.widthPx) ?? 0,
    heightPx: finite(box.heightPx) ?? 0,
    wrap: pickWrap(attrs.imageWrap),
    offsetXEmu: finite(attrs.imageOffsetXEmu),
    offsetYEmu: finite(attrs.imageOffsetYEmu),
  };
}

/** Wrap picker modes: only the anchor modes the genXml save path re-encodes
 * (convert.ts:2061 calls applyImageWrap for a non-null imageWrap). "In line
 * with text" is deliberately absent: an explicitly null imageWrap is
 * indistinguishable from the untouched default at save time, so the vendored
 * branch drops it. A parsed shape's wrap change only reaches the file
 * piggybacked on an offset commit (convert.ts:1857-1860) — hence the offsets
 * beside the picker. No mode is preselected: a fresh insert keeps the anchor
 * its fragment carries. */
export const DOCX_SHAPE_WRAP_OPTIONS: readonly { wrap: DocxImageWrap; labelKey: string }[] = [
  { wrap: "square-left", labelKey: "office.docx.shapes.wrapSquareLeft" },
  { wrap: "square-right", labelKey: "office.docx.shapes.wrapSquareRight" },
  { wrap: "topBottom", labelKey: "office.docx.shapes.wrapTopBottom" },
  { wrap: "behind", labelKey: "office.docx.shapes.wrapBehind" },
  { wrap: "front", labelKey: "office.docx.shapes.wrapFront" },
];

export type DocxShapeEdit =
  | { kind: "fill"; color: string | null }
  | { kind: "outline"; color: string | null }
  | { kind: "size"; widthPx: number; heightPx: number }
  /** wrap is never null: the save path only re-encodes a non-null imageWrap. */
  | { kind: "position"; wrap: DocxImageWrap; offsetXEmu: number | null; offsetYEmu: number | null };

const HEX_RE = /^[0-9a-fA-F]{6}$/;

/** The attrs patch one panel edit maps to. Null when the edit cannot apply
 * (bad colour, unknown wrap, no textboxes); the panel disables those states. */
export function docxShapeAttrsPatch(
  attrs: Record<string, unknown> | null | undefined,
  edit: DocxShapeEdit,
): Record<string, unknown> | null {
  if (!attrs) return null;
  const boxes = attrs.textboxes;
  if (!Array.isArray(boxes) || boxes.length === 0) return null;
  const box = boxes[0] as DocxShapeDisplay | null;
  if (!box || typeof box !== "object") return null;
  const nextBox = { ...box };
  const rest = boxes.slice(1);
  switch (edit.kind) {
    case "fill":
    case "outline": {
      if (edit.color !== null && !HEX_RE.test(edit.color)) return null;
      if (edit.kind === "fill") {
        if (edit.color === null) delete nextBox.fill;
        else nextBox.fill = edit.color;
      } else {
        if (edit.color === null) delete nextBox.borderColor;
        else nextBox.borderColor = edit.color;
      }
      return { textboxes: [nextBox, ...rest] };
    }
    case "size": {
      nextBox.widthPx = Math.min(MAX_SHAPE_PX, Math.max(MIN_SHAPE_PX, Math.round(edit.widthPx)));
      if (!STRAIGHT_LINE_PRSTS.has(String(nextBox.prst))) {
        nextBox.heightPx = Math.min(MAX_SHAPE_PX, Math.max(MIN_SHAPE_PX, Math.round(edit.heightPx)));
      }
      return { textboxes: [nextBox, ...rest] };
    }
    case "position": {
      if (!(DOCX_IMAGE_WRAPS as readonly string[]).includes(edit.wrap)) return null;
      const x = edit.offsetXEmu === null ? null : Math.round(edit.offsetXEmu);
      const y = edit.offsetYEmu === null ? null : Math.round(edit.offsetYEmu);
      const offsets =
        x !== null && y !== null
          ? { imageOffsetXEmu: x, imageOffsetYEmu: y }
          : { imageOffsetXEmu: null, imageOffsetYEmu: null };
      return { imageWrap: edit.wrap, imagePosH: null, imagePosV: null, ...offsets };
    }
  }
}

/** One wrap-picker selection → the position edit, or null for the resting
 * state the save path cannot re-encode (no selection, or a value that is not
 * one of DOCX_SHAPE_WRAP_OPTIONS). */
export function docxShapeWrapEdit(value: string | null, shape: DocxShapeInfo): DocxShapeEdit | null {
  if (value === null || !(DOCX_IMAGE_WRAPS as readonly string[]).includes(value)) return null;
  return { kind: "position", wrap: value as DocxImageWrap, offsetXEmu: shape.offsetXEmu, offsetYEmu: shape.offsetYEmu };
}
