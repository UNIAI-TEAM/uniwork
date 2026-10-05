// B5e (UNI-927) - animation edits (logic half): add/reorder/remove one effect
// plus whole-timeline replace, bound one-to-one to the vendored pptx-ops
// registry.
//
// The wire round registers `AnimationEdit` as `PptxEdit` kinds in model.ts and
// calls the builder mechanically:
//
//   this.txn(buildAnimationOps(this.opened, this.fitWidthPx, edit))
//
// Vendored contract (READ ONLY - never imported; cited for every field):
//   addAnimation      packages/pptx-ops/src/ops/animation-ops.ts:283
//                     (validate 285-289: resolveElement + buildAnimation +
//                     parseSeq 'after'; apply 290-305: append, or insert after
//                     a 0-based timeline position)
//   removeAnimation   packages/pptx-ops/src/ops/animation-ops.ts:307
//                     (validate 309-316: seq (0-based) OR target element;
//                     apply 317-337: drop by seq, or every effect of an element)
//   reorderAnimation  packages/pptx-ops/src/ops/animation-ops.ts:340
//                     (validate 342-346: resolveSlide + seq + to, both required
//                     0-based ints; apply 347-363: move seq -> to)
//   setAnimations     packages/pptx-ops/src/ops/slide-ops.ts:510
//                     (validate 512-539: items[] each {sourceId, effect in
//                     ANIM_EFFECTS, trigger in ANIM_TRIGGERS, durationMs/delayMs
//                     finite >= 0}; apply 540-577: replace the slide timeline)
//   effect aliases    packages/pptx-ops/src/ops/animation-ops.ts:86-102 (folded
//                     names like "fadein" map onto the canonical kinds)
//   trigger aliases   packages/pptx-ops/src/ops/animation-ops.ts:104-114
//   ms / seq guards   packages/pptx-ops/src/ops/animation-ops.ts:159-179
//   AnimTrigger       packages/pptx-engine/src/animation.ts:49
//   ANIM_TRIGGERS     packages/pptx-engine/src/animation.ts:54
//   ANIM_EFFECTS      packages/pptx-engine/src/animation.ts:145 (Object.keys of
//                     PRESET, animation.ts:118-142 - the 20 effect kinds below)
//
// Geometry-free - animations live in the slide's <p:timing>, never in an
// element rect - so no px->EMU conversion happens here; `fitWidthPx` stays in
// the signature only because every engine-half builder shares the same
// mechanical wire call.
import { PptxEngineError, type OpenedPptxLike, type PptxOp, type PptxSlideLike } from "../engine";

/** Accepted animation effects, copied verbatim from the vendored ANIM_EFFECTS
 * (animation.ts:145, the keys of PRESET at animation.ts:118-142). The unit test
 * parses the vendored source and fails with the diff when this literal drifts. */
export const PPTX_ANIM_EFFECTS = [
  "appear",
  "fade",
  "flyIn",
  "wipe",
  "wipeDown",
  "splitIn",
  "bounce",
  "flipIn",
  "zoom",
  "pulse",
  "spin",
  "grow",
  "teeter",
  "disappear",
  "fadeOut",
  "flyOut",
  "wipeOut",
  "shrink",
  "zoomOut",
  "motionPath",
] as const;
export type PptxAnimEffect = (typeof PPTX_ANIM_EFFECTS)[number];

/** Accepted animation triggers, copied verbatim from the vendored ANIM_TRIGGERS
 * (animation.ts:54). Pinned by the same unit test. */
export const PPTX_ANIM_TRIGGERS = ["onClick", "withPrev", "afterPrev"] as const;
export type PptxAnimTrigger = (typeof PPTX_ANIM_TRIGGERS)[number];

/** Side a fly/wipe effect comes from (entrance) or leaves towards (exit);
 * mirrors the vendored ANIM_DIRECTIONS (animation.ts:52). */
export const PPTX_ANIM_DIRECTIONS = ["top", "bottom", "left", "right"] as const;
export type PptxAnimDirection = (typeof PPTX_ANIM_DIRECTIONS)[number];

/** One per-item entry of a whole-timeline replace; mirrors the vendored
 * setAnimations item contract (slide-ops.ts:515-537). */
export interface PptxAnimationItem {
  sourceId: string;
  effect: PptxAnimEffect;
  trigger: PptxAnimTrigger;
  durationMs: number;
  delayMs: number;
  motionPath?: string;
  paragraph?: number;
  direction?: PptxAnimDirection;
  presetXml?: string;
}

/** The edit kinds this module builds (registered as PptxEdit kinds by the wire
 * round):
 *  - add_animation     -> vendored `addAnimation` (element target + effect);
 *  - remove_animation  -> vendored `removeAnimation` (by element, or by seq);
 *  - reorder_animation -> vendored `reorderAnimation` (seq + to, both required);
 *  - set_animations    -> vendored `setAnimations` (replace the whole timeline). */
