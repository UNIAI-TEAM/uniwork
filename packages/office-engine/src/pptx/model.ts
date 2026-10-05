// PPTX session model — one opened deck mutated only through the runTxn seam.
//
// Ported from the proven G0 host facade (e2e/office-g0/engine-pptx.mts):
// every gesture becomes a real registry op ({op, target:{slide, el}}),
// geometry converts px→EMU with the same viewport scale the slides main
// process uses, and a transaction must report applied with zero failures
// before anything counts as an edit — the deck is never partially mutated.
import {
  PptxEngineError,
  type OpenedPptxLike,
  type PptxElementLike,
  type PptxOp,
  type PptxOpRecord,
  type PptxOpsFunctions,
  type PptxParagraphLike,
  type PptxTxnResult,
} from "./engine";
import type { AnimationEdit } from "./edits/animation-edits";
import type { ChartEdit } from "./edits/chart-edits";
import type { FindLinkEdit } from "./edits/find-link-edits";
import type { FormatEdit } from "./edits/format-edits";
import type { HeaderFooterEdit } from "./edits/headerfooter-edits";
import type { MediaEdit } from "./edits/media-edits";
import type { NotesCommentEdit } from "./edits/notes-comment-edits";
import type { SectionEdit } from "./edits/section-edits";
import type { TableEdit } from "./edits/table-edits";
import type { TextEdit } from "./edits/text-edits";
import type { ThemeEdit } from "./edits/theme-edits";
import type { TransitionEdit } from "./edits/transition-edits";
import {
  addAnimationGesture,
  addChartGesture,
  addCommentGesture,
  addMediaGesture,
  addModel3dGesture,
  addSectionGesture,
  addSmartArtGesture,
  addTableGesture,
  alignElementsGesture,
  applyHeaderFooterGesture,
  applyThemeGesture,
  deleteCommentGesture,
  distributeElementsGesture,
  findReplaceGesture,
  flipElementsGesture,
  groupElementsGesture,
  insertSlidePptxGesture,
  moveSectionGesture,
  removeAnimationGesture,
  removeSectionGesture,
  renameSectionGesture,
  reorderAnimationGesture,
  setAdvanceTimeGesture,
  setAnimationsGesture,
  setBackgroundGesture,
  setChartGesture,
  setEffectsGesture,
  setFillGesture,
  setFontGesture,
  setLinkGesture,
  setNotesGesture,
  setParagraphFormatGesture,
  setSectionsGesture,
  setShapeAdjustGesture,
  setShapeGeometryGesture,
  setSlideLayoutGesture,
  setSlideSizeGesture,
  setStrokeGesture,
  setTableCellAnchorGesture,
  setTableCellGesture,
  setTableColWidthGesture,
  setTableRowHeightGesture,
  setTableStyleGesture,
  setTextAnchorGesture,
  setTextBodyPropsGesture,
  setTransitionGesture,
  tableMergeGesture,
  tableStructureGesture,
  ungroupElementGesture,
} from "./wave-ab-gestures";

export const EMU_PER_PX_96 = 9525;
const DEFAULT_FIT_WIDTH_PX = 960;

/** Plain text of an element, from the engine's own parsed run model. */
export function elementText(element: PptxElementLike | undefined): string {
  const paragraphs = element?.text?.paragraphs ?? [];
  return paragraphs.map((p) => (p.runs ?? []).map((r) => r.text ?? "").join("")).join("\n");
}

/** A text-bearing element is a shape or a text element per the engine model. */
export function findTextElement(
  opened: OpenedPptxLike,
  slideIndex: number,
  elementId?: string,
): PptxElementLike | undefined {
  const slide = opened.deck.slides[slideIndex];
  if (!slide) return undefined;
  const candidates = slide.elements.filter((e) => e.type === "text" || e.type === "shape");
  if (elementId !== undefined) return candidates.find((e) => e.id === elementId);
  return candidates[0];
}

/** Pixel -> EMU at the deck's current viewport scale (identical to slides-main
 * and the G0 host: baseWidth = size.cx / 9525 px at 96 DPI, scaled to the
 * renderer's fitWidth). */
