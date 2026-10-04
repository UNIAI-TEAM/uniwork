// Wave A/B session gestures (UNI-927) - extracted from model.ts so the
// PptxEdit union + registry stay under the 500-line module bound (eslint
// max-lines, excluding blanks/comments). model.ts imports these; the registry
// there dispatches every kind to exactly one of them.
//
// Each function is the mechanical gesture the wire round registers: one call
// to the area builder with the model's opened deck + fit width, then exactly
// one transaction. Validation and px->EMU conversion stay in the builders;
// nothing is duplicated here.
//
// Kinds whose op records a created id (add_table, add_chart) return createdId.
// table_merge/table_structure reparse the slide and regenerate element ids;
// the vendored executor records the surviving id in the record's
// `after.elementId` (table-ops.ts apply), surfaced here as elementId so
// selection can follow. There is no host channel for that id yet, so it rides
// the returned result only (see the WIRE report).
import {
  PptxEngineError,
  type OpenedPptxLike,
  type PptxOp,
  type PptxOpRecord,
  type PptxTxnResult,
} from "./engine";
import { buildAnimationOps, type AnimationEdit } from "./edits/animation-edits";
import { buildChartOps, type ChartEdit } from "./edits/chart-edits";
import { buildFindLinkOps, type FindLinkEdit } from "./edits/find-link-edits";
import { buildFormatOps, type FormatEdit } from "./edits/format-edits";
import { buildHeaderFooterOps, type HeaderFooterEdit } from "./edits/headerfooter-edits";
import { buildMediaOps, type MediaEdit } from "./edits/media-edits";
import { buildNotesCommentOps, type NotesCommentEdit } from "./edits/notes-comment-edits";
import { buildSectionOps, type SectionEdit } from "./edits/section-edits";
import { buildTableOps, type TableEdit } from "./edits/table-edits";
import { buildTextOps, type TextEdit } from "./edits/text-edits";
import { buildThemeOps, type ThemeEdit } from "./edits/theme-edits";
import { buildTransitionOps, type TransitionEdit } from "./edits/transition-edits";

/** The model surface these gestures need; PptxSessionModel satisfies it via
 * its runBuiltTxn seam (one dry-run plan + one atomic apply). */
export interface WaveGestureModel {
  opened: OpenedPptxLike;
  fitWidthPx: number;
  /** One dry-run plan + one atomic apply (PptxSessionModel.txn). */
  runBuiltTxn(ops: PptxOp[]): PptxTxnResult;
}

const createdIds = (records: PptxOpRecord[] | undefined): string[] =>
  (records ?? []).flatMap((record) => record.created ?? []);

const survivingElementId = (records: PptxOpRecord[] | undefined): string | undefined => {
  for (const record of records ?? []) {
    const after = record.after as { elementId?: unknown } | undefined;
    if (typeof after?.elementId === "string") return after.elementId;
  }
  return undefined;
};

const requireCreated = (records: PptxOpRecord[] | undefined, op: string): string => {
  const created = createdIds(records);
  if (created.length === 0) {
    throw new PptxEngineError("no_created_element", op + " reported no created element id");
  }
  return created[0] as string;
};

// -- design (B1e theme-edits.ts) ------------------------------------------

/** apply_theme -> buildThemeOps.applyTheme (slide-ops.ts:730). Deck-level. */
export function applyThemeGesture(model: WaveGestureModel, edit: Extract<ThemeEdit, { op: "apply_theme" }>): void {
  model.runBuiltTxn(buildThemeOps(model.opened, model.fitWidthPx, edit));
}

/** set_slide_size -> buildThemeOps.setSlideSize (slide-ops.ts:318), EMU. */
export function setSlideSizeGesture(model: WaveGestureModel, edit: Extract<ThemeEdit, { op: "set_slide_size" }>): void {
  model.runBuiltTxn(buildThemeOps(model.opened, model.fitWidthPx, edit));
}

/** set_background -> buildThemeOps.setBackground (slide-ops.ts:382); an index
 * array fans out to one op per slide inside one atomic transaction. */
export function setBackgroundGesture(model: WaveGestureModel, edit: Extract<ThemeEdit, { op: "set_background" }>): void {
  model.runBuiltTxn(buildThemeOps(model.opened, model.fitWidthPx, edit));
}

