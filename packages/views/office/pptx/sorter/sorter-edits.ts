/**
 * A2 UI half (UNI-927) - the exact `PptxEdit` objects the sorter sends.
 *
 * One builder per sorter gesture, each producing the SAME kind the engine half
 * already registered in `PPTX_EDIT_REGISTRY` (`packages/office-engine/src/pptx/model.ts`):
 *
 *   new slide      -> add_slide_with_layout   (vendored addSlideWithLayout)
 *   duplicate      -> duplicate_slide         (duplicateSlide)
 *   delete         -> delete_slide            (deleteSlide)
 *   hide / show    -> set_slide_hidden        (setHidden)
 *   drag reorder   -> move_slide              (moveSlide)
 *   sections       -> add_section / rename_section / remove_section / move_section
 *                     (buildSectionOps, A2e)
 *
 * The builders never call the engine and never hold state: they return the edit
 * list the panel hands to its single `onEdit` channel, so a unit test can pin the
 * wire shape without a runtime, and the UI-wire round only has to pass
 * `editorHandle.edit` in.
 */
import type { PptxEdit } from "@uniwork/office-engine/pptx";
import { reorderSlideTargets } from "./sorter-helpers";

/** A new slide after `afterIndex`, built from the layout at `layoutIndex`. The
 *  vendored op resolves a 0-based layout index, so the picker sends the index. */
export function addSlideEdit(layoutIndex: number, afterIndex: number): PptxEdit | null {
  if (!Number.isInteger(layoutIndex) || layoutIndex < 0) return null;
  if (!Number.isInteger(afterIndex) || afterIndex < 0) return null;
  return { op: "add_slide_with_layout", layout: layoutIndex, slideIndex: afterIndex };
}

/** Duplicate one slide (text kept - the sorter duplicates the whole slide). */
export function duplicateSlideEdit(slideIndex: number): PptxEdit | null {
  if (!Number.isInteger(slideIndex) || slideIndex < 0) return null;
  return { op: "duplicate_slide", slideIndex };
}

export function deleteSlideEdit(slideIndex: number): PptxEdit | null {
  if (!Number.isInteger(slideIndex) || slideIndex < 0) return null;
  return { op: "delete_slide", slideIndex };
}

export function setSlideHiddenEdit(slideIndex: number, hidden: boolean): PptxEdit | null {
  if (!Number.isInteger(slideIndex) || slideIndex < 0) return null;
  return { op: "set_slide_hidden", slideIndex, hidden };
}

/** The `move_slide` edit for a drag/keyboard reorder, or null for a no-op gesture
 *  (same index, or an end outside the deck) so a refused drag never dirties the deck. */
export function moveSlideEdit(from: number, to: number, slideCount: number): PptxEdit | null {
  const move = reorderSlideTargets(from, to, slideCount);
  return move ? { op: "move_slide", slideIndex: move.from, toIndex: move.to } : null;
}

export function addSectionEdit(atSlideIndex: number, name: string): PptxEdit | null {
  const trimmed = name.trim();
  if (!Number.isInteger(atSlideIndex) || atSlideIndex < 0 || trimmed.length === 0) return null;
  return { op: "add_section", atSlideIndex, name: trimmed };
}

export function renameSectionEdit(id: string, name: string): PptxEdit | null {
  const trimmed = name.trim();
  if (!id || trimmed.length === 0) return null;
  return { op: "rename_section", id, name: trimmed };
}

export function removeSectionEdit(id: string): PptxEdit | null {
  return id ? { op: "remove_section", id } : null;
}

export function moveSectionEdit(id: string, dir: "up" | "down"): PptxEdit | null {
  return id ? { op: "move_section", id, dir } : null;
}

/** Drop the null builders so a caller can hand the result straight to `onEdit`. */
export function compactEdits(edits: ReadonlyArray<PptxEdit | null>): PptxEdit[] {
  return edits.filter((edit): edit is PptxEdit => edit !== null);
}