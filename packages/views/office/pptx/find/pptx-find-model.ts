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

/** One match: a single occurrence inside one run (R3 F-1). A run that holds
 * the query twice yields two hits, so the count, Next/Previous and Replace (one)
 * all address the occurrence the panel shows, not the run around it. */
export interface PptxFindOccurrence {
  /** 0-based index of the run in `targets`. */
  run: number;
  /** Character offset of the match inside the run's text. */
  offset: number;
  length: number;
  slideIndex: number;
  elementId?: string;
}

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Every occurrence of `find` across the runs, in the engine's scan order. The
 * runs that match come from the engine plan; the offsets inside them come from
 * the same literal, global, case-folded-unless-matchCase regex the engine uses,
 * so the number of hits is always `plan.total` and the n-th hit of an element
 * is the n-th match the engine's `occurrence` counts.
 */
export function findOccurrences(
  targets: readonly PptxFindTextTarget[],
  find: string,
  matchCase: boolean,
): PptxFindOccurrence[] {
  const plan = planFind(targets, find, matchCase);
  const out: PptxFindOccurrence[] = [];
  for (const hit of plan.hits) {
    const run = hit.index - 1;
    const target = targets[run];
    if (!target) continue;
    const re = new RegExp(escapeRegExp(find), matchCase ? "g" : "gi");
    for (const match of target.text.matchAll(re)) {
      out.push({
        run,
        offset: match.index,
        length: match[0].length,
        slideIndex: target.slideIndex,
        ...(target.elementId === undefined ? {} : { elementId: target.elementId }),
      });
    }
  }
  return out;
}

/** The occurrence the active hit points at, or null when there is no hit. */
export function activeHitTarget(
  hits: readonly PptxFindOccurrence[],
  hitIndex: number,
): PptxFindOccurrence | null {
  return hits[hitIndex] ?? null;
}

/** Deck-wide replace-all edit, or null when there is nothing to find. One edit,
 * so every occurrence goes in one undoable step. */
export function replaceAllEdit(
  find: string,
  replace: string,
  matchCase: boolean,
): PptxFindReplaceEdit | null {
  if (!find) return null;
  return { op: "find_replace", find, replace, matchCase };
}

/** Replace-one edit for exactly the active occurrence: scoped to its element,
 * with its ordinal among that element's matches (`occurrence`) - the earlier
 * hits on the same slide and element, in the engine's scan order - so the match
 * the panel shows is the one replaced, even the second match of a single run.
 * Null when no hit. */
export function replaceOneEdit(
  hits: readonly PptxFindOccurrence[],
  hitIndex: number,
  find: string,
  replace: string,
  matchCase: boolean,
): PptxFindReplaceEdit | null {
  if (!find) return null;
  const target = activeHitTarget(hits, hitIndex);
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
    edit.occurrence = hits
      .slice(0, hitIndex)
      .filter((earlier) => earlier.slideIndex === target.slideIndex && earlier.elementId === target.elementId).length;
  }
  return edit;
}