/** set_slide_layout -> buildThemeOps.setSlideLayout (slide-ops.ts:296). */
export function setSlideLayoutGesture(model: WaveGestureModel, edit: Extract<ThemeEdit, { op: "set_slide_layout" }>): void {
  model.runBuiltTxn(buildThemeOps(model.opened, model.fitWidthPx, edit));
}

// -- tables (B2e table-edits.ts) ------------------------------------------

/** add_table -> buildTableOps.addTable (insert-ops.ts:174): px rect -> EMU. */
export function addTableGesture(
  model: WaveGestureModel,
  edit: Extract<TableEdit, { op: "add_table" }>,
): { applied: true; createdId: string } {
  const result = model.runBuiltTxn(buildTableOps(model.opened, model.fitWidthPx, edit));
  return { applied: true, createdId: requireCreated(result.records, "addTable") };
}

/** set_table_cell -> buildTableOps.setTableCell (table-ops.ts:35). */
export function setTableCellGesture(model: WaveGestureModel, edit: Extract<TableEdit, { op: "set_table_cell" }>): void {
  model.runBuiltTxn(buildTableOps(model.opened, model.fitWidthPx, edit));
}

/** table_merge -> buildTableOps.tableMerge (table-ops.ts:75). */
export function tableMergeGesture(
  model: WaveGestureModel,
  edit: Extract<TableEdit, { op: "table_merge" }>,
): { applied: true; elementId?: string } {
  const result = model.runBuiltTxn(buildTableOps(model.opened, model.fitWidthPx, edit));
  const elementId = survivingElementId(result.records);
  return { applied: true, ...(elementId === undefined ? {} : { elementId }) };
}

/** table_structure -> buildTableOps.tableStructure (table-ops.ts:99). */
export function tableStructureGesture(
  model: WaveGestureModel,
  edit: Extract<TableEdit, { op: "table_structure" }>,
): { applied: true; elementId?: string } {
  const result = model.runBuiltTxn(buildTableOps(model.opened, model.fitWidthPx, edit));
  const elementId = survivingElementId(result.records);
  return { applied: true, ...(elementId === undefined ? {} : { elementId }) };
}

/** set_table_row_height -> buildTableOps.setTableRowHeight (table-ops.ts:123). */
export function setTableRowHeightGesture(
  model: WaveGestureModel,
  edit: Extract<TableEdit, { op: "set_table_row_height" }>,
): void {
  model.runBuiltTxn(buildTableOps(model.opened, model.fitWidthPx, edit));
}

/** set_table_col_width -> buildTableOps.setTableColWidth (table-ops.ts:170). */
export function setTableColWidthGesture(
  model: WaveGestureModel,
  edit: Extract<TableEdit, { op: "set_table_col_width" }>,
): void {
  model.runBuiltTxn(buildTableOps(model.opened, model.fitWidthPx, edit));
}

/** set_table_cell_anchor -> buildTableOps.setTableCellAnchor (table-ops.ts:140). */
export function setTableCellAnchorGesture(
  model: WaveGestureModel,
  edit: Extract<TableEdit, { op: "set_table_cell_anchor" }>,
): void {
  model.runBuiltTxn(buildTableOps(model.opened, model.fitWidthPx, edit));
}

/** set_table_style -> buildTableOps.setTableStyle (table-ops.ts:296). */
export function setTableStyleGesture(model: WaveGestureModel, edit: Extract<TableEdit, { op: "set_table_style" }>): void {
  model.runBuiltTxn(buildTableOps(model.opened, model.fitWidthPx, edit));
}

// -- charts (B3e chart-edits.ts) ------------------------------------------

/** add_chart -> buildChartOps.addChart (insert-ops.ts:218): px rect -> EMU. */
export function addChartGesture(
  model: WaveGestureModel,
  edit: Extract<ChartEdit, { op: "add_chart" }>,
): { applied: true; createdId: string } {
  const result = model.runBuiltTxn(buildChartOps(model.opened, model.fitWidthPx, edit));
  return { applied: true, createdId: requireCreated(result.records, "addChart") };
}

/** set_chart -> buildChartOps.setChart (table-ops.ts:316). */
export function setChartGesture(model: WaveGestureModel, edit: Extract<ChartEdit, { op: "set_chart" }>): void {
  model.runBuiltTxn(buildChartOps(model.opened, model.fitWidthPx, edit));
}

// -- transitions (B4e transition-edits.ts) --------------------------------