export type AnimationEdit =
  | {
      op: "add_animation";
      slideIndex: number;
      elementId: string;
      /** Required unless `presetXml` carries the effect (animation-ops.ts:225-233). */
      effect?: PptxAnimEffect;
      trigger?: PptxAnimTrigger;
      durationMs?: number;
      delayMs?: number;
      /** Insert after this 0-based timeline position; omit to append. */
      after?: number;
      direction?: PptxAnimDirection;
      motionPath?: string;
      paragraph?: number;
      presetXml?: string;
    }
  | { op: "remove_animation"; slideIndex: number; elementId?: string; seq?: number }
  | { op: "reorder_animation"; slideIndex: number; seq: number; to: number }
  | { op: "set_animations"; slideIndex: number; items: PptxAnimationItem[] };

/** Slide-existence guard - anim_no_slide for a missing/non-integer index. */
const requireSlide = (opened: OpenedPptxLike, slideIndex: unknown, op: string): PptxSlideLike => {
  const slide =
    typeof slideIndex === "number" && Number.isInteger(slideIndex) && slideIndex >= 0
      ? opened.deck.slides[slideIndex]
      : undefined;
  if (!slide) {
    throw new PptxEngineError("anim_no_slide", op + ": slide index " + String(slideIndex) + " does not exist");
  }
  return slide;
};

/** Element-existence guard - anim_no_element for a missing id or a miss. */
const requireElement = (slide: PptxSlideLike, elementId: unknown, op: string, slideIndex: number): string => {
  if (typeof elementId !== "string" || elementId.length === 0) {
    throw new PptxEngineError("anim_no_element", op + ' needs "elementId": an element id on the slide');
  }
  if (!slide.elements.some((el) => el.id === elementId)) {
    throw new PptxEngineError(
      "anim_no_element",
      op + ': no element "' + elementId + '" on slide ' + String(slideIndex),
    );
  }
  return elementId;
};

const requireMs = (value: unknown, field: string, op: string): number => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new PptxEngineError(
      "anim_bad_ms",
      op + ' "' + field + '" must be a finite number of milliseconds >= 0',
    );
  }
  return value;
};

const requireTimelineIndex = (value: unknown, field: string, op: string): number => {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new PptxEngineError(
      "anim_bad_seq",
      op + ' "' + field + '" must be a 0-based integer timeline position',
    );
  }
  return value;
};

const requireEffect = (value: unknown, op: string): PptxAnimEffect => {
  if (!(PPTX_ANIM_EFFECTS as readonly unknown[]).includes(value)) {
    throw new PptxEngineError(
      "anim_bad_effect",
      op + ' "effect" must be one of ' + PPTX_ANIM_EFFECTS.join(", ") + ".",
    );
  }
  return value as PptxAnimEffect;
};

const requireTrigger = (value: unknown, op: string): PptxAnimTrigger => {
  if (!(PPTX_ANIM_TRIGGERS as readonly unknown[]).includes(value)) {
    throw new PptxEngineError(
      "anim_bad_trigger",
      op + ' "trigger" must be one of ' + PPTX_ANIM_TRIGGERS.join(", ") + ".",
    );
  }
  return value as PptxAnimTrigger;
};

const requireDirection = (value: unknown, op: string): PptxAnimDirection => {
  if (!(PPTX_ANIM_DIRECTIONS as readonly unknown[]).includes(value)) {
    throw new PptxEngineError(
      "anim_bad_direction",
      op + ' "direction" must be one of ' + PPTX_ANIM_DIRECTIONS.join(", ") + ".",
    );
  }
  return value as PptxAnimDirection;
};

const requireParagraph = (value: unknown, op: string): number => {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new PptxEngineError("anim_bad_paragraph", op + ' "paragraph" must be a 0-based paragraph index');
  }
  return value;
};

const requireMotionPath = (value: unknown, op: string): string => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new PptxEngineError(
      "anim_bad_motion_path",
      op + ' "motionPath" must be a non-empty SVG-like path (M/L/C/Z, coordinates 0..1)',
    );
  }
  return value;
};

/** One add_animation edit -> the vendored `addAnimation` op. `effect` or
 * `presetXml` is required (animation-ops.ts:225-233): the vendored op derives
 * the effect from presetXml and refuses when neither is present. */
