"use client";

// FIX-EDITOR-SPLIT (UNI-926): the cell-edit, undo/redo, save-preparation and
// recalculation wiring extracted from xlsx-editor.tsx. Every callback body and
// its ordering is byte-identical to the shell it replaces; only the state
// setters and refs it already closed over are threaded in as options.

import { useCallback, useEffect, type MutableRefObject } from "react";
import { useTranslation } from "react-i18next";
import type { XlsxCellState, XlsxWorkbookSnapshot } from "@uniwork/office-engine/xlsx";
import type { XlsxGridHandle, XlsxGridHostPort } from "./xlsx-grid-surface";
import { addressParts, cellEditOperation, cellText } from "./xlsx-editor-model";
import type { XlsxEditorHandle, XlsxRecalcController, XlsxSaveCoordinator, XlsxSelection, XlsxViewState } from "./types";

export interface XlsxEditorEditsOptions<TSnapshot = XlsxWorkbookSnapshot> {
  editor: XlsxEditorHandle<TSnapshot>;
  coordinator: XlsxSaveCoordinator;
  rendererHost: XlsxGridHostPort | undefined;
  gridRef: MutableRefObject<XlsxGridHandle | null>;
  gridReady: boolean;
  selection: XlsxSelection | null;
  formulaDraft: string;
  activeCell: XlsxCellState | undefined;
  canEdit: boolean;
  readOnly: boolean;
  visibleState: XlsxViewState;
  flushGridEdits: () => Promise<void>;
  refreshSnapshot: () => void;
  recalcController: XlsxRecalcController | undefined;
  recalcProgress: number | null;
  recalcAbortRef: MutableRefObject<AbortController | null>;
  disposedRef: MutableRefObject<boolean>;
  registerSavePreparation: ((prepare: () => Promise<void>) => () => void) | undefined;
  setRecalcError: (message: string | null) => void;
  setRecalcFresh: (fresh: boolean) => void;
  setRecalcProgress: (progress: number | null) => void;
}

export interface XlsxEditorEditsWiring {
  markDirty: () => void;
  commitCell: () => Promise<void>;
  undo: () => void;
  redo: () => void;
  prepareSave: () => Promise<void>;
  save: (entryPoint?: "button" | "shortcut") => void;
  recalculate: () => Promise<void>;
  cancelRecalculate: () => void;
}

export function useXlsxEditorEdits<TSnapshot = XlsxWorkbookSnapshot>(
  options: XlsxEditorEditsOptions<TSnapshot>,
): XlsxEditorEditsWiring {
  const {
    editor,
    coordinator,
    rendererHost,
    gridRef,
    gridReady,
    selection,
    formulaDraft,
    activeCell,
    canEdit,
    readOnly,
    visibleState,
    flushGridEdits,
    refreshSnapshot,
    recalcController,
    recalcProgress,
    recalcAbortRef,
    disposedRef,
    registerSavePreparation,
    setRecalcError,
    setRecalcFresh,
    setRecalcProgress,
  } = options;
  const { t } = useTranslation();

  const markDirty = useCallback(() => {
    coordinator.markDirty?.(editor.getDirtyGeneration());
    setRecalcFresh(false);
  }, [coordinator, editor, setRecalcFresh]);

  const commitCell = useCallback(async () => {
    if (!canEdit || !selection || formulaDraft === cellText(activeCell)) return;
    const text = formulaDraft;
    const gridSheet = rendererHost?.file.sheets.find((sheet) => sheet.name === selection.sheet);
    const position = addressParts(selection.address);
    if (gridReady && gridSheet && position) {
      gridRef.current?.setCellText(gridSheet.id, position.row, position.column, text);
      await flushGridEdits();
      return;
    }
    const op = cellEditOperation(selection.sheet, selection.address, text);
    await editor.edit?.([op]);
    markDirty();
    refreshSnapshot();
  }, [activeCell, canEdit, editor, formulaDraft, flushGridEdits, gridReady, gridRef, markDirty, refreshSnapshot, rendererHost, selection]);

  const undo = useCallback(() => {
    if (readOnly) return;
    // The vendored grid owns the live undo stack once it is mounted; the
    // adapter handle is the fallback for hosts without a render model.
    if (gridReady) { gridRef.current?.undo(); return; }
    editor.undo?.();
    markDirty();
    refreshSnapshot();
  }, [editor, gridReady, gridRef, markDirty, readOnly, refreshSnapshot]);

  const redo = useCallback(() => {
    if (readOnly) return;
    if (gridReady) { gridRef.current?.redo(); return; }
    editor.redo?.();
    markDirty();
    refreshSnapshot();
  }, [editor, gridReady, gridRef, markDirty, readOnly, refreshSnapshot]);

  const prepareSave = useCallback(async () => {
    try {
      if (rendererHost) await gridRef.current?.commitEdit();
      await commitCell();
      await flushGridEdits();
    } catch (error) {
      setRecalcError(t("office.xlsx.errors.editFailed"));
      throw error;
    }
  }, [commitCell, flushGridEdits, gridRef, rendererHost, setRecalcError, t]);
  useEffect(() => registerSavePreparation?.(prepareSave), [prepareSave, registerSavePreparation]);

  const save = useCallback((entryPoint: "button" | "shortcut" = "button") => {
    if (visibleState !== "ready" || readOnly) return;
    if (!rendererHost) { void coordinator.save(entryPoint); return; }
    void (async () => {
      if (!registerSavePreparation) await prepareSave();
      await coordinator.save(entryPoint);
    })().catch((error: unknown) => setRecalcError(error instanceof Error ? error.message : String(error)));
  }, [coordinator, prepareSave, readOnly, registerSavePreparation, rendererHost, setRecalcError, visibleState]);

  const recalculate = useCallback(async () => {
    if (!recalcController || readOnly || recalcProgress !== null) return;
    const controller = new AbortController();
    recalcAbortRef.current = controller;
    setRecalcError(null);
    setRecalcFresh(false);
    setRecalcProgress(0);
    try {
      await recalcController.run(controller.signal, (progress) => {
        if (!controller.signal.aborted) setRecalcProgress(Math.max(0, Math.min(100, Math.round(progress))));
      });
      if (controller.signal.aborted || disposedRef.current) return;
      refreshSnapshot();
      markDirty();
      setRecalcFresh(true);
      setRecalcProgress(100);
    } catch (error) {
      if (controller.signal.aborted) return;
      setRecalcError(error instanceof Error ? error.message : String(error));
      setRecalcProgress(null);
      setRecalcFresh(false);
    } finally {
      if (!controller.signal.aborted) {
        setRecalcProgress(null);
      }
      recalcAbortRef.current = null;
    }
  }, [disposedRef, markDirty, readOnly, recalcAbortRef, recalcController, recalcProgress, refreshSnapshot, setRecalcError, setRecalcFresh, setRecalcProgress]);

  const cancelRecalculate = useCallback(() => {
    const controller = recalcAbortRef.current;
    if (!controller) return;
    controller.abort();
    void recalcController?.cancel?.();
    recalcAbortRef.current = null;
    setRecalcProgress(null);
    setRecalcFresh(false);
    setRecalcError(t("office.xlsx.recalc.cancelled"));
  }, [recalcAbortRef, recalcController, setRecalcError, setRecalcFresh, setRecalcProgress, t]);

  return { markDirty, commitCell, undo, redo, prepareSave, save, recalculate, cancelRecalculate };
}