/** set_transition -> buildTransitionOps.setTransition (slide-ops.ts:473). */
export function setTransitionGesture(
  model: WaveGestureModel,
  edit: Extract<TransitionEdit, { op: "set_transition" }>,
): void {
  model.runBuiltTxn(buildTransitionOps(model.opened, model.fitWidthPx, edit));
}

/** set_advance_time -> buildTransitionOps.setAdvanceTime (slide-ops.ts:491). */
export function setAdvanceTimeGesture(
  model: WaveGestureModel,
  edit: Extract<TransitionEdit, { op: "set_advance_time" }>,
): void {
  model.runBuiltTxn(buildTransitionOps(model.opened, model.fitWidthPx, edit));
}

// -- find/link (A6e find-link-edits.ts) -----------------------------------

/** find_replace -> buildFindLinkOps.findReplace (slide-ops.ts:583). Deck-level. */
export function findReplaceGesture(model: WaveGestureModel, edit: Extract<FindLinkEdit, { op: "find_replace" }>): void {
  model.runBuiltTxn(buildFindLinkOps(model.opened, model.fitWidthPx, edit));
}

/** set_link -> buildFindLinkOps.setLink (element-ops.ts:558). */
export function setLinkGesture(model: WaveGestureModel, edit: Extract<FindLinkEdit, { op: "set_link" }>): void {
  model.runBuiltTxn(buildFindLinkOps(model.opened, model.fitWidthPx, edit));
}

// -- sections (A2e section-edits.ts) --------------------------------------

/** add_section -> buildSectionOps.addSection (slide-ops.ts:648). */
export function addSectionGesture(model: WaveGestureModel, edit: Extract<SectionEdit, { op: "add_section" }>): void {
  model.runBuiltTxn(buildSectionOps(model.opened, model.fitWidthPx, edit));
}

/** rename_section -> buildSectionOps.renameSection (slide-ops.ts:651). */
export function renameSectionGesture(
  model: WaveGestureModel,
  edit: Extract<SectionEdit, { op: "rename_section" }>,
): void {
  model.runBuiltTxn(buildSectionOps(model.opened, model.fitWidthPx, edit));
}

/** remove_section -> buildSectionOps.removeSection (slide-ops.ts:654, keepSlides). */
export function removeSectionGesture(
  model: WaveGestureModel,
  edit: Extract<SectionEdit, { op: "remove_section" }>,
): void {
  model.runBuiltTxn(buildSectionOps(model.opened, model.fitWidthPx, edit));
}

/** move_section -> buildSectionOps.moveSection (slide-ops.ts:657). */
export function moveSectionGesture(model: WaveGestureModel, edit: Extract<SectionEdit, { op: "move_section" }>): void {
  model.runBuiltTxn(buildSectionOps(model.opened, model.fitWidthPx, edit));
}

/** set_sections -> buildSectionOps.setSections (slide-ops.ts:638). */
export function setSectionsGesture(model: WaveGestureModel, edit: Extract<SectionEdit, { op: "set_sections" }>): void {
  model.runBuiltTxn(buildSectionOps(model.opened, model.fitWidthPx, edit));
}

// -- animations (B5e animation-edits.ts) ----------------------------------

/** add_animation -> buildAnimationOps.addAnimation (animation-ops.ts:284). */
export function addAnimationGesture(
  model: WaveGestureModel,
  edit: Extract<AnimationEdit, { op: "add_animation" }>,
): void {
  model.runBuiltTxn(buildAnimationOps(model.opened, model.fitWidthPx, edit));
}

/** remove_animation -> buildAnimationOps.removeAnimation (animation-ops.ts:308). */
export function removeAnimationGesture(
  model: WaveGestureModel,
  edit: Extract<AnimationEdit, { op: "remove_animation" }>,
): void {
  model.runBuiltTxn(buildAnimationOps(model.opened, model.fitWidthPx, edit));
}

/** reorder_animation -> buildAnimationOps.reorderAnimation (animation-ops.ts:341). */
export function reorderAnimationGesture(
  model: WaveGestureModel,
  edit: Extract<AnimationEdit, { op: "reorder_animation" }>,
): void {
  model.runBuiltTxn(buildAnimationOps(model.opened, model.fitWidthPx, edit));
}

/** set_animations -> buildAnimationOps.setAnimations (slide-ops.ts:511). */
export function setAnimationsGesture(
  model: WaveGestureModel,
  edit: Extract<AnimationEdit, { op: "set_animations" }>,
): void {
  model.runBuiltTxn(buildAnimationOps(model.opened, model.fitWidthPx, edit));
}

