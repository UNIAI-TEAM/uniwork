"use client";

// FIX-EDITOR-SPLIT (UNI-926): the sheet-tab action dispatcher extracted from
// xlsx-editor.tsx. It keeps the pinned Univer command path as the single
// savability gate and the direct-op fallback for hosts without a mounted grid,
// exactly as the shell did - only the closed-over callbacks move to options.

import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  sheetActionOperation,
  XLSX_COPY_SHEET_COMMAND,
  XLSX_HIDE_SHEET_COMMAND,
  XLSX_INSERT_SHEET_COMMAND,
  XLSX_ORDER_SHEET_COMMAND,
  XLSX_REMOVE_SHEET_COMMAND,
  XLSX_RENAME_SHEET_COMMAND,
  XLSX_SHOW_SHEET_COMMAND,
  type XlsxSheetTabAction,
} from "./sheet-commands";
import type { XlsxToolbarCommands } from "./toolbar/types";

export interface XlsxEditorSheetCommandsOptions {
  canEdit: boolean;
  gridReady: boolean;
  gridCommands: XlsxToolbarCommands;
  gridSheetId: (sheetName: string) => string | undefined;
  edit: ((ops: readonly unknown[]) => Promise<void> | void) | undefined;
  markDirty: () => void;
  refreshSnapshot: () => void;
  refreshSheets: () => void;
  setRecalcError: (message: string) => void;
}

export function useXlsxEditorSheetCommands(options: XlsxEditorSheetCommandsOptions): (action: XlsxSheetTabAction) => void {
  const { canEdit, gridReady, gridCommands, gridSheetId, edit, markDirty, refreshSnapshot, refreshSheets, setRecalcError } = options;
  const { t } = useTranslation();

  // Sheet-tab actions: the pinned Univer command path when the grid is live
  // (its policy gate stays the single savability gate and the mutation is
  // captured into the same envelope op); the direct op path otherwise, where
  // the host's runtime model applies it to the snapshot.
  const runSheetAction = useCallback((action: XlsxSheetTabAction): void => {
    if (!canEdit) return;
    // Chosen semantic (B2 r5): fail-closed. With the renderer mounted the
    // pinned command path is the single savability gate, so a command that
    // resolves false surfaces a failure and the direct-op fallback is NOT
    // retried - the fallback would bypass the policy gate. Only when there is
    // no mounted renderer (or no live sheet id to address) is there no command
    // path to gate on, so the fallback applies the op to the snapshot as before.
    const fallback = (): void => {
      void Promise.resolve(edit?.([sheetActionOperation(action)]))
        .then(() => { markDirty(); refreshSnapshot(); })
        .catch((error: unknown) => setRecalcError(error instanceof Error ? error.message : String(error)));
    };
    // The port resolves a real boolean (a rejection resolves false at the
    // boundary); a resolved false is a refused/failed command, never silence.
    const dispatch = (id: string, params: unknown): void => {
      void Promise.resolve(gridCommands.execute(id, params))
        .then((executed) => { if (!executed) setRecalcError(t("office.xlsx.errors.editFailed")); })
        .catch((error: unknown) => setRecalcError(error instanceof Error ? error.message : String(error)));
    };
    if (!gridReady) {
      fallback();
      refreshSheets();
      return;
    }
    switch (action.kind) {
      case "add":
        dispatch(XLSX_INSERT_SHEET_COMMAND, { sheet: { name: action.name } });
        break;
      case "duplicate": {
        const id = gridSheetId(action.sheet);
        if (id === undefined) { fallback(); break; }
        dispatch(XLSX_COPY_SHEET_COMMAND, { subUnitId: id });
        break;
      }
      case "rename": {
        const id = gridSheetId(action.sheet);
        if (id === undefined) { fallback(); break; }
        dispatch(XLSX_RENAME_SHEET_COMMAND, { subUnitId: id, name: action.newName });
        break;
      }
      case "remove": {
        const id = gridSheetId(action.sheet);
        if (id === undefined) { fallback(); break; }
        dispatch(XLSX_REMOVE_SHEET_COMMAND, { subUnitId: id });
        break;
      }
      case "move": {
        const id = gridSheetId(action.sheet);
        if (id === undefined) { fallback(); break; }
        dispatch(XLSX_ORDER_SHEET_COMMAND, { subUnitId: id, order: action.index });
        break;
      }
      case "set-hidden": {
        const id = gridSheetId(action.sheet);
        const command = action.hidden ? XLSX_HIDE_SHEET_COMMAND : XLSX_SHOW_SHEET_COMMAND;
        if (id === undefined) { fallback(); break; }
        dispatch(command, { subUnitId: id });
        break;
      }
    }
    refreshSheets();
  }, [canEdit, edit, gridCommands, gridReady, gridSheetId, markDirty, refreshSheets, refreshSnapshot, setRecalcError, t]);

  return runSheetAction;
}
