import { useCallback, useEffect, type RefObject } from "react";
import type { XlsxVisualsHistory } from "./use-xlsx-visuals";

interface HistorySide {
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
}

/** Where the undo/redo chords are caught: the editor root, per document. */
interface VisualUndoKeys {
  rootRef: RefObject<HTMLElement | null>;
  documentKey: string;
}

/** A native form control keeps its own undo (the formula bar, dialogs). */
const ownsText = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT");
/** The grid is contenteditable, so an edit in a cell lives there too. */
const inEditableSurface = (target: EventTarget | null): boolean => target instanceof Element && target.closest("[contenteditable]:not([contenteditable=\"false\"])") !== null;

/** Undo/redo for the ribbon and the shortcuts: moves, inserts and deletes of
 *  visuals are not on the grid's stack, so the newest of them is the next
 *  step and the grid's own stack answers otherwise. Ctrl/Cmd+Z, Ctrl+Y and
 *  Ctrl/Cmd+Shift+Z take the visual step (before the grid hears the key) only
 *  when it is the eligible next one; typing in a form control is left alone,
 *  and so is the grid's editable surface unless a visual is selected (a press
 *  in a cell clears the selection, so a selected visual means no cell edit). */
export function useVisualUndo(visuals: XlsxVisualsHistory, grid: HistorySide, keys?: VisualUndoKeys): HistorySide {
  const undo = useCallback(() => (visuals.canUndo ? visuals.undo() : grid.undo()), [grid, visuals]);
  const redo = useCallback(() => (visuals.canRedo ? visuals.redo() : grid.redo()), [grid, visuals]);
  const rootRef = keys?.rootRef;
  const documentKey = keys?.documentKey;
  useEffect(() => {
    const root = rootRef?.current;
    if (!root) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || event.altKey || !(event.metaKey || event.ctrlKey)) return;
      const key = event.key.toLowerCase();
      const wantsRedo = key === "y" || (key === "z" && event.shiftKey);
      const wantsUndo = key === "z" && !event.shiftKey;
      if (!(wantsUndo && visuals.canUndo) && !(wantsRedo && visuals.canRedo)) return;
      if (ownsText(event.target) || (inEditableSurface(event.target) && !visuals.selected)) return;
      event.preventDefault();
      event.stopPropagation();
      if (wantsUndo) visuals.undo();
      else visuals.redo();
    };
    root.addEventListener("keydown", onKeyDown, true);
    return () => root.removeEventListener("keydown", onKeyDown, true);
  }, [documentKey, rootRef, visuals]);
  return { canUndo: visuals.canUndo || grid.canUndo, canRedo: visuals.canRedo || grid.canRedo, undo, redo };
}