export function makePxToEmu(opened: OpenedPptxLike, fitWidthPx: number): (px: number) => number {
  const width = opened.deck.size?.cx;
  if (typeof width !== "number" || width <= 0) {
    throw new PptxEngineError("deck_size_missing", "opened deck has no slide size to scale from");
  }
  if (!Number.isFinite(fitWidthPx) || fitWidthPx <= 0) {
    throw new PptxEngineError("bad_fit_width", "fitWidthPx must be a positive number");
  }
  const baseWidthPx = width / EMU_PER_PX_96;
  const scale = fitWidthPx / baseWidthPx;
  return (px) => Math.round((px / scale) * EMU_PER_PX_96);
}

const requirePositive = (value: number, field: string): number => {
  if (!Number.isFinite(value) || value < 0) {
    throw new PptxEngineError("bad_geometry", field + " must be a finite number >= 0");
  }
  return value;
};

const checkParagraphs = (paragraphs: PptxParagraphLike[]): void => {
  if (!Array.isArray(paragraphs) || paragraphs.length === 0) {
    throw new PptxEngineError("empty_paragraphs", "setText needs at least one paragraph");
  }
  for (const paragraph of paragraphs) {
    if (!Array.isArray(paragraph.runs) || paragraph.runs.length === 0) {
      throw new PptxEngineError("bad_runs", "every paragraph needs at least one run");
    }
    if (paragraph.runs.some((run) => typeof run.text !== "string")) {
      throw new PptxEngineError("bad_runs", "every run needs string text");
    }
  }
};

export type PptxEdit =
  | { op: "edit_text"; slideIndex: number; elementId?: string; paragraphs: PptxParagraphLike[]; groupId?: string }
  | { op: "edit_transform"; slideIndex: number; elementId: string; xPx: number; yPx: number; wPx: number; hPx: number; rotationDeg?: number; fitWidthPx?: number; groupId?: string }
  | { op: "add_element"; slideIndex: number; kind: string; xPx: number; yPx: number; wPx: number; hPx: number; fitWidthPx?: number; paragraphs?: PptxParagraphLike[]; fillColor?: string; stroke?: { color: string; widthPt: number } }
  | { op: "add_image"; slideIndex: number; bytes: Uint8Array; ext: string; xPx: number; yPx: number; wPx: number; hPx: number; fitWidthPx?: number; name?: string; descr?: string }
  | { op: "replace_picture"; slideIndex: number; elementId: string; bytes: Uint8Array; ext: string; keepSrcRect?: boolean }
  | { op: "move_slide"; slideIndex: number; toIndex: number }
  | { op: "reorder_element"; slideIndex: number; elementId: string; dir: "front" | "back" | "forward" | "backward" }
  | { op: "set_slide_hidden"; slideIndex: number; hidden: boolean }
  | { op: "duplicate_slide"; slideIndex: number; clearText?: boolean }
  | { op: "delete_slide"; slideIndex: number }
  | { op: "add_blank_slide"; slideIndex: number }
  | { op: "add_slide_with_layout"; slideIndex?: number; layout: string | number }
  | { op: "delete_element"; slideIndex: number; elementId: string }
  | ThemeEdit
  | TableEdit
  | ChartEdit
  | TransitionEdit
  | FindLinkEdit
  | SectionEdit
  | AnimationEdit
  | TextEdit
  | FormatEdit
  | NotesCommentEdit
  | HeaderFooterEdit
  | MediaEdit;

/** One open deck, mutated only via runTxn — the same object openPptx produced
 * and savePptx will serialize (one engine instance, one model). */
export class PptxSessionModel {
  opened: OpenedPptxLike;
  fitWidthPx: number;
  dirty = false;
  /** Applied op journal — the audit trail of model-bound edits. */
  readonly journal: PptxOpRecord[] = [];
  /** Applied edit counter — two-save chains prove the base advanced. */
  revision = 0;

  constructor(opened: OpenedPptxLike, private ops: PptxOpsFunctions, fitWidthPx = DEFAULT_FIT_WIDTH_PX) {
    this.opened = opened;
    this.fitWidthPx = fitWidthPx;
  }

