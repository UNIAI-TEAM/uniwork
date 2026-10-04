/**
 * Find & replace panel model (A6ui, UNI-927) - the pure half.
 *
 * Everything here is data or a pure function, so the panel stays
 * presentational and the navigation the user depends on is unit-tested without
 * a DOM. The plan is the committed engine helper: `planFindReplace`
 * (packages/office-engine/src/pptx/edits/find-link-edits.ts) counts matches the
 * same way the vendored `replaceAllInDeck` will (literal, global, case-folded
 * unless matchCase), so the count the panel shows is the count the op replaces.
 *
 * Emitted edits are the REAL registered `find_replace` kind, so the wire round
 * forwards them to the editor's edit channel unchanged.
 */
import { planFindReplace, type FindLinkEdit, type FindReplacePlan } from "@uniwork/office-engine/pptx";

/** One replace unit: a run/element's text plus where it lives. The vendored op
 * replaces within a single run, so callers pass one entry per run. */
export interface PptxFindTextTarget {
  text: string;
  slideIndex: number;
  elementId?: string;
}

export type PptxFindReplaceEdit = Extract<FindLinkEdit, { op: "find_replace" }>;

/** No active hit (empty query or no matches). */
export const PPTX_FIND_UNSET_HIT = -1;

/** The plan over the deck's texts; `plan.hits[i].index` is the 1-based position
 * of the i-th matching input in `targets`. */
export function planFind(
  targets: readonly PptxFindTextTarget[],
  find: string,
  matchCase: boolean,
): FindReplacePlan {
  return planFindReplace(
    targets.map((target) => target.text),
    find,
    { matchCase },
  );
}

/** Clamp an index into the plan's hit range, or PPTX_FIND_UNSET_HIT when there
 * are no hits. */
export function clampHitIndex(current: number, total: number): number {
  if (total <= 0) return PPTX_FIND_UNSET_HIT;
  if (current < 0) return 0;
  return Math.min(current, total - 1);
}

/** Cycle the active hit, wrapping at both ends. An unset/out-of-range index
 * enters the list at the end the direction comes from. */
export function stepHitIndex(current: number, total: number, direction: 1 | -1): number {
  if (total <= 0) return PPTX_FIND_UNSET_HIT;
  if (current < 0 || current >= total) return direction === 1 ? 0 : total - 1;
  return (current + direction + total) % total;
}

/** The target the active hit points at, or null when there is no hit. */
export function activeHitTarget(
  targets: readonly PptxFindTextTarget[],
  plan: FindReplacePlan,
  hitIndex: number,
): PptxFindTextTarget | null {
  const hit = plan.hits[hitIndex];
  if (!hit) return null;
  return targets[hit.index - 1] ?? null;
}

/** Deck-wide replace-all edit, or null when there is nothing to find. */
export function replaceAllEdit(
  find: string,
  replace: string,
  matchCase: boolean,
): PptxFindReplaceEdit | null {
  if (!find) return null;
  return { op: "find_replace", find, replace, matchCase };
}

/** Replace-one edit scoped to the element under the active hit (the vendored
 * "Replace" button acts on the currently hit element). Null when no hit. */
export function replaceOneEdit(
  targets: readonly PptxFindTextTarget[],
  plan: FindReplacePlan,
  hitIndex: number,
  find: string,
  replace: string,
  matchCase: boolean,
): PptxFindReplaceEdit | null {
  if (!find) return null;
  const target = activeHitTarget(targets, plan, hitIndex);
  if (!target) return null;
  const edit: PptxFindReplaceEdit = {
    op: "find_replace",
    find,
    replace,
    matchCase,
    firstOnly: true,
    slideIndex: target.slideIndex,
  };
  if (target.elementId) edit.elementId = target.elementId;
  return edit;
}