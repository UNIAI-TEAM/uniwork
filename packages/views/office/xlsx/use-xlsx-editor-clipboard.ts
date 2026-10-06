"use client";

// FIX-EDITOR-SPLIT (UNI-926): the clipboard wiring (copy / paste / cut, the
// clipboard failure handler and the capability-folded permissions object)
// extracted from xlsx-editor.tsx. Bodies and effect ordering are byte-identical
// to the shell it replaces; the state setters and refs it closed over move to
// options.

import { useCallback, useMemo, useState, type MutableRefObject } from "react";
import { useTranslation } from "react-i18next";
import type { XlsxWorkbookSnapshot } from "@uniwork/office-engine/xlsx";
import type { XlsxGridHandle, XlsxGridHostPort } from "./xlsx-grid-surface";
import { clipboardCells, clipboardRows, selectionClipboardText } from "./xlsx-clipboard";
import { parseClipboardHtmlTable, planRichPaste } from "./xlsx-clipboard-rich";
import { fallbackPasteOps, gridPasteSteps, readPasteClipboard, type XlsxPasteStep } from "./xlsx-clipboard-paste";
import { XLSX_CONTEXT_CLEAR_CONTENT_COMMAND } from "./context-menu/menu-items";
import { foldClipboardPermissions } from "./context-menu/use-context-menu";
import type { XlsxToolbarCommands } from "./toolbar/types";
import { addressParts } from "./xlsx-editor-model";
import type { XlsxEditorHandle, XlsxEditorPermissions, XlsxSelection } from "./types";

export interface XlsxEditorClipboardOptions<TSnapshot = XlsxWorkbookSnapshot> {
  editor: XlsxEditorHandle<TSnapshot>;
  permissions: XlsxEditorPermissions;
  selection: XlsxSelection | null;
  snapshot: XlsxWorkbookSnapshot | null;
  canEdit: boolean;
  readOnly: boolean;
  rendererHost: XlsxGridHostPort | undefined;
  gridReady: boolean;
  gridRef: MutableRefObject<XlsxGridHandle | null>;
  gridEdits: { flush: () => Promise<void> };
  gridCommands: XlsxToolbarCommands;
  mountRef: MutableRefObject<unknown>;
  disposedRef: MutableRefObject<boolean>;
  markDirty: () => void;
  refreshSnapshot: () => void;
  setFormulaDraft: (text: string) => void;
  setRecalcError: (message: string) => void;
}

/** A neutral frame notice: the paste worked, but something was not kept. */
export interface XlsxPasteNotice {
  message: string;
  dismiss: () => void;
}

export interface XlsxEditorClipboardWiring {
  copy: () => Promise<void>;
  paste: () => Promise<void>;
  cut: () => Promise<void>;
  clipboardFailure: () => void;
  clipboardPermissions: XlsxEditorPermissions;
  /** MINOR-5: rich-paste degradation goes to this info slot, never the red
   *  error banner - the paste itself succeeded. */
  pasteNotice: XlsxPasteNotice | null;
}

/** Runs the steps as one undo entry when the grid can batch; a handle
 *  without the batch member (a test double) runs them one by one. */
async function runSteps(grid: XlsxGridHandle | null, commands: XlsxToolbarCommands, steps: readonly XlsxPasteStep[]): Promise<boolean> {
  if (grid?.executeCommandsAsOneStep) return grid.executeCommandsAsOneStep(steps);
  for (const step of steps) {
    if (!(await commands.execute(step.id, step.params))) return false;
  }
  return true;
}

