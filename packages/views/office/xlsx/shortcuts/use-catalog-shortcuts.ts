// Wave A / A9 r3 (UNI-926): the editor-side binding for the shortcuts the help
// catalog advertises. The catalog must list only keys that really answer, so
// the keys the pinned sheets-ui does NOT bind (Ctrl+F is policy-denied,
// Shift+F11 and Ctrl+PageUp/Down have no upstream binding) are captured here
// on the native path - the Univer input is a nested React root, so a JSX
// handler would miss it. The redo alternate chord Ctrl+Shift+Z is captured
// here too: the pinned bundle binds only Ctrl+Y for redo, so on the live grid
// the advertised alternative would otherwise be dead. Kept out of
// `xlsx-editor.tsx` so the shared file gains only a one-line mount.

import { useEffect, type RefObject } from "react";
import { uniqueSheetName } from "../sheet-tabs";

/** One tab as the strip renders it. */
export interface XlsxCatalogShortcutSheet {
  readonly name: string;
  readonly hidden: boolean;
}

export interface XlsxCatalogShortcutOptions {
  /** False while the document is still opening/errored; the listener is off. */
  enabled: boolean;
  /** The editor root; the listener is capture-phase so the nested renderer
   *  root cannot swallow the key. */
  rootRef: RefObject<HTMLElement | null>;
  /** The document session; re-binds the listener when it changes. */
  documentKey: string;
  /** A grid is mounted, so the editor-owned find panel can open. */
  canFind: boolean;
  /** The grid accepts edits (Shift+F11 insert-sheet). */
  canEdit: boolean;
  /** The grid has a live undo stack, so the redo alternate chord answers. */
  canRedo: boolean;
  /** Visible + hidden tabs in strip order (the active sheet is matched by name). */
  sheets: readonly XlsxCatalogShortcutSheet[];
  activeSheet: string | null;
  /** The default name for a new sheet (localized, e.g. "Sheet"). */
  defaultSheetName: string;
  onOpenFind: () => void;
  /** Insert a sheet with the given (unique) name. */
  onInsertSheet: (name: string) => void;
  onSelectSheet: (name: string) => void;
  /** Redo the last undone edit (the Ctrl+Shift+Z alternate chord). */
  onRedo: () => void;
}

/** True while a form control (the formula bar, a native input) owns the
 *  keyboard: the key keeps its text meaning there. The Univer grid itself is
 *  contenteditable, so contenteditable targets are NOT excluded - Excel also
 *  lets these keys fire over an in-progress cell edit. */
function ownsKeyboard(target: EventTarget | null): boolean {
  return target instanceof HTMLElement &&
    (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT");
}

/** Binds the catalog keys the pinned UI does not: Ctrl/Cmd+F (editor find),
 *  Shift+F11 (insert sheet), Ctrl/Cmd+PageDown/PageUp (next/previous visible
 *  sheet) and Ctrl/Cmd+Shift+Z (redo; upstream binds only Ctrl+Y). Excel does
 *  not wrap at either end. */
export function useXlsxCatalogShortcuts(options: XlsxCatalogShortcutOptions): void {
  const {
    enabled, rootRef, documentKey, canFind, canEdit, canRedo, sheets, activeSheet, defaultSheetName,
    onOpenFind, onInsertSheet, onSelectSheet, onRedo,
  } = options;

  useEffect(() => {
    if (!enabled) return undefined;
    const root = rootRef.current;
    if (!root) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || event.altKey || ownsKeyboard(event.target)) return;
      const key = event.key;
      // Shift+F11 inserts a sheet (Excel) and needs no primary modifier.
      if (key === "F11" && event.shiftKey) {
        if (!canEdit) return;
        event.preventDefault();
        event.stopPropagation();
        onInsertSheet(uniqueSheetName(defaultSheetName, sheets.map((sheet) => sheet.name)));
        return;
      }
      if (!(event.metaKey || event.ctrlKey)) return;
      // The redo alternate chord: the pinned bundle binds only Ctrl+Y, so the
      // advertised Ctrl+Shift+Z is dead on the live grid without this.
      if ((key === "z" || key === "Z") && event.shiftKey) {
        if (!canRedo) return;
        event.preventDefault();
        event.stopPropagation();
        onRedo();
        return;
      }
      if ((key === "f" || key === "F") && !event.shiftKey) {
        if (!canFind) return;
        event.preventDefault();
        event.stopPropagation();
        onOpenFind();
        return;
      }
      if ((key === "PageDown" || key === "PageUp") && !event.shiftKey) {
        const visible = sheets.filter((sheet) => !sheet.hidden);
        const index = visible.findIndex((sheet) => sheet.name === activeSheet);
        const next = index < 0 ? undefined : visible[index + (key === "PageDown" ? 1 : -1)];
        if (!next) return;
        event.preventDefault();
        event.stopPropagation();
        onSelectSheet(next.name);
      }
    };
    root.addEventListener("keydown", onKeyDown, true);
    return () => root.removeEventListener("keydown", onKeyDown, true);
  }, [
    activeSheet, canEdit, canFind, canRedo, defaultSheetName, documentKey, enabled,
    onInsertSheet, onOpenFind, onRedo, onSelectSheet, rootRef, sheets,
  ]);
}
