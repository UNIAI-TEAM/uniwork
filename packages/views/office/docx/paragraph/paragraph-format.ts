import type { Editor } from "@tiptap/core";
import type { Node as PmNode } from "@tiptap/pm/model";
import { resolveGalleryStyle, type DocxGalleryStyleId } from "./styles-gallery";

/** Word's alignment values as the vendored paragraph nodes store them (w:jc). */
export type ParagraphAlign = "left" | "center" | "right" | "justify";

export interface DocxParagraphFormatState {
  /** Effective alignment; a missing w:jc reads as left, so one button is always
   * the active one. */
  align: ParagraphAlign;
  /** Direct w:ind w:left in twips; null = inherit from the style/numbering. */
  indentLeftTwips: number | null;
  /** w:spacing w:line multiple; null = inherit. */
  lineSpacing: number | null;
  /** w:spacing w:before / w:after in twips; null = inherit. */
  spaceBeforeTwips: number | null;
  spaceAfterTwips: number | null;
  /** The styles-gallery entry the caret's block matches; null = a style
   * outside the gallery. */
  paragraphStyle: DocxGalleryStyleId | null;
}

export const EMPTY_PARAGRAPH_FORMAT_STATE: DocxParagraphFormatState = {
  align: "left",
  indentLeftTwips: null,
  lineSpacing: null,
  spaceBeforeTwips: null,
  spaceAfterTwips: null,
  paragraphStyle: null,
};

/** One toolbar indent click, matching Word's half-inch stop. */
export const INDENT_STEP_TWIPS = 720;

/** Word's line-spacing dropdown presets. */
export const LINE_SPACING_PRESETS: readonly number[] = [1, 1.15, 1.5, 2];

/** Word's maximum paragraph spacing (1584pt) and the bounds of the line
 * multiple input. */
export const MAX_SPACING_PT = 1584;
export const MIN_LINE_SPACING = 0.5;
export const MAX_LINE_SPACING = 10;

const PARAGRAPH_BLOCK_TYPES: ReadonlySet<string> = new Set(["docParagraph", "docHeading", "docListItem"]);
const ALIGNMENTS: ReadonlySet<string> = new Set(["left", "center", "right", "justify"]);

export function isParagraphBlock(node: PmNode): boolean {
  return PARAGRAPH_BLOCK_TYPES.has(node.type.name);
}

export function readParagraphAlign(value: unknown): ParagraphAlign {
  return typeof value === "string" && ALIGNMENTS.has(value) ? (value as ParagraphAlign) : "left";
}

function readTwips(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readLevel(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function readStyleId(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

export function readParagraphState(editor: Editor | null): DocxParagraphFormatState {
  if (!editor || editor.isDestroyed) return EMPTY_PARAGRAPH_FORMAT_STATE;
  const node = editor.state.selection.$from.parent;
  const attrs = node.attrs as Record<string, unknown>;
  return {
    align: readParagraphAlign(attrs.align),
    indentLeftTwips: readTwips(attrs.indentLeft),
    lineSpacing: readTwips(attrs.lineSpacing),
    spaceBeforeTwips: readTwips(attrs.spaceBefore),
    spaceAfterTwips: readTwips(attrs.spaceAfter),
    paragraphStyle: resolveGalleryStyle(node.type.name, readLevel(attrs.level), readStyleId(attrs.styleId)),
  };
}

/** "1.0" / "1.15" / "1.5" — trailing zeros stay so 1 and 1.15 do not look alike. */
export function formatLineSpacing(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? rounded.toFixed(1) : String(rounded);
}

export function ptFromTwips(twips: number | null): number | null {
  return twips === null ? null : twips / 20;
}
