import { useCallback, useEffect, type RefObject } from "react";
import { keyTypesText, type XlsxCellEditingProbe } from "./key-target";
import type { XlsxVisualsHistory } from "./use-xlsx-visuals";

interface HistorySide {
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
}

/** The grid side: its stack, and whether a cell edit is open. */
interface GridSide extends HistorySide {
  isCellEditing?: XlsxCellEditingProbe;
}

/** Where the undo/redo chords are caught: the editor root, per document. */
interface VisualUndoKeys {
  rootRef: RefObject<HTMLElement | null>;
  documentKey: string;
}

/** Undo/redo for the ribbon and the shortcuts: moves, inserts and deletes of
 *  visuals are not on the grid's stack, so the newest of them is the next
 *  step and the grid's own stack answers otherwise. Ctrl/Cmd+Z, Ctrl+Y and
 *  Ctrl/Cmd+Shift+Z take the visual step (before the grid hears the key) only
 *  when it is the eligible next one, wherever focus is (the grid's editor
 *  input too: one undo order like Excel, review r3 F2). Typing in a form
 *  control and an open cell edit keep their own text undo (key-target.ts). */
export function useVisualUndo(visuals: XlsxVisualsHistory, grid: GridSide, keys?: VisualUndoKeys): HistorySide {
  const undo = useCallback(() => (visuals.canUndo ? visuals.undo() : grid.undo()), [grid, visuals]);
  const redo = useCallback(() => (visuals.canRedo ? visuals.redo() : grid.redo()), [grid, visuals]);
  const rootRef = keys?.rootRef;
  const documentKey = keys?.documentKey;
  const { isCellEditing } = grid;
  useEffect(() => {
    const root = rootRef?.current;
    if (!root) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || event.altKey || !(event.metaKey || event.ctrlKey)) return;
      const key = event.key.toLowerCase();
      const wantsRedo = key === "y" || (key === "z" && event.shiftKey);
      const wantsUndo = key === "z" && !event.shiftKey;
      if (!(wantsUndo && visuals.canUndo) && !(wantsRedo && visuals.canRedo)) return;
      if (keyTypesText(event.target, isCellEditing, visuals.selected)) return;
      event.preventDefault();
      event.stopPropagation();
      if (wantsUndo) visuals.undo();
      else visuals.redo();
    };
    root.addEventListener("keydown", onKeyDown, true);
    return () => root.removeEventListener("keydown", onKeyDown, true);
  }, [documentKey, isCellEditing, rootRef, visuals]);
  return { canUndo: visuals.canUndo || grid.canUndo, canRedo: visuals.canRedo || grid.canRedo, undo, redo };
}