// -- text formatting (A1e text-edits.ts) ----------------------------------

/** set_font -> buildTextOps.setFont (text-ops.ts:233). */
export function setFontGesture(model: WaveGestureModel, edit: Extract<TextEdit, { op: "set_font" }>): void {
  model.runBuiltTxn(buildTextOps(model.opened, model.fitWidthPx, edit));
}

/** set_paragraph_format -> buildTextOps.setParagraphFormat (text-ops.ts:277). */
export function setParagraphFormatGesture(
  model: WaveGestureModel,
  edit: Extract<TextEdit, { op: "set_paragraph_format" }>,
): void {
  model.runBuiltTxn(buildTextOps(model.opened, model.fitWidthPx, edit));
}

// -- format + arrange (A4e format-edits.ts) --------------------------------

/** set_fill -> buildFormatOps.setFill (core-ops.ts:49). */
export function setFillGesture(model: WaveGestureModel, edit: Extract<FormatEdit, { op: "set_fill" }>): void {
  model.runBuiltTxn(buildFormatOps(model.opened, model.fitWidthPx, edit));
}

/** set_stroke -> buildFormatOps.setStroke (core-ops.ts:95). */
export function setStrokeGesture(model: WaveGestureModel, edit: Extract<FormatEdit, { op: "set_stroke" }>): void {
  model.runBuiltTxn(buildFormatOps(model.opened, model.fitWidthPx, edit));
}

/** set_effects -> buildFormatOps.setEffects (element-ops.ts:532). */
export function setEffectsGesture(model: WaveGestureModel, edit: Extract<FormatEdit, { op: "set_effects" }>): void {
  model.runBuiltTxn(buildFormatOps(model.opened, model.fitWidthPx, edit));
}

/** set_shape_geometry -> buildFormatOps.setShapeGeometry (element-ops.ts:411). */
export function setShapeGeometryGesture(
  model: WaveGestureModel,
  edit: Extract<FormatEdit, { op: "set_shape_geometry" }>,
): void {
  model.runBuiltTxn(buildFormatOps(model.opened, model.fitWidthPx, edit));
}

/** set_shape_adjust -> buildFormatOps.setShapeAdjust (element-ops.ts:444). */
export function setShapeAdjustGesture(
  model: WaveGestureModel,
  edit: Extract<FormatEdit, { op: "set_shape_adjust" }>,
): void {
  model.runBuiltTxn(buildFormatOps(model.opened, model.fitWidthPx, edit));
}

/** ungroup_element -> buildFormatOps.ungroupElement (element-ops.ts:396). */
export function ungroupElementGesture(
  model: WaveGestureModel,
  edit: Extract<FormatEdit, { op: "ungroup_element" }>,
): void {
  model.runBuiltTxn(buildFormatOps(model.opened, model.fitWidthPx, edit));
}

/** group_elements -> buildFormatOps.groupElements (element-ops.ts:376). The
 * vendored apply mints a group and records it (created:[groupId], :391), so
 * surface createdId like the table/chart/media create kinds. */
export function groupElementsGesture(
  model: WaveGestureModel,
  edit: Extract<FormatEdit, { op: "group_elements" }>,
): { applied: true; createdId: string } {
  const result = model.runBuiltTxn(buildFormatOps(model.opened, model.fitWidthPx, edit));
  return { applied: true, createdId: requireCreated(result.records, "groupElements") };
}

/** flip_elements -> buildFormatOps.flipElements (element-ops.ts:228). */
export function flipElementsGesture(
  model: WaveGestureModel,
  edit: Extract<FormatEdit, { op: "flip_elements" }>,
): void {
  model.runBuiltTxn(buildFormatOps(model.opened, model.fitWidthPx, edit));
}

/** set_text_anchor -> buildFormatOps.setTextAnchor (element-ops.ts:487). */
export function setTextAnchorGesture(
  model: WaveGestureModel,
  edit: Extract<FormatEdit, { op: "set_text_anchor" }>,
): void {
  model.runBuiltTxn(buildFormatOps(model.opened, model.fitWidthPx, edit));
}

/** set_text_body_props -> buildFormatOps.setTextBodyProps (element-ops.ts:504). */
export function setTextBodyPropsGesture(
  model: WaveGestureModel,
  edit: Extract<FormatEdit, { op: "set_text_body_props" }>,
): void {
  model.runBuiltTxn(buildFormatOps(model.opened, model.fitWidthPx, edit));
}

