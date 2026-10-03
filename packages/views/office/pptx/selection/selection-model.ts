/**
 * The PPTX selection model: which element ids are selected on the current
 * slide.
 *
 * Selection is VIEW state — it lives in React state (the `usePptxSelection`
 * hook), never in a core store and never in server state, because it is not
 * document data: it does not survive a save, and two viewers of the same deck
 * legitimately select different shapes.
 *
 * Pure helpers only, so click / shift-click / marquee / prune semantics are
 * unit-testable without a DOM.
 */
import type { PptxNodeBox } from "../canvas/render-tree";

export interface PptxSelectionState {
  /** Selected source ids, in selection order (the first is the anchor). */
  ids: readonly string[];
}

export const EMPTY_SELECTION: PptxSelectionState = { ids: [] };

/**
 * Click semantics: a plain click replaces the selection with the hit element;
 * shift-click adds an unselected element or removes an already-selected one
 * (the standard toggle). A plain click on empty canvas clears.
 */
export function selectAt(state: PptxSelectionState, hitId: string | null, additive: boolean): PptxSelectionState {
  if (hitId === null) return additive ? state : EMPTY_SELECTION;
  if (!additive) return { ids: state.ids.length === 1 && state.ids[0] === hitId ? state.ids : [hitId] };
  return state.ids.includes(hitId)
    ? { ids: state.ids.filter((id) => id !== hitId) }
    : { ids: [...state.ids, hitId] };
}

/** Replace the whole selection (marquee result, select-all, programmatic). */
export function setSelection(ids: readonly string[]): PptxSelectionState {
  const unique = [...new Set(ids)];
  return { ids: unique };
}

/**
 * Drop ids that no longer exist on the slide (an element was deleted, or the
 * slide changed under the selection). Keeps the original order.
 */
export function pruneSelection(state: PptxSelectionState, boxes: readonly PptxNodeBox[]): PptxSelectionState {
  const live = new Set(boxes.map((entry) => entry.sourceId));
  const ids = state.ids.filter((id) => live.has(id));
  return ids.length === state.ids.length ? state : { ids };
}

export function selectionHas(state: PptxSelectionState, id: string): boolean {
  return state.ids.includes(id);
}
