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

/** Where the active hit sits: enough for the editor to show it. */
export interface PptxFindHit {
  slideIndex: number;
  elementId?: string;
}

export type PptxFindReplaceEdit = Extract<FindLinkEdit, { op: "find_replace" }>;

type Loose = Record<string, unknown>;

const asRecord = (value: unknown): Loose | null => (value && typeof value === "object" ? (value as Loose) : null);
const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/** The runs of one `text.paragraphs` block that the engine's replace visits: not
 * a dynamic field, not empty (`replaceAllInDeck` skips both). */
function paragraphRuns(text: unknown): string[] {
  const out: string[] = [];
  for (const paragraph of asArray(asRecord(text)?.paragraphs)) {
    for (const run of asArray(asRecord(paragraph)?.runs)) {
      const record = asRecord(run);
      if (!record || record.field || typeof record.text !== "string" || record.text === "") continue;
      out.push(record.text);
    }
  }
  return out;
}

/**
 * The deck flattened to the op's match unit: one entry per run, in the order
 * the vendored `replaceAllInDeck` visits them - text/shape elements, table
 * cells (merged ones skipped) and the direct text/shape children of a group.
 * Table and group runs carry the table's / group's element id, the only id the
 * edit can be scoped to. Reads the opaque deck model structurally (the same
 * documented `text.paragraphs[].runs[].text` shape the render tree consumes).
 */
export function flattenDeckRuns(deck: unknown): PptxFindTextTarget[] {
  const out: PptxFindTextTarget[] = [];
  asArray(asRecord(deck)?.slides).forEach((slide, slideIndex) => {
    const push = (text: string, elementId: unknown) => {
      out.push({ text, slideIndex, ...(typeof elementId === "string" ? { elementId } : {}) });
    };
    const pushText = (element: Loose) => {
      if (element.type !== "text" && element.type !== "shape") return;
      for (const text of paragraphRuns(element.text)) push(text, element.id);
    };
    for (const raw of asArray(asRecord(slide)?.elements)) {
      const element = asRecord(raw);
      if (!element) continue;
      if (element.type === "table") {
        for (const row of asArray(element.rows)) {
          for (const cell of asArray(row)) {
            const record = asRecord(cell);
            if (!record || record.merged) continue;
            for (const text of paragraphRuns(record.text)) push(text, element.id);
          }
        }
      } else if (element.type === "group") {
        for (const child of asArray(element.children)) {
          const record = asRecord(child);
          if (!record || (record.type !== "text" && record.type !== "shape")) continue;
          for (const text of paragraphRuns(record.text)) push(text, element.id);
        }
      } else {
        pushText(element);
      }
    }
  });
  return out;
}

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

/** Replace-one edit for exactly the active hit: scoped to its element, with the
 * hit's ordinal among that element's matches (`occurrence`), so the match the
 * panel shows is the one replaced - not the element's first match. The ordinal
 * is the first match of the hit's run: the matches in earlier runs of the same
 * element, in the engine's scan order. Null when no hit. */
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
  if (target.elementId) {
    edit.elementId = target.elementId;
    let occurrence = 0;
    for (const earlier of plan.hits.slice(0, hitIndex)) {
      const run = targets[earlier.index - 1];
      if (run?.slideIndex === target.slideIndex && run.elementId === target.elementId) occurrence += earlier.count;
    }
    edit.occurrence = occurrence;
  }
  return edit;
}