  get slides(): PptxSessionModel["opened"]["deck"]["slides"] {
    return this.opened.deck.slides;
  }

  private requireSlide(slideIndex: number) {
    const slide = this.opened.deck.slides[slideIndex];
    if (!slide) throw new PptxEngineError("no_slide", "no slide " + slideIndex);
    return slide;
  }

  /** One transaction: dry-run plan first, then exactly one live apply.
   * Refuse on any plan or apply failure — ported from the G0 host (the
   * executor's dryRun reports applied:false + plan; anything else is a
   * protocol surprise we refuse). */
  private txn(ops: PptxOp[]): PptxTxnResult {
    if (ops.length === 0) {
      throw new PptxEngineError("empty_ops", "a transaction needs at least one op");
    }
    const dry = this.ops.runTxn(this.opened, { dryRun: true, ops });
    if (dry.dryRun !== true || (dry.failures?.length ?? 0) > 0) {
      throw new PptxEngineError(
        "dry_run_failed",
        "op dry run failed: " + JSON.stringify(dry.failures ?? dry.plan ?? []),
      );
    }
    const result = this.ops.runTxn(this.opened, { ops });
    if (!result.applied) throw new PptxEngineError("txn_not_applied", "runTxn reported applied=false");
    if ((result.failures?.length ?? 0) > 0) {
      throw new PptxEngineError("txn_failures", "runTxn reported failures: " + JSON.stringify(result.failures));
    }
    this.journal.push(...(result.records ?? []));
    this.dirty = true;
    this.revision += 1;
    return result;
  }

  private static createdIds(records: PptxOpRecord[] | undefined): string[] {
    return (records ?? []).flatMap((r) => r.created ?? []);
  }

  /** setText — element ops/registry.ts (text-ops.ts:138): target{slide,el},
   * paragraphs EditParagraph[], optional group child targeting. */
  editText(input: { slideIndex: number; elementId?: string; paragraphs: PptxParagraphLike[]; groupId?: string }): {
    applied: true;
    targetId: string;
    targetType: string;
  } {
    checkParagraphs(input.paragraphs);
    const target = findTextElement(this.opened, input.slideIndex, input.elementId);
    if (!target) {
      throw new PptxEngineError(
        "no_text_target",
        "slide " + input.slideIndex + " has no " + (input.elementId ? "element " + input.elementId : "text/shape element"),
      );
    }
    this.txn([
      {
        op: "setText",
        target: { slide: input.slideIndex, el: target.id },
        paragraphs: input.paragraphs,
        ...(input.groupId === undefined ? {} : { group: input.groupId }),
      },
    ]);
    return { applied: true, targetId: target.id, targetType: target.type };
  }

  /** setTransform — the host:slides-edit-transform gesture (element-ops.ts:80):
   * pixel geometry -> EMU box {x,y,cx,cy} + rotDeg, optional group child. */
  editTransform(input: {
    slideIndex: number;
    elementId: string;
    xPx: number;
    yPx: number;
    wPx: number;
    hPx: number;
    rotationDeg?: number;
    fitWidthPx?: number;
    groupId?: string;
  }): { applied: true; targetId: string; targetType: string } {
    const slide = this.requireSlide(input.slideIndex);
    const element = slide.elements.find((el) => el.id === input.elementId);
    if (!element) {
      throw new PptxEngineError("no_element", "no element " + input.elementId + " on slide " + input.slideIndex);
    }
    const toEmu = makePxToEmu(this.opened, input.fitWidthPx ?? this.fitWidthPx);
    this.txn([
      {
        op: "setTransform",
        target: { slide: input.slideIndex, el: input.elementId },
        box: {
          x: toEmu(requirePositive(input.xPx, "xPx")),
          y: toEmu(requirePositive(input.yPx, "yPx")),
          cx: Math.max(1, toEmu(requirePositive(input.wPx, "wPx"))),
          cy: Math.max(1, toEmu(requirePositive(input.hPx, "hPx"))),
        },
        rotDeg: input.rotationDeg ?? 0,
        ...(input.groupId === undefined ? {} : { group: input.groupId }),
      },
    ]);
    return { applied: true, targetId: input.elementId, targetType: element.type };
  }