function buildAddAnimation(slide: PptxSlideLike, edit: Extract<AnimationEdit, { op: "add_animation" }>): PptxOp {
  const elementId = requireElement(slide, edit.elementId, "add_animation", edit.slideIndex);
  if (edit.effect === undefined && typeof edit.presetXml !== "string") {
    throw new PptxEngineError(
      "anim_bad_effect",
      'add_animation needs "effect" (one of ' + PPTX_ANIM_EFFECTS.join(", ") + ') or "presetXml".',
    );
  }
  return {
    op: "addAnimation",
    target: { slide: edit.slideIndex, el: elementId },
    ...(edit.effect === undefined ? {} : { effect: requireEffect(edit.effect, "add_animation") }),
    ...(edit.trigger === undefined ? {} : { trigger: requireTrigger(edit.trigger, "add_animation") }),
    ...(edit.durationMs === undefined
      ? {}
      : { durationMs: requireMs(edit.durationMs, "durationMs", "add_animation") }),
    ...(edit.delayMs === undefined ? {} : { delayMs: requireMs(edit.delayMs, "delayMs", "add_animation") }),
    ...(edit.after === undefined ? {} : { after: requireTimelineIndex(edit.after, "after", "add_animation") }),
    ...(edit.direction === undefined
      ? {}
      : { direction: requireDirection(edit.direction, "add_animation") }),
    ...(edit.motionPath === undefined
      ? {}
      : { motionPath: requireMotionPath(edit.motionPath, "add_animation") }),
    ...(edit.paragraph === undefined
      ? {}
      : { paragraph: requireParagraph(edit.paragraph, "add_animation") }),
    ...(edit.presetXml === undefined ? {} : { presetXml: edit.presetXml }),
  };
}

/** One set_animations edit -> the vendored `setAnimations` op: every item is
 * validated up front (sourceId resolves, effect/trigger in the vendored lists,
 * ms finite >= 0), so the whole-replace op can never silently drop an item. */
function buildSetAnimations(
  slide: PptxSlideLike,
  edit: Extract<AnimationEdit, { op: "set_animations" }>,
): PptxOp {
  if (!Array.isArray(edit.items) || edit.items.length === 0) {
    throw new PptxEngineError("anim_bad_items", 'set_animations needs a non-empty "items" array');
  }
  const items = edit.items.map((raw, i) => {
    const where = "set_animations items[" + i + "]";
    if (raw === null || typeof raw !== "object") {
      throw new PptxEngineError("anim_bad_items", where + " must be an object");
    }
    const sourceId = requireElement(slide, raw.sourceId, where, edit.slideIndex);
    return {
      sourceId,
      effect: requireEffect(raw.effect, where),
      trigger: requireTrigger(raw.trigger, where),
      durationMs: requireMs(raw.durationMs, "durationMs", where),
      delayMs: requireMs(raw.delayMs, "delayMs", where),
      ...(raw.motionPath === undefined ? {} : { motionPath: requireMotionPath(raw.motionPath, where) }),
      ...(raw.paragraph === undefined ? {} : { paragraph: requireParagraph(raw.paragraph, where) }),
      ...(raw.direction === undefined ? {} : { direction: requireDirection(raw.direction, where) }),
      ...(raw.presetXml === undefined ? {} : { presetXml: raw.presetXml }),
    };
  });
  return { op: "setAnimations", target: { slide: edit.slideIndex }, items };
}

/** One validated animation edit -> the vendored op the executor runs. Refusals
 * are typed PptxEngineError codes: anim_no_slide (slide index absent from the
 * deck), anim_no_element (target/sourceId element missing), anim_bad_effect,
 * anim_bad_trigger, anim_bad_direction, anim_bad_paragraph, anim_bad_ms,
 * anim_bad_seq (after/seq/to), anim_bad_motion_path, anim_bad_items. Nothing is
 * px-converted (see the module header). */
export function buildAnimationOps(opened: OpenedPptxLike, fitWidthPx: number, edit: AnimationEdit): PptxOp[] {
  // Geometry-free kind: nothing to convert. `void` keeps the uniform wire
  // signature honest about the deliberate non-use.
  void fitWidthPx;
  switch (edit.op) {
    case "add_animation": {
      const slide = requireSlide(opened, edit.slideIndex, "add_animation");
      return [buildAddAnimation(slide, edit)];
    }
    case "remove_animation": {
      if (edit.seq !== undefined) {
        const seq = requireTimelineIndex(edit.seq, "seq", "remove_animation");
        requireSlide(opened, edit.slideIndex, "remove_animation");
        return [{ op: "removeAnimation", target: { slide: edit.slideIndex }, seq }];
      }
      const slide = requireSlide(opened, edit.slideIndex, "remove_animation");
      const elementId = requireElement(slide, edit.elementId, "remove_animation", edit.slideIndex);
      return [{ op: "removeAnimation", target: { slide: edit.slideIndex, el: elementId } }];
    }
    case "reorder_animation": {
      requireSlide(opened, edit.slideIndex, "reorder_animation");
      const seq = requireTimelineIndex(edit.seq, "seq", "reorder_animation");
      const to = requireTimelineIndex(edit.to, "to", "reorder_animation");
      return [{ op: "reorderAnimation", target: { slide: edit.slideIndex }, seq, to }];
    }
    case "set_animations": {
      const slide = requireSlide(opened, edit.slideIndex, "set_animations");
      return [buildSetAnimations(slide, edit)];
    }
  }
}