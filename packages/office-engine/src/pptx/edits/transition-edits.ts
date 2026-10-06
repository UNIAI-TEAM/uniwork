// B4e (UNI-927) — transition + advance-timing edits (logic half).
//
// Binds the two vendored pptx-ops kinds this area owns to one typed,
// validated op builder. The wire round registers `TransitionEdit` as
// `PptxEdit` kinds in model.ts and calls the builder mechanically:
//
//   this.txn(buildTransitionOps(this.opened, this.fitWidthPx, edit))
//
// Vendored contract (READ ONLY — never imported; cited for every field):
//   setTransition   packages/pptx-ops/src/ops/slide-ops.ts:472 (validate:
//                   474-481 -> kind must be one of TRANSITION_KINDS; apply:
//                   483-487 -> setSlideTransition,
//                   packages/pptx-engine/src/index.ts:3983). "none" clears
//                   the transition on the slide part.
//   setAdvanceTime  packages/pptx-ops/src/ops/slide-ops.ts:490 (validate:
//                   492-499 -> ms null or finite >= 0; apply: 501-505 ->
//                   setSlideAdvanceTime, pptx-engine/src/index.ts:3994, which
//                   rounds to whole ms). null clears the auto-advance timer.
//   kind list       packages/pptx-engine/src/generate.ts:1451-1463
//                   (SlideTransitionKind union) and :1465-1478
//                   (TRANSITION_KINDS literal array).
//
// Both kinds are geometry-free — the transition and the advance time live on
// the slide part, never in an element rect — so no px→EMU conversion happens
// here; `fitWidthPx` stays in the signature only because every engine-half
// builder shares the same mechanical wire call.
import { PptxEngineError, type OpenedPptxLike, type PptxOp, type PptxSlideLike } from "../engine";

/** Accepted transition kinds, copied verbatim from the vendored
 * TRANSITION_KINDS (generate.ts:1465-1478). The unit test parses the vendored
 * source and fails with the diff when this literal drifts. */
export const PPTX_TRANSITION_KINDS = [
  "none",
  "morph",
  "fade",
  "push",
  "wipe",
  "split",
  "circle",
  "cover",
  "pull",
  "dissolve",
  "zoom",
  "random",
] as const;
export type PptxTransitionKind = (typeof PPTX_TRANSITION_KINDS)[number];

/** The edit kinds this module builds (registered as PptxEdit kinds by the
 * wire round):
 *  - set_transition   -> vendored `setTransition` (slide target + kind);
 *  - set_advance_time -> vendored `setAdvanceTime` (slide target + ms; null
 *                        clears the auto-advance timer). */
export type TransitionEdit =
  | { op: "set_transition"; slideIndex: number; kind: PptxTransitionKind }
  | { op: "set_advance_time"; slideIndex: number; ms: number | null };

const requireSlide = (opened: OpenedPptxLike, slideIndex: number, op: string): PptxSlideLike => {
  const slide = Number.isInteger(slideIndex) && slideIndex >= 0 ? opened.deck.slides[slideIndex] : undefined;
  if (!slide) {
    throw new PptxEngineError("no_slide", op + ": slide index " + String(slideIndex) + " does not exist");
  }
  return slide;
};

/** One validated edit -> the vendored op(s) the executor runs. Refusals are
 * typed PptxEngineError codes: no_slide (slide index absent from the deck),
 * bad_transition_kind (kind outside the vendored list), bad_advance_time (ms
 * neither null nor a finite number >= 0). */
export function buildTransitionOps(opened: OpenedPptxLike, fitWidthPx: number, edit: TransitionEdit): PptxOp[] {
  // Slide-part state: nothing to convert (see the module header). `void`
  // keeps the uniform wire signature honest about the deliberate non-use.
  void fitWidthPx;
  switch (edit.op) {
    case "set_transition": {
      requireSlide(opened, edit.slideIndex, "set_transition");
      if (!(PPTX_TRANSITION_KINDS as readonly unknown[]).includes(edit.kind)) {
        throw new PptxEngineError(
          "bad_transition_kind",
          'set_transition "kind" must be one of ' + PPTX_TRANSITION_KINDS.join(", ") + ".",
        );
      }
      return [{ op: "setTransition", target: { slide: edit.slideIndex }, kind: edit.kind }];
    }
    case "set_advance_time": {
      requireSlide(opened, edit.slideIndex, "set_advance_time");
      const { ms } = edit;
      if (ms !== null && (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0)) {
        throw new PptxEngineError(
          "bad_advance_time",
          'set_advance_time "ms" must be a non-negative finite number of milliseconds, or null to clear.',
        );
      }
      return [{ op: "setAdvanceTime", target: { slide: edit.slideIndex }, ms }];
    }
  }
}
