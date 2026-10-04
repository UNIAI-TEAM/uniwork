import type { Editor } from "@tiptap/core";
import type { Node as PmNode, NodeType } from "@tiptap/pm/model";
import {
  INDENT_STEP_TWIPS,
  MAX_LINE_SPACING,
  MAX_SPACING_PT,
  MIN_LINE_SPACING,
  isParagraphBlock,
  readLevel,
  readParagraphAlign,
  readStyleId,
  readTwips,
  type ParagraphAlign,
} from "./paragraph-format";
import { galleryStyleId, headingLevelFor, type DocxGalleryStyleId } from "./styles-gallery";

export interface DocxParagraphCommands {
  /** The gallery paragraph alignment; a missing w:jc counts as "left". */
  setParagraphAlign(align: ParagraphAlign): void;
  /** One half-inch step for paragraphs/headings; one list level deeper or
   * shallower for a list item. */
  stepParagraphIndent(direction: 1 | -1): void;
  /** The w:spacing w:line multiple; null = inherit. Also clears an
   * exact/atLeast rule so the multiple renders. */
  setLineSpacing(multiple: number | null): void;
  /** w:spacing w:before in points; null (or 0) = inherit. */
  setSpaceBeforePt(pt: number | null): void;
  /** w:spacing w:after in points; null (or 0) = inherit. */
  setSpaceAfterPt(pt: number | null): void;
  /** Applies a styles-gallery entry (Normal, Heading 1-6, Title, Quote). */
  applyParagraphStyle(style: DocxGalleryStyleId): void;
}

/** Word clamps list levels to nine (w:ilvl 0..8). */
const LIST_MAX_LEVEL = 8;

interface BlockChange {
  /** Present only when the block type changes (heading <-> paragraph). */
  type?: PmNode["type"];
  attrs?: Record<string, unknown>;
}

function editable(editor: Editor | null): Editor | null {
  return editor && !editor.isDestroyed && editor.isEditable ? editor : null;
}

/** A block type may only be swapped where the parent's content expression
 * accepts the new type at that index. `setNodeMarkup` validates the node's own
 * content, not the parent's, so without this check a heading would land inside
 * a docTableCell/docTableHeader — schema-invalid, and the cell save path
 * (convert.ts cellParas) would drop the block's text. */
function canHostBlock(parent: PmNode | null, index: number, type: NodeType): boolean {
  return parent !== null && parent.canReplaceWith(index, index, type);
}

/** The cell save path (convert.ts cellParas/richParas) reads neither styleId
 * nor a block type swap, so a gallery style applied inside a cell would look
 * applied and revert on save. Refuse there instead of faking it. */
function inTableCell(parent: PmNode | null): boolean {
  if (!parent) return false;
  return parent.type.name === "docTableCell" || parent.type.name === "docTableHeader";
}

/**
 * Applies one change to every paragraph block the selection touches, the same
 * walk TipTap's updateAttributes does — extended so a gallery entry can also
 * swap the block type. A collapsed caret still visits its own block.
 */