  /** addElement — textbox/preset shape/line (insert-ops.ts:68): kind +
   * EMU offset rect, optional paragraphs/fill/stroke/bodyPr/adjustments. */
  addElement(input: {
    slideIndex: number;
    kind: string;
    xPx: number;
    yPx: number;
    wPx: number;
    hPx: number;
    fitWidthPx?: number;
    paragraphs?: PptxParagraphLike[];
    fillColor?: string;
    stroke?: { color: string; widthPt: number };
  }): { applied: true; createdId: string } {
    this.requireSlide(input.slideIndex);
    const toEmu = makePxToEmu(this.opened, input.fitWidthPx ?? this.fitWidthPx);
    const result = this.txn([
      {
        op: "addElement",
        target: { slide: input.slideIndex },
        kind: input.kind,
        offset: {
          x: toEmu(requirePositive(input.xPx, "xPx")),
          y: toEmu(requirePositive(input.yPx, "yPx")),
          cx: Math.max(1, toEmu(requirePositive(input.wPx, "wPx"))),
          cy: Math.max(1, toEmu(requirePositive(input.hPx, "hPx"))),
        },
        ...(input.paragraphs?.length ? { paragraphs: input.paragraphs } : {}),
        ...(input.fillColor ? { fill: input.fillColor } : {}),
        // The vendored buildSpXml reads stroke.widthEmu; the typed edit speaks pt.
        ...(input.stroke ? { stroke: { color: input.stroke.color, widthEmu: Math.round(input.stroke.widthPt * 12700) } } : {}),
      },
    ]);
    const created = PptxSessionModel.createdIds(result.records);
    if (created.length === 0) {
      throw new PptxEngineError("no_created_element", "addElement reported no created element id");
    }
    return { applied: true, createdId: created[0] as string };
  }

  /** addPicture — insert-ops.ts:114: bytes + ext + EMU offset rect. */
  addImage(input: {
    slideIndex: number;
    bytes: Uint8Array;
    ext: string;
    xPx: number;
    yPx: number;
    wPx: number;
    hPx: number;
    fitWidthPx?: number;
    name?: string;
    descr?: string;
  }): { applied: true; createdId: string } {
    this.requireSlide(input.slideIndex);
    const toEmu = makePxToEmu(this.opened, input.fitWidthPx ?? this.fitWidthPx);
    const result = this.txn([
      {
        op: "addPicture",
        target: { slide: input.slideIndex },
        bytes: input.bytes,
        ext: input.ext,
        offset: {
          x: toEmu(requirePositive(input.xPx, "xPx")),
          y: toEmu(requirePositive(input.yPx, "yPx")),
          cx: Math.max(1, toEmu(requirePositive(input.wPx, "wPx"))),
          cy: Math.max(1, toEmu(requirePositive(input.hPx, "hPx"))),
        },
        ...(input.name ? { name: input.name } : {}),
        ...(input.descr ? { descr: input.descr } : {}),
      },
    ]);
    const created = PptxSessionModel.createdIds(result.records);
    if (created.length === 0) {
      throw new PptxEngineError("unsupported_image", "addPicture reported no created element");
    }
    return { applied: true, createdId: created[0] as string };
  }

  /** replacePicture — insert-ops.ts:144: target element + bytes + ext. */
  replacePicture(input: {
    slideIndex: number;
    elementId: string;
    bytes: Uint8Array;
    ext: string;
    keepSrcRect?: boolean;
  }): { applied: true; targetId: string } {
    this.requireSlide(input.slideIndex);
    this.txn([
      {
        op: "replacePicture",
        target: { slide: input.slideIndex, el: input.elementId },
        bytes: input.bytes,
        ext: input.ext,
        ...(input.keepSrcRect === true ? { keepSrcRect: true } : {}),
      },
    ]);
    return { applied: true, targetId: input.elementId };
  }

  /** Ordering + slide-structure ops (slide-ops.ts / element-ops.ts:358). */
  moveSlide(slideIndex: number, toIndex: number): void {
    this.txn([{ op: "moveSlide", target: { slide: slideIndex }, to: toIndex }]);
  }

