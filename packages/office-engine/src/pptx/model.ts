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
  | { op: "delete_element"; slideIndex: number; elementId: string };

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
        ...(input.stroke ? { stroke: input.stroke } : {}),
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

  /** Typed dispatch so the adapter's edit channel stays a single entry. */
  applyEdit(edit: PptxEdit): { applied: true; createdId?: string; targetId?: string } {
    switch (edit.op) {
      case "edit_text":
        return this.editText(edit);
      case "edit_transform":
        return this.editTransform(edit);
      case "add_element":
        return this.addElement(edit);
      case "add_image":
        return this.addImage(edit);
      case "replace_picture":
        return this.replacePicture(edit);
      case "move_slide":
        this.moveSlide(edit.slideIndex, edit.toIndex);
        return { applied: true };
      case "reorder_element":
        this.reorderElement(edit.slideIndex, edit.elementId, edit.dir);
        return { applied: true };
      case "set_slide_hidden":
        this.setSlideHidden(edit.slideIndex, edit.hidden);
        return { applied: true };
      case "duplicate_slide":
        this.duplicateSlide(edit.slideIndex, edit.clearText);
        return { applied: true };
      case "delete_slide":
        this.deleteSlide(edit.slideIndex);
        return { applied: true };
      case "add_blank_slide":
        this.addBlankSlide(edit.slideIndex);
        return { applied: true };
      case "add_slide_with_layout":
        this.addSlideWithLayout(edit.layout, edit.slideIndex);
        return { applied: true };
      case "delete_element":
        this.deleteElement(edit.slideIndex, edit.elementId);
        return { applied: true };
    }
  }

  /** Called by the adapter after a successful save — upstream commitSaved
   * semantics live on the engine handle; the model only clears its dirty
   * flag (the journal stays — it is the audit trail, not save state). */
  markSaved(): void {
    this.dirty = false;
  }
}
