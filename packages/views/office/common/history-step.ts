import type { EditorHandle } from "@uniwork/core/office";

/** The part of an editor handle one undo/redo step needs. */
export type HistoryHandle = Pick<EditorHandle, "getDirtyGeneration" | "undo" | "redo" | "canUndo" | "canRedo">;
export type HistoryDirection = "undo" | "redo";

/**
 * Whether the handle has a step to take in that direction. A handle without
 * the step facet cannot move; one without `canUndo`/`canRedo` reports no
 * history depth, so it is treated as able to step and the generation check in
 * `stepHistory` keeps an empty stack from marking the document dirty.
 */
export function canStepHistory(handle: HistoryHandle, direction: HistoryDirection): boolean {
  const step = direction === "undo" ? handle.undo : handle.redo;
  if (!step) return false;
  const can = direction === "undo" ? handle.canUndo : handle.canRedo;
  return can ? can.call(handle) : true;
}

/**
 * Runs one undo/redo step and reports whether it changed the document, i.e.
 * whether the dirty generation moved. Every Office editor marks the document
 * dirty (and checkpoints it) only when this returns true (UNI-954): an
 * undo/redo on an empty stack is not a change. A host that swaps the bytes
 * asynchronously returns false here and reports the change through its own
 * change notification instead.
 */
export function stepHistory(handle: HistoryHandle, direction: HistoryDirection): boolean {
  if (!canStepHistory(handle, direction)) return false;
  const before = handle.getDirtyGeneration();
  if (direction === "undo") handle.undo?.();
  else handle.redo?.();
  return handle.getDirtyGeneration() !== before;
}
