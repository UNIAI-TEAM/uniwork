"use client";

/* eslint-disable jsx-a11y/no-noninteractive-element-interactions -- the editor application landmark owns host shortcuts */

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@uniwork/ui/lib/utils";
import type { XlsxWorkbookSnapshot } from "@uniwork/office-engine/xlsx";
import { XlsxErrorState } from "./xlsx-error-state";
import { XlsxFindPanel } from "./find/find-panel";
import { XlsxAdvancedFilterDialog } from "./filter/advanced-filter-dialog";
import { XlsxFunctionLibraryMount } from "./formulas/function-library";
import { XlsxFormulaBar } from "./formulas/formula-bar";
import { useXlsxPageSetup } from "./page-setup/use-page-setup";
import { useXlsxProtectNames } from "./protect/use-protect-names";
import { XlsxGridSurface, type XlsxGridHandle, type XlsxGridSheetInfo } from "./xlsx-grid-surface";
import { toA1Address } from "./xlsx-render-model-bridge";
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
import { XlsxSheetTabs } from "./sheet-tabs";
import { XlsxStatusBar } from "./status-bar";
import { XLSX_CONTEXT_CLEAR_CONTENT_COMMAND } from "./context-menu/menu-items";
import { foldClipboardPermissions, useXlsxContextMenu } from "./context-menu/use-context-menu";
import { useXlsxCatalogShortcuts } from "./shortcuts/use-catalog-shortcuts";
import { XlsxShortcutsDialog } from "./shortcuts/shortcuts-dialog";
import { XlsxToolbar } from "./xlsx-toolbar";
import { useXlsxGridFormat } from "./toolbar/use-xlsx-grid-format";
import { addressParts, cellEditOperation, cellText, columnLabel, isSnapshot, snapshotForEditor } from "./xlsx-editor-model";
import { useXlsxGridEdits } from "./use-xlsx-grid-edits";
import { clipboardCells, selectionClipboardText } from "./xlsx-clipboard";
import type {
  XlsxEditorProps,
  XlsxOpenFailure,
  XlsxOpenOutcome,
  XlsxSelection,
  XlsxViewState,
} from "./types";

function unexpectedFailure(documentId: string, error: unknown): XlsxOpenFailure {
  return {
    outcome: "failed",
    document_id: documentId,
    format: "xlsx",
    failure_class: "engine_error",
    message: error instanceof Error ? error.message : String(error),
  };
}

function isFailure(outcome: XlsxOpenOutcome): outcome is XlsxOpenFailure {
  return outcome.outcome === "failed";
}

/** XLSX format view. The host supplies the G2 browser adapter through the
 * EditorHandle; this component never imports a Node binding or writes bytes. */
