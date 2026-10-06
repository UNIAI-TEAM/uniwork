"use client";

// FIX-EDITOR-SPLIT (UNI-926): the clipboard wiring (copy / paste / cut, the
// clipboard failure handler and the capability-folded permissions object)
// extracted from xlsx-editor.tsx. Bodies and effect ordering are byte-identical
// to the shell it replaces; the state setters and refs it closed over move to
// options.

import { useCallback, useMemo, type MutableRefObject } from "react";
import { useTranslation } from "react-i18next";
import type { XlsxWorkbookSnapshot } from "@uniwork/office-engine/xlsx";
import { toA1Address } from "./xlsx-render-model-bridge";
import type { XlsxGridHandle, XlsxGridHostPort } from "./xlsx-grid-surface";
import { clipboardCells, clipboardRows, selectionClipboardText } from "./xlsx-clipboard";
import { applyRichPaste, parseClipboardHtmlTable, planRichPaste, readClipboardHtml } from "./xlsx-clipboard-rich";
import { XLSX_CONTEXT_CLEAR_CONTENT_COMMAND } from "./context-menu/menu-items";
import { foldClipboardPermissions } from "./context-menu/use-context-menu";
import type { XlsxToolbarCommands } from "./toolbar/types";
import { addressParts, cellEditOperation } from "./xlsx-editor-model";
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

export interface XlsxEditorClipboardWiring {
  copy: () => Promise<void>;
  paste: () => Promise<void>;
  cut: () => Promise<void>;
  clipboardFailure: () => void;
  clipboardPermissions: XlsxEditorPermissions;
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

  const copy = useCallback(async () => {
    if (!selection || permissions.canCopy === false || !editor.clipboard?.writeText) return;
    await editor.clipboard.writeText(selectionClipboardText(snapshot, selection));
  }, [editor, permissions.canCopy, selection, snapshot]);

  const paste = useCallback(async () => {
    if (!selection || !canEdit || permissions.canPaste === false || !editor.clipboard?.readText) return;
    const session = mountRef.current;
    const text = await editor.clipboard.readText();
    if (disposedRef.current || mountRef.current !== session) return;
    const cells = clipboardCells(selection, text);
    setFormulaDraft(cells[0]?.text ?? "");
    const gridSheet = rendererHost?.file.sheets.find((sheet) => sheet.name === selection.sheet);
    const position = addressParts(selection.address);
    if (gridReady && gridSheet && position) {
      // Rich paste rides the live grid only: the formats are command writes.
      const html = await readClipboardHtml();
      if (disposedRef.current || mountRef.current !== session) return;
      const table = parseClipboardHtmlTable(html);
      const plan = table ? planRichPaste(position, table, clipboardRows(text)) : null;
      for (const cell of cells) gridRef.current?.setCellText(gridSheet.id, cell.row, cell.column, cell.text);
      await gridEdits.flush();
      if (plan === "over-limit") setRecalcError(t("office.xlsx.errors.richPasteValuesOnly"));
      else if (plan && rendererHost) {
        const applied = await applyRichPaste(gridCommands, `file-${rendererHost.file.sha256}`, gridSheet.id, plan);
        if (!applied && !disposedRef.current) setRecalcError(t("office.xlsx.errors.richPasteValuesOnly"));
      }
      return;
    }
    await editor.edit?.(cells.map((cell) => cellEditOperation(selection.sheet, toA1Address(cell.row, cell.column), cell.text)));
    markDirty();
    refreshSnapshot();
  }, [canEdit, disposedRef, editor, gridCommands, gridEdits, gridReady, gridRef, markDirty, mountRef, permissions.canPaste, refreshSnapshot, rendererHost, selection, setFormulaDraft, setRecalcError, t]);
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

  return { copy, paste, cut, clipboardFailure, clipboardPermissions };
}