/** align_elements -> buildFormatOps.alignElements (arrange-ops.ts:110). */
export function alignElementsGesture(
  model: WaveGestureModel,
  edit: Extract<FormatEdit, { op: "align_elements" }>,
): void {
  model.runBuiltTxn(buildFormatOps(model.opened, model.fitWidthPx, edit));
}

/** distribute_elements -> buildFormatOps.distributeElements (arrange-ops.ts:135). */
export function distributeElementsGesture(
  model: WaveGestureModel,
  edit: Extract<FormatEdit, { op: "distribute_elements" }>,
): void {
  model.runBuiltTxn(buildFormatOps(model.opened, model.fitWidthPx, edit));
}

// -- speaker notes + comments (A5e notes-comment-edits.ts) -----------------

/** set_notes -> buildNotesCommentOps.setNotes (slide-ops.ts:664). */
export function setNotesGesture(model: WaveGestureModel, edit: Extract<NotesCommentEdit, { op: "set_notes" }>): void {
  model.runBuiltTxn(buildNotesCommentOps(model.opened, model.fitWidthPx, edit));
}

/** add_comment -> buildNotesCommentOps.addComment (slide-ops.ts:679). */
export function addCommentGesture(
  model: WaveGestureModel,
  edit: Extract<NotesCommentEdit, { op: "add_comment" }>,
): void {
  model.runBuiltTxn(buildNotesCommentOps(model.opened, model.fitWidthPx, edit));
}

/** delete_comment -> buildNotesCommentOps.deleteComment (slide-ops.ts:700). */
export function deleteCommentGesture(
  model: WaveGestureModel,
  edit: Extract<NotesCommentEdit, { op: "delete_comment" }>,
): void {
  model.runBuiltTxn(buildNotesCommentOps(model.opened, model.fitWidthPx, edit));
}

// -- header/footer + insert slide (B7e headerfooter-edits.ts) --------------

/** apply_header_footer -> buildHeaderFooterOps.applyHeaderFooter (slide-ops.ts:605). Deck-level. */
export function applyHeaderFooterGesture(
  model: WaveGestureModel,
  edit: Extract<HeaderFooterEdit, { op: "apply_header_footer" }>,
): void {
  model.runBuiltTxn(buildHeaderFooterOps(model.opened, model.fitWidthPx, edit));
}

/** insert_slide_pptx -> buildHeaderFooterOps.insertSlidePptx (slide-ops.ts:228). */
export function insertSlidePptxGesture(
  model: WaveGestureModel,
  edit: Extract<HeaderFooterEdit, { op: "insert_slide_pptx" }>,
): { applied: true; createdId?: string } {
  const result = model.runBuiltTxn(buildHeaderFooterOps(model.opened, model.fitWidthPx, edit));
  const created = createdIds(result.records);
  return { applied: true, ...(created.length ? { createdId: created[0] } : {}) };
}

// -- media + SmartArt (B8e media-edits.ts) --------------------------------

/** add_media -> buildMediaOps.addMedia (insert-ops.ts:286): px rect -> EMU. */
export function addMediaGesture(
  model: WaveGestureModel,
  edit: Extract<MediaEdit, { op: "add_media" }>,
): { applied: true; createdId: string } {
  const result = model.runBuiltTxn(buildMediaOps(model.opened, model.fitWidthPx, edit));
  return { applied: true, createdId: requireCreated(result.records, "addMedia") };
}

/** add_smartart -> buildMediaOps.addSmartArt (insert-ops.ts:264): px rect -> EMU. */
export function addSmartArtGesture(
  model: WaveGestureModel,
  edit: Extract<MediaEdit, { op: "add_smartart" }>,
): { applied: true; createdId: string } {
  const result = model.runBuiltTxn(buildMediaOps(model.opened, model.fitWidthPx, edit));
  return { applied: true, createdId: requireCreated(result.records, "addSmartArt") };
}

/** add_model3d -> buildMediaOps.addModel3d (insert-ops.ts:324): px rect -> EMU. */
export function addModel3dGesture(
  model: WaveGestureModel,
  edit: Extract<MediaEdit, { op: "add_model3d" }>,
): { applied: true; createdId: string } {
  const result = model.runBuiltTxn(buildMediaOps(model.opened, model.fitWidthPx, edit));
  return { applied: true, createdId: requireCreated(result.records, "addModel3d") };
}