  reorderElement(slideIndex: number, elementId: string, dir: "front" | "back" | "forward" | "backward"): void {
    this.txn([{ op: "reorderElement", target: { slide: slideIndex, el: elementId }, dir }]);
  }

  setSlideHidden(slideIndex: number, hidden: boolean): void {
    this.txn([{ op: "setHidden", target: { slide: slideIndex }, hidden }]);
  }

  duplicateSlide(slideIndex: number, clearText?: boolean): void {
    this.txn([{ op: "duplicateSlide", target: { slide: slideIndex }, ...(clearText ? { clearText } : {}) }]);
  }

  deleteSlide(slideIndex: number): void {
    this.txn([{ op: "deleteSlide", target: { slide: slideIndex } }]);
  }

  addBlankSlide(slideIndex: number): void {
    this.txn([{ op: "addBlankSlide", target: { slide: slideIndex } }]);
  }

  addSlideWithLayout(layout: string | number, slideIndex?: number): void {
    this.txn([
      {
        op: "addSlideWithLayout",
        ...(slideIndex !== undefined ? { target: { slide: slideIndex } } : {}),
        layout,
      },
    ]);
  }

  deleteElement(slideIndex: number, elementId: string): void {
    this.txn([{ op: "deleteElement", target: { slide: slideIndex, el: elementId } }]);
  }

  /** One transaction for the extracted wave-A/B gestures (wave-ab-gestures.ts):
   * the same dry-run plan + atomic apply + journal seam the built-in gestures
   * use. Validation and px->EMU stay in the builders, never here. */
  runBuiltTxn(ops: PptxOp[]): PptxTxnResult {
    return this.txn(ops);
  }

  /** Typed dispatch so the adapter's edit channel stays a single entry.
   * The kind → handler table is PPTX_EDIT_REGISTRY below (the B1..B8
   * extension point); an unregistered kind is refused, never ignored. */
  applyEdit(edit: PptxEdit): PptxEditResult {
    const handler = PPTX_EDIT_REGISTRY[edit.op] as PptxEditHandler | undefined;
    if (typeof handler !== "function") {
      throw new PptxEngineError("unsupported_edit", "no handler is registered for edit kind " + String(edit.op));
    }
    return handler(this, edit);
  }

  /** Called by the adapter after a successful save — upstream commitSaved
   * semantics live on the engine handle; the model only clears its dirty
   * flag (the journal stays — it is the audit trail, not save state). */
  markSaved(): void {
    this.dirty = false;
  }
}

/** Result of one applied edit; createdId/targetId let the host track selection. */
interface PptxEditResult {
  applied: true;
  createdId?: string;
  targetId?: string;
  /** tableMerge/tableStructure only: the surviving element id (after.elementId). */
  elementId?: string;
}

/** One edit kind → one handler. `Extract` keeps every entry tied to its own
 * union member, so a handler cannot read another kind's fields. */
type PptxEditHandlerFor<K extends PptxEdit["op"]> = (
  model: PptxSessionModel,
  edit: Extract<PptxEdit, { op: K }>,
) => PptxEditResult;

/** Handler as called from the registry lookup (kind already matched by the
 * record index; TypeScript cannot correlate a union-valued index, so callers
 * cast the single selected entry). */
type PptxEditHandler = (model: PptxSessionModel, edit: PptxEdit) => PptxEditResult;

