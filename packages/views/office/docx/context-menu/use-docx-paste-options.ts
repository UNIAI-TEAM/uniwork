"use client";

import type { Editor } from "@tiptap/core";
import type { Transaction } from "@tiptap/pm/state";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  applyDocxPasteMode,
  changedRangeOf,
  type DocxPasteMode,
  type DocxPastePayload,
  type DocxPasteRange,
} from "./paste-options";

const CHIP_GAP = 6;
const CHIP_EDGE = 8;

export interface DocxPasteChipState {
  /** The range the paste inserted, in the current document. */
  range: DocxPasteRange;
  mode: DocxPasteMode;
  /** Viewport coordinates for the fixed chip; null when the host has no layout. */
  position: { left: number; top: number } | null;
}

export interface DocxPasteOptionsController {
  getState(): DocxPasteChipState | null;
  subscribe(listener: (state: DocxPasteChipState | null) => void): () => void;
  /** A paste is about to run (armed by the surface's paste capture). */
  notePaste(payload: DocxPastePayload | null): void;
  apply(mode: DocxPasteMode): void;
  dismiss(): void;
  refreshPosition(): void;
  dispose(): void;
}

/**
 * Drives the post-paste chip from the editor alone: a paste arms the controller
 * (the surface reads the clipboard event before ProseMirror dispatches), the
 * next document change is the paste, and the changed range is where the chip
 * anchors. Any later document change dismisses it, so the range is never stale.
 */
export function createDocxPasteOptionsController(editor: Editor): DocxPasteOptionsController {
  let pending = false;
  let state: DocxPasteChipState | null = null;
  const listeners = new Set<(state: DocxPasteChipState | null) => void>();

  const notify = () => {
    for (const listener of listeners) listener(state);
  };

  const place = (to: number): { left: number; top: number } | null => {
    if (typeof window === "undefined") return null;
    try {
      const coords = editor.view.coordsAtPos(Math.min(to, editor.state.doc.content.size));
      return {
        left: Math.max(CHIP_EDGE, Math.min(coords.right + CHIP_GAP, window.innerWidth - CHIP_EDGE)),
        top: Math.max(CHIP_EDGE, Math.min(coords.bottom + CHIP_GAP, window.innerHeight - CHIP_EDGE)),
      };
    } catch {
      return null;
    }
  };

  const onTransaction = ({ transaction }: { transaction: Transaction }) => {
    if (!transaction.docChanged) return;
    if (pending) {
      pending = false;
      const range = changedRangeOf(transaction);
      state = range ? { range, mode: "source", position: place(range.to) } : null;
      notify();
      return;
    }
    if (state) {
      state = null;
      notify();
    }
  };

  editor.on("transaction", onTransaction);

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    notePaste(payload) {
      pending = payload !== null;
    },
    apply(mode) {
      const current = state;
      state = null;
      if (current) applyDocxPasteMode(editor, current.range, mode);
      editor.commands.focus();
      notify();
    },
    dismiss() {
      if (!state) return;
      state = null;
      notify();
    },
    refreshPosition() {
      if (!state) return;
      state = { ...state, position: place(state.range.to) };
      notify();
    },
    dispose() {
      editor.off("transaction", onTransaction);
      listeners.clear();
      state = null;
      pending = false;
    },
  };
}

export interface DocxPasteOptions {
  chip: DocxPasteChipState | null;
  notePaste: (payload: DocxPastePayload | null) => void;
  apply: (mode: DocxPasteMode) => void;
  dismiss: () => void;
  refreshPosition: () => void;
}

/** Subscribes to the controller; a host may inject its own (test seam). */
export function useDocxPasteOptions(
  editor: Editor | null,
  provided?: DocxPasteOptionsController | null,
): DocxPasteOptions {
  const [chip, setChip] = useState<DocxPasteChipState | null>(null);
  const controllerRef = useRef<DocxPasteOptionsController | null>(null);

  useEffect(() => {
    if (provided) {
      controllerRef.current = provided;
      setChip(provided.getState());
      return provided.subscribe(setChip);
    }
    if (!editor) {
      controllerRef.current = null;
      setChip(null);
      return undefined;
    }
    const owned = createDocxPasteOptionsController(editor);
    controllerRef.current = owned;
    setChip(owned.getState());
    const unsubscribe = owned.subscribe(setChip);
    return () => {
      unsubscribe();
      owned.dispose();
      controllerRef.current = null;
    };
  }, [editor, provided]);

  const notePaste = useCallback((payload: DocxPastePayload | null) => {
    controllerRef.current?.notePaste(payload);
  }, []);
  const apply = useCallback((mode: DocxPasteMode) => {
    controllerRef.current?.apply(mode);
  }, []);
  const dismiss = useCallback(() => {
    controllerRef.current?.dismiss();
  }, []);
  const refreshPosition = useCallback(() => {
    controllerRef.current?.refreshPosition();
  }, []);

  return useMemo(
    () => ({ chip, notePaste, apply, dismiss, refreshPosition }),
    [chip, notePaste, apply, dismiss, refreshPosition],
  );
}
