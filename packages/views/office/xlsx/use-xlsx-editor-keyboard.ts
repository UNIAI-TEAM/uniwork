"use client";

// FIX-EDITOR-SPLIT (UNI-926): the keyboard wiring extracted from
// xlsx-editor.tsx - the JSX key handler and the capture-phase Ctrl/Cmd+S
// shortcut that Univer's nested React root would otherwise swallow. Bodies and
// the listener effect are byte-identical to the shell it replaces.

import { useCallback, useEffect, type KeyboardEvent, type MutableRefObject, type RefObject } from "react";

export interface XlsxEditorKeyboardOptions {
  gridReady: boolean;
  copy: () => Promise<void>;
  paste: () => Promise<void>;
  undo: () => void;
  redo: () => void;
  clipboardFailure: () => void;
  save: (entryPoint?: "button" | "shortcut") => void;
  rootRef: RefObject<HTMLElement | null>;
  documentKey: string;
  editor: unknown;
}

export interface XlsxEditorKeyboardWiring {
  keyboardHandler: (event: KeyboardEvent<HTMLDivElement>) => void;
  captureSave: (event: globalThis.KeyboardEvent) => void;
}

export function useXlsxEditorKeyboard(options: XlsxEditorKeyboardOptions): XlsxEditorKeyboardWiring {
  const { gridReady, copy, paste, undo, redo, clipboardFailure, save, rootRef, documentKey, editor } = options;

  const keyboardHandler = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing) return;
    const modifier = event.metaKey || event.ctrlKey;
    if (!modifier) return;
    const key = event.key.toLowerCase();
    if (gridReady && event.target instanceof HTMLElement && event.target.closest(".xlsx-surface")) {
      // Univer owns its cell-editor and range shortcuts; bubbling must not
      // execute a second undo or overwrite a multi-cell paste.
      return;
    } else if (key === "c" && !gridReady && !(event.target instanceof HTMLInputElement)) {
      event.preventDefault();
      void copy().catch(clipboardFailure);
    } else if (key === "v" && !gridReady && !(event.target instanceof HTMLInputElement)) {
      event.preventDefault();
      void paste().catch(clipboardFailure);
    } else if (key === "z" && !event.shiftKey && !(event.target instanceof HTMLInputElement)) {
      event.preventDefault();
      undo();
    } else if ((key === "y" || (key === "z" && event.shiftKey)) && !(event.target instanceof HTMLInputElement)) {
      event.preventDefault();
      redo();
    }
  }, [clipboardFailure, copy, gridReady, paste, redo, undo]);

  const captureSave = useCallback((event: globalThis.KeyboardEvent) => {
    if (event.isComposing || !(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "s") return;
    // Univer's imperative input has no fiber inside its nested React root,
    // so JSX capture misses it even though its DOM path crosses this root.
    event.preventDefault();
    event.stopPropagation();
    save("shortcut");
  }, [save]);
  useEffect(() => {
    const root = rootRef.current;
    root?.addEventListener("keydown", captureSave, true);
    return () => root?.removeEventListener("keydown", captureSave, true);
  }, [captureSave, documentKey, editor, rootRef]);

  return { keyboardHandler, captureSave };
}