function updateSelectedBlocks(
  editor: Editor | null,
  change: (node: PmNode, parent: PmNode | null, index: number) => BlockChange | null,
): void {
  const current = editable(editor);
  if (!current) return;
  const { state } = current;
  const { from, to } = state.selection;
  const tr = state.tr;
  let changed = false;
  state.doc.nodesBetween(from, to, (node, pos, parent, index) => {
    if (!isParagraphBlock(node)) return true;
    const patch = change(node, parent, index);
    if (patch !== null) {
      tr.setNodeMarkup(pos, patch.type, { ...node.attrs, ...patch.attrs });
      changed = true;
    }
    return false;
  });
  if (changed) current.view.dispatch(tr.scrollIntoView());
  // Clicking a ribbon control must not steal the caret from the document.
  current.commands.focus();
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function spacingTwipsFromPt(pt: number | null): number | null {
  if (pt === null || !Number.isFinite(pt) || pt <= 0) return null;
  return Math.round(clamp(pt, 0, MAX_SPACING_PT) * 20);
}

export function setParagraphAlign(editor: Editor | null, align: ParagraphAlign): void {
  updateSelectedBlocks(editor, (node) =>
    readParagraphAlign(node.attrs.align) === align ? null : { attrs: { align } },
  );
}

export function stepParagraphIndent(editor: Editor | null, direction: 1 | -1): void {
  updateSelectedBlocks(editor, (node) => {
    if (node.type.name === "docListItem") {
      const level = readLevel(node.attrs.ilvl) ?? 0;
      const next = clamp(level + direction, 0, LIST_MAX_LEVEL);
      return next === level ? null : { attrs: { ilvl: next } };
    }
    // Word snaps to the half-inch stops instead of adding 720 to whatever a
    // foreign file carried, and outdenting past the first stop clears the
    // direct indent to inherit (genoffice runStepIndent).
    const indent = readTwips(node.attrs.indentLeft) ?? 0;
    const next =
      direction > 0
        ? Math.floor(indent / INDENT_STEP_TWIPS) * INDENT_STEP_TWIPS + INDENT_STEP_TWIPS
        : Math.max(Math.ceil(indent / INDENT_STEP_TWIPS) * INDENT_STEP_TWIPS - INDENT_STEP_TWIPS, 0);
    if (next === indent) return null;
    return { attrs: { indentLeft: next === 0 ? null : next } };
  });
}

export function setLineSpacing(editor: Editor | null, multiple: number | null): void {
  if (multiple !== null && (!Number.isFinite(multiple) || multiple <= 0)) return;
  const value = multiple === null ? null : round2(clamp(multiple, MIN_LINE_SPACING, MAX_LINE_SPACING));
  updateSelectedBlocks(editor, (node) => {
    const existing = readTwips(node.attrs.lineSpacing);
    const hasRule = node.attrs.lineRule !== null && node.attrs.lineRule !== undefined;
    const hasRaw = node.attrs.lineRawTwips !== null && node.attrs.lineRawTwips !== undefined;
    if (existing === value && !hasRule && !hasRaw) return null;
    // The w:line multiple only renders when the rule is auto; an exact/atLeast
    // rule left in place would pin the old height.
    return { attrs: { lineSpacing: value, lineRule: null, lineRawTwips: null } };
  });
}

function setSpaceSide(editor: Editor | null, side: "spaceBefore" | "spaceAfter", pt: number | null): void {
  const twips = spacingTwipsFromPt(pt);
  updateSelectedBlocks(editor, (node) => {
    const existing = readTwips(node.attrs[side]);
    if (existing === twips) return null;
    return { attrs: { [side]: twips } };
  });
}

export function setSpaceBeforePt(editor: Editor | null, pt: number | null): void {
  setSpaceSide(editor, "spaceBefore", pt);
}

export function setSpaceAfterPt(editor: Editor | null, pt: number | null): void {
  setSpaceSide(editor, "spaceAfter", pt);
}

export function applyParagraphStyle(editor: Editor | null, style: DocxGalleryStyleId): void {
  const current = editable(editor);
  if (!current) return;
  const headingLevel = headingLevelFor(style);
  if (headingLevel !== null) {
    const headingType = current.schema.nodes.docHeading;
    if (!headingType) return;
    updateSelectedBlocks(current, (node, parent, index) => {
      if (!canHostBlock(parent, index, headingType)) return null;
      if (
        node.type.name === "docHeading" &&
        readLevel(node.attrs.level) === headingLevel &&
        readStyleId(node.attrs.styleId) === null &&
        !node.attrs.outlineOnly
      ) {
        return null;
      }
      // The same block shape base.setHeading writes: an explicit style would
      // win over the heading level in the OOXML writer.
      return { type: headingType, attrs: { level: headingLevel, styleId: null, outlineOnly: false } };
    });
    return;
  }
  const paragraphType = current.schema.nodes.docParagraph;
  const styleId = galleryStyleId(style);
  updateSelectedBlocks(current, (node, parent) => {
    if (inTableCell(parent)) return null;
    if (node.type.name === "docHeading") {
      if (!paragraphType) return null;
      return { type: paragraphType, attrs: { styleId } };
    }
    if (node.type.name !== "docParagraph" && node.type.name !== "docListItem") return null;
    if (readStyleId(node.attrs.styleId) === styleId) return null;
    // List items keep their numbering: the paragraph style is orthogonal.
    return { attrs: { styleId } };
  });
}