/**
 * EDIT-KIND REGISTRY — the extension point for the B1..B8 richer-edit tasks.
 *
 * The mapped type makes the union and the table agree: adding a kind to the
 * `PptxEdit` union without registering it here is a compile error, so the
 * model can never advertise an edit it does not apply.
 *
 * Wave A/B logic kinds are registered here: design (apply_theme,
 * set_slide_size, set_background, set_slide_layout), tables (add_table,
 * set_table_cell, table_merge, table_structure, set_table_row_height,
 * set_table_col_width, set_table_cell_anchor, set_table_style), charts
 * (add_chart, set_chart), transitions (set_transition, set_advance_time),
 * find/link (find_replace, set_link) and sections (add_section,
 * rename_section, remove_section, move_section, set_sections).
 * Animation (add_animation, remove_animation, reorder_animation,
 * set_animations) and text formatting (set_font, set_paragraph_format) are
 * registered alongside them.
 * The A4e format/arrange kinds (set_fill, set_stroke, set_effects,
 * set_shape_geometry, set_shape_adjust, ungroup_element, group_elements,
 * flip_elements, set_text_anchor, set_text_body_props, align_elements,
 * distribute_elements), the A5e notes/comment kinds (set_notes, add_comment,
 * delete_comment), the B7e header/footer kinds (apply_header_footer,
 * insert_slide_pptx) and the B8e media kinds (add_media, add_smartart,
 * add_model3d) are registered the same way.
 *
 * To add a kind:
 *   1. add its shape to the `PptxEdit` union above;
 *   2. register one entry here whose handler calls a gesture method that
 *      builds the vendored pptx-ops op and runs through `txn()` (dry-run plan
 *      + atomic apply) — validation and px→EMU conversion stay in the gesture,
 *      never in the table;
 *   3. map the op onto its inverse for undo (the B track owns undo/redo) and
 *      cover it with the edit → save → reopen round-trip test.
 */