export function XlsxEditor<TSnapshot = XlsxWorkbookSnapshot>({
  documentKey,
  editor,
  open,
  coordinator,
  rendererHost,
  capability,
  permissions = {},
  title,
  embedded = false,
  className,
  onOpen,
  onViewStateChange,
  onSelectionChange,
  registerSavePreparation,
}: XlsxEditorProps<TSnapshot>) {
  const { t } = useTranslation();
  const [viewState, setViewState] = useState<XlsxViewState>("opening");
  const [failure, setFailure] = useState<XlsxOpenFailure | null>(null);
  const [snapshot, setSnapshot] = useState<XlsxWorkbookSnapshot | null>(null);
  const [activeSheet, setActiveSheet] = useState<string | null>(null);
  const [selection, setSelection] = useState<XlsxSelection | null>(null);
  const [formulaDraft, setFormulaDraft] = useState("");
  const [coordinatorState, setCoordinatorState] = useState(() => coordinator.getState());
  const [recalcProgress, setRecalcProgress] = useState<number | null>(null);
  const [recalcError, setRecalcError] = useState<string | null>(null);
  const [recalcFresh, setRecalcFresh] = useState(false);
  const disposedRef = useRef(false);
  const openAttemptRef = useRef<(() => void) | null>(null);
  const openAbortRef = useRef<AbortController | null>(null);
  const recalcAbortRef = useRef<AbortController | null>(null);
  const sheetTabsRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<XlsxGridHandle | null>(null);
  const [gridReady, setGridReady] = useState(false);
  // F1: the mounted grid's active sheet id. A session rename keeps the id
  // but changes the name, so the id is the stable key the strip resolves
  // the live name through (the snapshot keeps file names all session).
  const [activeSheetId, setActiveSheetId] = useState<string | null>(null);
  // The right-click context menu and the shortcuts help dialog are UI-only.
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [dark, setDark] = useState(() => typeof document !== "undefined" && document.documentElement.classList.contains("dark"));
  const translationRef = useRef(t);
  const sessionPropsRef = useRef({ editor, open, coordinator, capability, onOpen });
  const mountRef = useRef<{ documentKey: string; editor: XlsxEditorProps<TSnapshot>["editor"]; replayed: boolean } | null>(null);
  translationRef.current = t;
  sessionPropsRef.current = { editor, open, coordinator, capability, onOpen };

  const readOnly = permissions.canEdit === false || rendererHost?.file.readOnly === true || (capability !== undefined && capability.status !== "available");
  const effectiveTitle = title ?? t("office.xlsx.title");
  const activeSheetModel = snapshot?.sheets.find((sheet) => sheet.name === activeSheet) ?? snapshot?.sheets[0];
  const activeCell = selection && activeSheetModel?.name === selection.sheet ? activeSheetModel.cells[selection.address] : undefined;
  const canEdit = typeof editor.edit === "function" && !readOnly;
  const recalcController = editor.recalculate;
  const rendererLoading = viewState === "ready" && rendererHost !== undefined && !gridReady;
  const visibleState = rendererLoading ? "opening" : viewState;

  useEffect(() => { onViewStateChange?.(visibleState); }, [onViewStateChange, visibleState]);

  const refreshSnapshot = useCallback(() => {
    const next = editor.getWorkbookSnapshot?.();
    if (isSnapshot(next)) setSnapshot(next);
  }, [editor]);
  const gridEdits = useXlsxGridEdits(documentKey, editor, coordinator, rendererHost, canEdit, refreshSnapshot);
  const flushGridEdits = gridEdits.flush;
  // One port for the toolbar: it reaches the mounted renderer only, and the
  // renderer's policy gate keeps every command savable or refused.
  const { formatState, refreshFormatState, commands: gridCommands } = useXlsxGridFormat(gridRef);
  // The find panel needs the renderer host for its bounded cell reads, so the
  // editor owns its visibility and the Home-tab group only opens it.
  const [findOpen, setFindOpen] = useState(false);
  // Same ownership for the Advanced Filter dialog: its column provider reads
  // the selection's header row through the renderer host.
  const [advancedFilterOpen, setAdvancedFilterOpen] = useState(false);
  // Same ownership for the Function Library dialog: it inserts into the active
  // cell through the toolbar's command port.
  const [functionLibraryOpen, setFunctionLibraryOpen] = useState(false);
  // Live sheet list (tab order, names, hidden) for the sheet-tab strip: the
  // mounted grid's own state, so a session rename/add/reorder is reflected the
  // moment it happens. Empty without a grid (the snapshot drives the strip).
  const [liveSheets, setLiveSheets] = useState<readonly XlsxGridSheetInfo[]>([]);
  const refreshSheets = useCallback(() => {
    setLiveSheets(gridRef.current?.getSheets?.() ?? []);
  }, [gridRef]);

  useEffect(() => {
    const observer = new MutationObserver(() => setDark(document.documentElement.classList.contains("dark")));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setCoordinatorState(coordinator.getState());
    return coordinator.subscribe(setCoordinatorState);
  }, [coordinator, documentKey]);

  useEffect(() => {
    const selectionPort = editor.selection;
    if (!selectionPort) {
      setSelection(null);
      onSelectionChange?.(null);
      return undefined;
    }
    const emit = (next: XlsxSelection | null) => {
      setSelection(next);
      setActiveSheet(next?.sheet ?? null);
      onSelectionChange?.(next);
    };
    emit(selectionPort.getSelection());
    return selectionPort.subscribe?.(emit);
  }, [documentKey, editor, onSelectionChange]);

  useEffect(() => {
    const subscribe = editor.subscribeSnapshot;
    if (!subscribe) return undefined;
    return subscribe((next) => {
      setSnapshot(next);
      setActiveSheet((current) => next.sheets.some((sheet) => sheet.name === current) ? current : next.sheets[0]?.name ?? null);
    });
  }, [editor]);

  useEffect(() => {
    const cleanupSession = sessionPropsRef.current;
    if (mountRef.current?.documentKey === documentKey && mountRef.current.editor === cleanupSession.editor) {
      mountRef.current.replayed = true;
    }
    const mount = { documentKey, editor: cleanupSession.editor, replayed: false };
    mountRef.current = mount;
    disposedRef.current = false;

    const run = async () => {
      // Open/coordinator callbacks may refresh without replacing the model;
      // a genuinely new editor handle must open even for the same document.
      const session = sessionPropsRef.current;
      openAbortRef.current?.abort();
      const controller = new AbortController();
      openAbortRef.current = controller;
      setViewState("opening");
      setFailure(null);
      setSnapshot(null);
      setGridReady(false);
      setRecalcError(null);
      setRecalcFresh(false);

      if (session.capability !== undefined && !["available", "readonly"].includes(session.capability.status)) {
        const blocked: XlsxOpenFailure = {
          outcome: "failed",
          document_id: documentKey,
          format: "xlsx",
          failure_class: "unsupported_feature",
          message: session.capability.reason ?? translationRef.current("office.xlsx.errors.capabilityUnavailable"),
        };
        setFailure(blocked);
        setViewState("error");
        session.onOpen?.(blocked);
        if (openAbortRef.current === controller) openAbortRef.current = null;
        return;
      }
      try {
        const outcome = await session.open.open(controller.signal);
        if (controller.signal.aborted || disposedRef.current) return;
        session.onOpen?.(outcome);
        if (isFailure(outcome)) {
          setFailure(outcome);
          setViewState("error");
          return;
        }
        await session.editor.open();
        if (controller.signal.aborted || disposedRef.current) return;
        const openedSnapshot = snapshotForEditor(session.editor, outcome);
        setSnapshot(openedSnapshot);
        setActiveSheet(openedSnapshot?.sheets[0]?.name ?? null);
        setViewState("ready");
      } catch (error) {
        if (controller.signal.aborted || disposedRef.current) return;
        const next = unexpectedFailure(documentKey, error);
        setFailure(next);
        setViewState("error");
        session.onOpen?.(next);
      } finally {
        if (openAbortRef.current === controller) openAbortRef.current = null;
      }
    };

    openAttemptRef.current = () => { void run(); };
    void run();
    return () => {
      disposedRef.current = true;
      openAbortRef.current?.abort();
      openAbortRef.current = null;
      recalcAbortRef.current?.abort();
      recalcAbortRef.current = null;
      // React replays effects in development. A replay of these same ports
      // cancels this queued release; real unmount/document changes release them.
      queueMicrotask(() => {
        if (mount.replayed) return;
        void cleanupSession.editor.cancel?.("document_changed");
        void cleanupSession.coordinator.cancel?.();
        void cleanupSession.editor.dispose();
        if (mountRef.current === mount) mountRef.current = null;
      });
      openAttemptRef.current = null;
    };
  }, [documentKey, editor]);

  useEffect(() => {
    setFormulaDraft(cellText(activeCell));
  }, [activeCell, selection?.address, selection?.sheet]);

  const selectCell = useCallback((next: XlsxSelection) => {
    setSelection(next);
    setActiveSheet(next.sheet);
    editor.selection?.setSelection?.(next);
    onSelectionChange?.(next);
  }, [editor.selection, onSelectionChange]);

  // The live grid id wins over the host file's id map: a session rename keeps
  // the id but changes the name, so the file lookup goes stale.
  const gridSheetId = useCallback((sheetName: string): string | undefined =>
    gridRef.current?.getSheets?.().find((sheet) => sheet.name === sheetName)?.id ??
    rendererHost?.file.sheets.find((sheet) => sheet.name === sheetName)?.id,
  [rendererHost]);

  const selectSheet = useCallback((sheetName: string) => {
    setActiveSheet(sheetName);
    const rendererSheetId = gridSheetId(sheetName);
    setActiveSheetId(rendererSheetId ?? null);
    if (gridReady && rendererSheetId) { gridRef.current?.selectSheet(rendererSheetId); return; }
    if (selection?.sheet === sheetName) return;
    const sheet = snapshot?.sheets.find((candidate) => candidate.name === sheetName);
    const firstAddress = sheet
      ? Object.keys(sheet.cells)
        .map((address) => ({ address, parts: addressParts(address) }))
        .filter((cell): cell is { address: string; parts: { row: number; column: number } } => cell.parts !== null)
        .sort((left, right) => left.parts.row - right.parts.row || left.parts.column - right.parts.column)[0]?.address
      : undefined;
    const next = { sheet: sheetName, address: firstAddress ?? "A1" };
    setSelection(next);
    onSelectionChange?.(next);
    if (next) editor.selection?.setSelection?.(next);
  }, [editor.selection, gridReady, gridSheetId, onSelectionChange, selection?.sheet, snapshot]);

  const markDirty = useCallback(() => {
    coordinator.markDirty?.(editor.getDirtyGeneration());
    setRecalcFresh(false);
  }, [coordinator, editor]);

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
      void Promise.resolve(editor.edit?.([sheetActionOperation(action)]))
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
  }, [canEdit, editor, gridCommands, gridReady, gridSheetId, markDirty, refreshSheets, refreshSnapshot, t]);

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
  }, [activeCell, canEdit, editor, formulaDraft, flushGridEdits, gridReady, markDirty, refreshSnapshot, rendererHost, selection]);

  const undo = useCallback(() => {
    if (readOnly) return;
    // The vendored grid owns the live undo stack once it is mounted; the
    // adapter handle is the fallback for hosts without a render model.
    if (gridReady) { gridRef.current?.undo(); return; }
    editor.undo?.();
    markDirty();
    refreshSnapshot();
  }, [editor, gridReady, markDirty, readOnly, refreshSnapshot]);

  const redo = useCallback(() => {
    if (readOnly) return;
    if (gridReady) { gridRef.current?.redo(); return; }
    editor.redo?.();
    markDirty();
    refreshSnapshot();
  }, [editor, gridReady, markDirty, readOnly, refreshSnapshot]);

  const prepareSave = useCallback(async () => {
    try {
      if (rendererHost) await gridRef.current?.commitEdit();
      await commitCell();
      await flushGridEdits();
    } catch (error) {
      setRecalcError(t("office.xlsx.errors.editFailed"));
      throw error;
    }
  }, [commitCell, flushGridEdits, rendererHost, t]);
  useEffect(() => registerSavePreparation?.(prepareSave), [prepareSave, registerSavePreparation]);

  const save = useCallback((entryPoint: "button" | "shortcut" = "button") => {
    if (visibleState !== "ready" || readOnly) return;
    if (!rendererHost) { void coordinator.save(entryPoint); return; }
    void (async () => {
      if (!registerSavePreparation) await prepareSave();
      await coordinator.save(entryPoint);
    })().catch((error: unknown) => setRecalcError(error instanceof Error ? error.message : String(error)));
  }, [coordinator, prepareSave, readOnly, registerSavePreparation, rendererHost, visibleState]);

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
  }, [markDirty, readOnly, recalcController, recalcProgress, refreshSnapshot]);

  const cancelRecalculate = useCallback(() => {
    const controller = recalcAbortRef.current;
    if (!controller) return;
    controller.abort();
    void recalcController?.cancel?.();
    recalcAbortRef.current = null;
    setRecalcProgress(null);
    setRecalcFresh(false);
    setRecalcError(t("office.xlsx.recalc.cancelled"));
  }, [recalcController, t]);

  const copy = useCallback(async () => {
    if (!selection || permissions.canCopy === false || !editor.clipboard?.writeText) return;
    await editor.clipboard.writeText(selectionClipboardText(snapshot, selection));
  }, [editor.clipboard, permissions.canCopy, selection, snapshot]);

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
      for (const cell of cells) gridRef.current?.setCellText(gridSheet.id, cell.row, cell.column, cell.text);
      await gridEdits.flush();
      return;
    }
    await editor.edit?.(cells.map((cell) => cellEditOperation(selection.sheet, toA1Address(cell.row, cell.column), cell.text)));
    markDirty();
    refreshSnapshot();
  }, [canEdit, editor, gridEdits, gridReady, markDirty, permissions.canPaste, refreshSnapshot, rendererHost, selection]);
  const clipboardFailure = useCallback(() => {
    if (!disposedRef.current) setRecalcError(t("office.xlsx.errors.clipboardFailed"));
  }, [t]);

  // Cut = copy the selection, then clear its content through the allowlisted
  // clear command (no new op, no second save path). The clipboard write must
  // succeed before anything is cleared.
  const cut = useCallback(async () => {
    if (!selection || readOnly || !canEdit || permissions.canCopy === false || !editor.clipboard?.writeText) return;
    await editor.clipboard.writeText(selectionClipboardText(snapshot, selection));
    // Fire-and-forget clear: the port resolves false on a refusal/rejection, so
    // there is no unhandled rejection to surface here.
    void gridCommands.execute(XLSX_CONTEXT_CLEAR_CONTENT_COMMAND);
  }, [canEdit, editor.clipboard, gridCommands, permissions.canCopy, readOnly, selection, snapshot]);

  // A9: one capability-folded permissions object feeds the toolbar and the
  // context menu, so Copy/Paste disable on exactly the same condition.
  const clipboardPermissions = useMemo(
    () => foldClipboardPermissions(permissions, editor.clipboard),
    [editor.clipboard, permissions],
  );

  // The grid context menu (A9): the hook owns the anchor point, the disabled
  // state and the focus return; every item dispatches through the same port and
  // callbacks as the toolbar.
  const contextMenu = useXlsxContextMenu({
    readOnly,
    selection,
    canFormat: gridReady && selection !== null,
    commands: gridCommands,
    permissions: clipboardPermissions,
    canCut: canEdit && permissions.canCopy !== false && typeof editor.clipboard?.writeText === "function",
    canFind: rendererHost !== undefined,
    unitId: rendererHost ? `file-${rendererHost.file.sha256}` : null,
    resolveSheetId: gridSheetId,
    onCut: () => { void cut().catch(clipboardFailure); },
    onCopy: () => { void copy().catch(clipboardFailure); },
    onPaste: () => { void paste().catch(clipboardFailure); },
    onFind: () => setFindOpen(true),
  });

  // Page Setup, Print and Export CSV (C2): the hook owns the dialog state,
  // the set_page_setup op and the two host actions; see page-setup/.
  const pageSetup = useXlsxPageSetup({
    host: rendererHost,
    selection,
    activeSheet,
    readOnly,
    canEdit,
    edit: editor.edit,
    getSnapshot: editor.getWorkbookSnapshot,
    onApplied: () => { markDirty(); refreshSnapshot(); },
    onError: setRecalcError,
  });

  // F1/F4: resolve the active sheet through the LIVE name before any action
  // reads it. A session rename keeps the grid id but changes the name, so the
  // raw activeSheet may already have fallen back to sheets[0] - the hazard
  // useXlsxPageSetup shields with selection?.sheet. Protect/name actions read
  // this resolved value so they cannot aim at the wrong sheet.
  const resolvedActiveSheet = (activeSheetId !== null ? liveSheets.find((sheet) => sheet.id === activeSheetId)?.name : undefined) ?? activeSheet;

  // Sheet protection + the name manager (B7): the hook owns the dialog state
  // and the two new ops; see protect/.
  const protectNames = useXlsxProtectNames({
    activeSheet: resolvedActiveSheet,
    readOnly,
    canEdit,
    // F1/F5: the file's own names seed the manager; the live sheet order bounds
    // the scope dropdown. Both come from the open render model / mounted grid.
    definedNames: rendererHost?.file.definedNames,
    sheetNames: (liveSheets.length > 0 ? liveSheets.map((sheet) => sheet.name) : (snapshot?.sheets ?? []).map((sheet) => sheet.name)),
    edit: editor.edit,
    onApplied: () => { markDirty(); refreshSnapshot(); },
    onError: setRecalcError,
  });

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
  }, [captureSave, documentKey, editor]);

  // Tab colours have no write path in the vendored gateway: they are shown
  // read-only from the render model (the only reader of <tabColor>).
  const sheetTabInfos = useMemo(() => {
    // F7: tab colour is keyed by the stable sheet id, not the file name, so
    // a renamed sheet keeps its colour chip until the next save reloads it.
    // `sheets` is derived inside the memo so the snapshot sheet list - not a
    // per-render logical expression - is the dependency.
    const sheets = snapshot?.sheets ?? [];
    const colors = new Map((rendererHost?.file.sheets ?? []).map((sheet) => [sheet.id, sheet.tabColor]));
    const source = liveSheets.length > 0
      ? liveSheets.map((sheet) => ({ id: sheet.id, name: sheet.name, hidden: sheet.hidden }))
      : sheets.map((sheet) => ({ id: sheet.id, name: sheet.name, hidden: sheet.hidden ?? false }));
    return source.map((sheet) => ({ name: sheet.name, hidden: sheet.hidden, tabColor: colors.get(sheet.id) ?? null }));
  }, [liveSheets, rendererHost, snapshot?.sheets]);
  // A9 r3/r4: bind the catalog keys the pinned UI does not (Ctrl+F, Shift+F11,
  // Ctrl+PageUp/Down, and the redo alternate chord Ctrl+Shift+Z - upstream
  // binds only Ctrl+Y).
  useXlsxCatalogShortcuts({
    enabled: viewState === "ready",
    rootRef,
    documentKey,
    canFind: rendererHost !== undefined,
    canEdit,
    canRedo: gridReady || typeof editor.redo === "function",
    sheets: sheetTabInfos,
    activeSheet: resolvedActiveSheet,
    defaultSheetName: t("office.xlsx.sheets.defaultName"),
    onOpenFind: () => setFindOpen(true),
    onInsertSheet: (name) => runSheetAction({ kind: "add", name }),
    onSelectSheet: selectSheet,
    onRedo: redo,
  });

  const cells = useMemo(() => activeSheetModel?.cells ?? {}, [activeSheetModel]);
  const visibleAddresses = useMemo(() => Object.keys(cells).map((address) => ({ address, parts: addressParts(address) })).filter((cell): cell is { address: string; parts: { row: number; column: number } } => cell.parts !== null), [cells]);
  const maxRow = visibleAddresses.reduce((max, cell) => Math.max(max, cell.parts.row), 0);
  const maxColumn = visibleAddresses.reduce((max, cell) => Math.max(max, cell.parts.column), 0);
  const dirty = coordinatorState.state === "dirty" || coordinatorState.dirtyGeneration > coordinatorState.lastSavedGeneration;
  const saving = coordinatorState.state === "saving";

  return (
    <div ref={rootRef} className={cn("flex min-h-0 flex-1 flex-col bg-background", className)} data-testid="xlsx-editor" data-document-key={documentKey} onKeyDown={keyboardHandler} role="application" aria-busy={visibleState === "opening"} tabIndex={-1}>
      {!embedded ? <header className="flex min-h-11 items-center justify-between gap-3 border-b border-border px-3 py-2">
        <h1 className="min-w-0 truncate text-title font-semibold">{effectiveTitle}</h1>
        <span className="text-caption text-muted-foreground" data-testid="xlsx-open-state">
          {visibleState === "opening" ? t("office.xlsx.state.opening") : visibleState === "ready" ? t(`office.xlsx.saveState.${coordinatorState.state}`) : t("office.xlsx.state.error")}
        </span>
      </header> : <span className="sr-only" data-testid="xlsx-open-state" role="status">{visibleState === "opening" ? t("office.xlsx.state.opening") : visibleState === "ready" ? t(`office.xlsx.saveState.${coordinatorState.state}`) : t("office.xlsx.state.error")}</span>}
      {viewState === "ready" ? (
        <>
          <XlsxToolbar
            coordinator={coordinator}
            showSave={!embedded}
            dirty={dirty}
            saving={saving}
            readOnly={readOnly || rendererLoading}
            permissions={clipboardPermissions}
            selection={selection}
            canUndo={gridReady || typeof editor.undo === "function"}
            canRedo={gridReady || typeof editor.redo === "function"}
            canRecalculate={recalcController !== undefined}
            canFormat={gridReady && selection !== null}
            commands={gridCommands}
            formatState={formatState}
            onNumberFormat={() => gridRef.current?.setNumberFormat("0.00")}
            recalculating={recalcProgress !== null}
            onUndo={undo}
            onRedo={redo}
            onRecalculate={recalculate}
            onCopy={() => { void copy().catch(clipboardFailure); }}
            onPaste={() => { void paste().catch(clipboardFailure); }}
            onShowSheets={() => sheetTabsRef.current?.focus()}
            onOpenFind={rendererHost ? () => setFindOpen(true) : undefined}
            onOpenAdvancedFilter={rendererHost ? () => setAdvancedFilterOpen(true) : undefined}
            onOpenProtect={rendererHost ? protectNames.openProtect : undefined}
            onOpenPageSetup={rendererHost ? pageSetup.openPageSetup : undefined}
            onPrint={rendererHost ? pageSetup.print : undefined}
            onExportCsv={rendererHost ? pageSetup.exportCsv : undefined}
            host={rendererHost}
            unitId={rendererHost ? `file-${rendererHost.file.sha256}` : null}
            sheetName={selection?.sheet ?? activeSheet}
            resolveSheetId={gridSheetId}
            onOpenFunctionLibrary={rendererHost ? () => setFunctionLibraryOpen(true) : undefined}
            onOpenShortcuts={rendererHost ? () => setShortcutsOpen(true) : undefined}
            onSave={() => save("button")}
            onCancelSave={coordinator.cancel ? () => { void coordinator.cancel?.().catch((error: unknown) => setRecalcError(error instanceof Error ? error.message : String(error))); } : undefined}
          />
          {rendererHost && findOpen ? (
            <XlsxFindPanel
              documentKey={documentKey}
              host={rendererHost}
              commands={gridCommands}
              selection={selection}
              sheetName={selection?.sheet ?? activeSheet}
              dirtyGeneration={coordinatorState.dirtyGeneration}
              readOnly={readOnly}
              onClose={() => setFindOpen(false)}
            />
          ) : null}
          {rendererHost && advancedFilterOpen ? (
            <XlsxAdvancedFilterDialog
              documentKey={documentKey}
              host={rendererHost}
              commands={gridCommands}
              selection={selection}
              readOnly={readOnly}
              onClose={() => setAdvancedFilterOpen(false)}
            />
          ) : null}
          <XlsxFunctionLibraryMount
            open={functionLibraryOpen}
            host={rendererHost}
            commands={gridCommands}
            selection={selection}
            resolveSheetId={gridSheetId}
            readOnly={readOnly}
            onClose={() => setFunctionLibraryOpen(false)}
          />
          {protectNames.dialog}
          {pageSetup.dialog}
          {shortcutsOpen ? <XlsxShortcutsDialog onClose={() => setShortcutsOpen(false)} /> : null}
          {contextMenu.node}
          {recalcProgress !== null ? (
            <div className="flex items-center gap-2 border-b border-border bg-muted/20 px-3 py-1 text-caption" data-testid="xlsx-recalc-progress" role="status">
              <span>{t("office.xlsx.recalc.progress", { progress: recalcProgress })}</span>
              <progress max={100} value={recalcProgress} aria-label={t("office.xlsx.recalc.progress", { progress: recalcProgress })} />
              <button type="button" className="text-primary underline" onClick={cancelRecalculate} data-testid="xlsx-recalc-cancel">{t("office.xlsx.recalc.cancel")}</button>
            </div>
          ) : null}
          {recalcError ? <p className="border-b border-destructive/30 bg-destructive/10 px-3 py-1 text-caption text-destructive" role="alert" data-testid="xlsx-recalc-error">{recalcError}</p> : null}
          {gridEdits.error ? <p className="border-b border-destructive/30 px-3 py-1 text-caption text-destructive" role="alert" data-testid="xlsx-edit-error">{t("office.xlsx.errors.editFailed")}</p> : null}
          {recalcFresh ? <p className="sr-only" role="status">{t("office.xlsx.recalc.fresh")}</p> : null}
          <div className="flex min-h-0 flex-1 flex-col" data-testid="xlsx-canvas">
            <div ref={sheetTabsRef} tabIndex={-1} className="outline-none">
              <XlsxSheetTabs
                tabs={sheetTabInfos}
                activeSheet={resolvedActiveSheet}
                canEdit={canEdit}
                onSelect={selectSheet}
                onAction={runSheetAction}
              />
            </div>
            <XlsxFormulaBar
              value={formulaDraft}
              disabled={!canEdit || selection === null}
              onChange={setFormulaDraft}
              onCommit={() => { void commitCell().catch((error: unknown) => setRecalcError(error instanceof Error ? error.message : String(error))); }}
            />
            {rendererHost ? (
              <XlsxGridSurface
                ref={gridRef}
                documentKey={documentKey}
                host={rendererHost}
                dark={dark}
                readOnly={readOnly || !canEdit}
                onContextMenu={contextMenu.open}
                onEdits={(edits) => { gridEdits.onEdits(edits); refreshFormatState(); refreshSheets(); }}
                onReady={() => { setGridReady(true); refreshFormatState(); refreshSheets(); }}
                onFailure={(message) => {
                  const failureValue: XlsxOpenFailure = {
                    outcome: "failed",
                    document_id: documentKey,
                    format: "xlsx",
                    failure_class: "engine_error",
                    message,
                  };
                  setFailure(failureValue);
                  setViewState("error");
                }}
                onSelectionChange={(next) => {
                  if (!next) {
                    setSelection(null);
                    onSelectionChange?.(null);
                  } else {
                    // The live grid sheet list wins: a session rename changed
                    // the name while the host file's id map kept the old one.
                    const sheetName = gridRef.current?.getSheets?.().find((sheet) => sheet.id === next.sheetId)?.name
                      ?? rendererHost.file.sheets.find((candidate) => candidate.id === next.sheetId)?.name;
                    const nextSelection: XlsxSelection = {
                      sheet: sheetName ?? next.sheetId,
                      address: toA1Address(next.range.startRow, next.range.startColumn),
                      ...(next.range.startRow !== next.range.endRow || next.range.startColumn !== next.range.endColumn ? { endAddress: toA1Address(next.range.endRow, next.range.endColumn) } : {}),
                    };
                    setSelection(nextSelection);
                    setActiveSheet(nextSelection.sheet);
                    setActiveSheetId(next.sheetId);
                    editor.selection?.setSelection?.(nextSelection);
                    onSelectionChange?.(nextSelection);
                  }
                  refreshFormatState();
                  refreshSheets();
                }}
              />
            ) : (
            <div className="min-h-64 flex-1 overflow-auto bg-muted/20 p-3" data-testid="xlsx-workbook-surface">
              {activeSheetModel ? (
                <table className="border-collapse text-caption" aria-label={t("office.xlsx.surface.table", { sheet: activeSheetModel.name })}>
                  <thead><tr><th className="sticky left-0 border border-border bg-muted px-2 py-1" aria-hidden />{Array.from({ length: maxColumn + 1 }, (_, column) => <th key={column} className="border border-border bg-muted px-3 py-1 font-medium">{columnLabel(column)}</th>)}</tr></thead>
                  <tbody>{Array.from({ length: maxRow + 1 }, (_, row) => <tr key={row}><th className="sticky left-0 border border-border bg-muted px-2 py-1 font-medium">{row + 1}</th>{Array.from({ length: maxColumn + 1 }, (_, column) => { const address = `${columnLabel(column)}${row + 1}`; const value = activeSheetModel.cells[address]; const selected = selection?.sheet === activeSheetModel.name && selection.address === address; return <td key={address} className={cn("min-w-24 border border-border bg-background p-0", selected && "ring-2 ring-primary ring-inset")}><button type="button" className="block min-h-8 w-full px-2 text-left" aria-label={`${activeSheetModel.name} ${address}`} aria-pressed={selected} data-testid={`xlsx-cell-${activeSheetModel.name}-${address}`} onClick={() => selectCell({ sheet: activeSheetModel.name, address })}>{cellText(value)}</button></td>; })}</tr>)}</tbody>
                </table>
              ) : <p className="text-body text-muted-foreground">{t("office.xlsx.surface.ready")}</p>}
            </div>
            )}
            <XlsxStatusBar documentKey={documentKey} host={rendererHost} selection={selection} dirtyGeneration={coordinatorState.dirtyGeneration} />
          </div>
        </>
      ) : viewState === "error" && failure ? (
        <XlsxErrorState failure={failure} onRetry={() => openAttemptRef.current?.()} />
      ) : (
        <div className="flex min-h-64 flex-1 items-center justify-center text-body text-muted-foreground" role="status" data-testid="xlsx-opening">{t("office.xlsx.state.opening")}</div>
      )}
    </div>
  );
}

export type { XlsxOpenFailure, XlsxOpenOutcome } from "./types";