export function useXlsxEditorClipboard<TSnapshot = XlsxWorkbookSnapshot>(
  options: XlsxEditorClipboardOptions<TSnapshot>,
): XlsxEditorClipboardWiring {
  const {
    editor,
    permissions,
    selection,
    snapshot,
    canEdit,
    readOnly,
    rendererHost,
    gridReady,
    gridRef,
    gridEdits,
    gridCommands,
    mountRef,
    disposedRef,
    markDirty,
    refreshSnapshot,
    setFormulaDraft,
    setRecalcError,
  } = options;
  const { t } = useTranslation();
  const [pasteNoticeMessage, setPasteNoticeMessage] = useState<string | null>(null);

  const copy = useCallback(async () => {
    if (!selection || permissions.canCopy === false || !editor.clipboard?.writeText) return;
    await editor.clipboard.writeText(selectionClipboardText(snapshot, selection));
  }, [editor, permissions.canCopy, selection, snapshot]);

  const paste = useCallback(async () => {
    const port = editor.clipboard;
    if (!selection || !canEdit || permissions.canPaste === false || !port?.readText) return;
    const session = mountRef.current;
    const readText = port.readText.bind(port);
    // NIT-1: one clipboard read gives both the plain text and the HTML.
    const { text, html } = await readPasteClipboard({ readText });
    if (disposedRef.current || mountRef.current !== session) return;
    const cells = clipboardCells(selection, text);
    setFormulaDraft(cells[0]?.text ?? "");
    setPasteNoticeMessage(null);
    const position = addressParts(selection.address);
    if (!position) return;
    const rows = clipboardRows(text);
    const table = parseClipboardHtmlTable(html);
    const planned = table ? planRichPaste(position, table, rows) : null;
    const plan = planned === "over-limit" ? null : planned;
    const valuesOnly = t("office.xlsx.errors.richPasteValuesOnly");
    if (planned === "over-limit") setPasteNoticeMessage(valuesOnly);
    const gridSheet = rendererHost?.file.sheets.find((sheet) => sheet.name === selection.sheet);
    if (gridReady && gridSheet && rendererHost) {
      // MINOR-4: one set-range-values (values with their styles) plus the
      // merges, run as ONE undo step.
      const steps = gridPasteSteps(`file-${rendererHost.file.sha256}`, gridSheet.id, position, rows, plan);
      if (!(await runSteps(gridRef.current, gridCommands, steps))) {
        if (disposedRef.current || mountRef.current !== session) return;
        // A refusal (say a protected cell in the range) falls back to the
        // per-cell writes, which skip what may not be edited.
        for (const cell of cells) gridRef.current?.setCellText(gridSheet.id, cell.row, cell.column, cell.text);
        if (plan) setPasteNoticeMessage(valuesOnly);
      }
      await gridEdits.flush();
      return;
    }
    // The fallback surface: values, styles and merges in one edit batch.
    await editor.edit?.(fallbackPasteOps(selection.sheet, position, rows, plan));
    markDirty();
    refreshSnapshot();
  }, [canEdit, disposedRef, editor, gridCommands, gridEdits, gridReady, gridRef, markDirty, mountRef, permissions.canPaste, refreshSnapshot, rendererHost, selection, setFormulaDraft, t]);
  const pasteNotice = useMemo<XlsxPasteNotice | null>(
    () => (pasteNoticeMessage ? { message: pasteNoticeMessage, dismiss: () => setPasteNoticeMessage(null) } : null),
    [pasteNoticeMessage],
  );
  const clipboardFailure = useCallback(() => {
    if (!disposedRef.current) setRecalcError(t("office.xlsx.errors.clipboardFailed"));
  }, [disposedRef, setRecalcError, t]);

  // Cut = copy the selection, then clear its content through the allowlisted
  // clear command (no new op, no second save path). The clipboard write must
  // succeed before anything is cleared.
  const cut = useCallback(async () => {
    if (!selection || readOnly || !canEdit || permissions.canCopy === false || !editor.clipboard?.writeText) return;
    await editor.clipboard.writeText(selectionClipboardText(snapshot, selection));
    // Fire-and-forget clear: the port resolves false on a refusal/rejection, so
    // there is no unhandled rejection to surface here.
    void gridCommands.execute(XLSX_CONTEXT_CLEAR_CONTENT_COMMAND);
  }, [canEdit, editor, gridCommands, permissions.canCopy, readOnly, selection, snapshot]);

  // A9: one capability-folded permissions object feeds the toolbar and the
  // context menu, so Copy/Paste disable on exactly the same condition.
  const clipboardPermissions = useMemo(
    () => foldClipboardPermissions(permissions, editor.clipboard),
    [editor.clipboard, permissions],
  );

  return { copy, paste, cut, clipboardFailure, clipboardPermissions, pasteNotice };
}