const PPTX_EDIT_REGISTRY: { [K in PptxEdit["op"]]: PptxEditHandlerFor<K> } = {
  edit_text: (model, edit) => model.editText(edit),
  edit_transform: (model, edit) => model.editTransform(edit),
  add_element: (model, edit) => model.addElement(edit),
  add_image: (model, edit) => model.addImage(edit),
  replace_picture: (model, edit) => model.replacePicture(edit),
  move_slide: (model, edit) => { model.moveSlide(edit.slideIndex, edit.toIndex); return { applied: true }; },
  reorder_element: (model, edit) => { model.reorderElement(edit.slideIndex, edit.elementId, edit.dir); return { applied: true }; },
  set_slide_hidden: (model, edit) => { model.setSlideHidden(edit.slideIndex, edit.hidden); return { applied: true }; },
  duplicate_slide: (model, edit) => { model.duplicateSlide(edit.slideIndex, edit.clearText); return { applied: true }; },
  delete_slide: (model, edit) => { model.deleteSlide(edit.slideIndex); return { applied: true }; },
  add_blank_slide: (model, edit) => { model.addBlankSlide(edit.slideIndex); return { applied: true }; },
  add_slide_with_layout: (model, edit) => { model.addSlideWithLayout(edit.layout, edit.slideIndex); return { applied: true }; },
  delete_element: (model, edit) => { model.deleteElement(edit.slideIndex, edit.elementId); return { applied: true }; },
  // Wave A/B logic kinds (UNI-927): design, tables, charts, transitions,
  // find/link, sections. Each handler is the mechanical txn(build<Area>Ops)
  // gesture; validation and px->EMU stay in the builders.
  apply_theme: (model, edit) => { applyThemeGesture(model, edit); return { applied: true }; },
  set_slide_size: (model, edit) => { setSlideSizeGesture(model, edit); return { applied: true }; },
  set_background: (model, edit) => { setBackgroundGesture(model, edit); return { applied: true }; },
  set_slide_layout: (model, edit) => { setSlideLayoutGesture(model, edit); return { applied: true }; },
  add_table: (model, edit) => addTableGesture(model, edit),
  set_table_cell: (model, edit) => { setTableCellGesture(model, edit); return { applied: true }; },
  table_merge: (model, edit) => tableMergeGesture(model, edit),
  table_structure: (model, edit) => tableStructureGesture(model, edit),
  set_table_row_height: (model, edit) => { setTableRowHeightGesture(model, edit); return { applied: true }; },
  set_table_col_width: (model, edit) => { setTableColWidthGesture(model, edit); return { applied: true }; },
  set_table_cell_anchor: (model, edit) => { setTableCellAnchorGesture(model, edit); return { applied: true }; },
  set_table_style: (model, edit) => { setTableStyleGesture(model, edit); return { applied: true }; },
  add_chart: (model, edit) => addChartGesture(model, edit),
  set_chart: (model, edit) => { setChartGesture(model, edit); return { applied: true }; },
  set_transition: (model, edit) => { setTransitionGesture(model, edit); return { applied: true }; },
  set_advance_time: (model, edit) => { setAdvanceTimeGesture(model, edit); return { applied: true }; },
  find_replace: (model, edit) => { findReplaceGesture(model, edit); return { applied: true }; },
  set_link: (model, edit) => { setLinkGesture(model, edit); return { applied: true }; },
  add_section: (model, edit) => { addSectionGesture(model, edit); return { applied: true }; },
  rename_section: (model, edit) => { renameSectionGesture(model, edit); return { applied: true }; },
  remove_section: (model, edit) => { removeSectionGesture(model, edit); return { applied: true }; },
  move_section: (model, edit) => { moveSectionGesture(model, edit); return { applied: true }; },
  set_sections: (model, edit) => { setSectionsGesture(model, edit); return { applied: true }; },
  // Animation (B5e) + text formatting (A1e) kinds: same mechanical
  // txn(build<Area>Ops) gesture; validation/px->EMU stay in the builders.
  add_animation: (model, edit) => { addAnimationGesture(model, edit); return { applied: true }; },
  remove_animation: (model, edit) => { removeAnimationGesture(model, edit); return { applied: true }; },
  reorder_animation: (model, edit) => { reorderAnimationGesture(model, edit); return { applied: true }; },
  set_animations: (model, edit) => { setAnimationsGesture(model, edit); return { applied: true }; },
  set_font: (model, edit) => { setFontGesture(model, edit); return { applied: true }; },
  set_paragraph_format: (model, edit) => { setParagraphFormatGesture(model, edit); return { applied: true }; },
  // Format/arrange (A4e), notes/comments (A5e), header/footer (B7e) and
  // media (B8e) kinds: same mechanical txn(build<Area>Ops) gesture;
  // validation/px->EMU stay in the builders.
  set_fill: (model, edit) => { setFillGesture(model, edit); return { applied: true }; },
  set_stroke: (model, edit) => { setStrokeGesture(model, edit); return { applied: true }; },
  set_effects: (model, edit) => { setEffectsGesture(model, edit); return { applied: true }; },
  set_shape_geometry: (model, edit) => { setShapeGeometryGesture(model, edit); return { applied: true }; },
  set_shape_adjust: (model, edit) => { setShapeAdjustGesture(model, edit); return { applied: true }; },
  ungroup_element: (model, edit) => { ungroupElementGesture(model, edit); return { applied: true }; },
  group_elements: (model, edit) => { groupElementsGesture(model, edit); return { applied: true }; },
  flip_elements: (model, edit) => { flipElementsGesture(model, edit); return { applied: true }; },
  set_text_anchor: (model, edit) => { setTextAnchorGesture(model, edit); return { applied: true }; },
  set_text_body_props: (model, edit) => { setTextBodyPropsGesture(model, edit); return { applied: true }; },
  align_elements: (model, edit) => { alignElementsGesture(model, edit); return { applied: true }; },
  distribute_elements: (model, edit) => { distributeElementsGesture(model, edit); return { applied: true }; },
  set_notes: (model, edit) => { setNotesGesture(model, edit); return { applied: true }; },
  add_comment: (model, edit) => { addCommentGesture(model, edit); return { applied: true }; },
  delete_comment: (model, edit) => { deleteCommentGesture(model, edit); return { applied: true }; },
  apply_header_footer: (model, edit) => { applyHeaderFooterGesture(model, edit); return { applied: true }; },
  insert_slide_pptx: (model, edit) => insertSlidePptxGesture(model, edit),
  add_media: (model, edit) => addMediaGesture(model, edit),
  add_smartart: (model, edit) => addSmartArtGesture(model, edit),
  add_model3d: (model, edit) => addModel3dGesture(model, edit),
};

/** Registered edit kinds, in registry order — the surface the B track extends. */
export function pptxEditKinds(): PptxEdit["op"][] {
  return Object.keys(PPTX_EDIT_REGISTRY) as PptxEdit["op"][];
}
