"use client";

/* eslint-disable jsx-a11y/no-noninteractive-element-interactions -- the editor application landmark owns host shortcuts */

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@uniwork/ui/lib/utils";
import type { XlsxWorkbookSnapshot } from "@uniwork/office-engine/xlsx";
import { XlsxErrorState } from "./xlsx-error-state";
import { XlsxFindPanel } from "./find/find-panel";
import { XlsxAdvancedFilterDialog } from "./filter/advanced-filter-dialog";
import { XlsxFunctionLibraryMount } from "./formulas/function-library";
import { useXlsxPageSetup } from "./page-setup/use-page-setup";
import { useEditorProtectNames } from "./protect/use-protect-names";
import { XlsxVisualsProvider, useXlsxVisuals } from "./visuals/use-xlsx-visuals";
import { XlsxGridSurface, type XlsxGridHandle } from "./xlsx-grid-surface";
import { xlsxSelectionFromGrid } from "./selection-mapping";
import { useXlsxContextMenu } from "./context-menu/use-context-menu";
import { useXlsxCatalogShortcuts } from "./shortcuts/use-catalog-shortcuts";
import { XlsxShortcutsDialog } from "./shortcuts/shortcuts-dialog";
import { XlsxToolbar } from "./xlsx-toolbar";
import { XlsxFormulaRow } from "./toolbar/formula-row";
import { XlsxFrameNotices } from "./xlsx-frame-notices";
import { XlsxFallbackSurface } from "./xlsx-fallback-surface";
import { XlsxFrameStatusBar, XlsxSheetTabsRow } from "./toolbar/status-area";
import { useXlsxViewEcho } from "./toolbar/view-echo";
import { OfficeFrame } from "../frame";
import { useXlsxGridFormat } from "./toolbar/use-xlsx-grid-format";
import { cellText, isSnapshot, snapshotForEditor } from "./xlsx-editor-model";
import { useXlsxGridEdits } from "./use-xlsx-grid-edits";
import { isFailure, unexpectedFailure } from "./xlsx-editor-failure";
import { useXlsxEditorSelection } from "./use-xlsx-editor-selection";
import { useXlsxEditorEdits } from "./use-xlsx-editor-edits";
import { useXlsxEditorSheetCommands } from "./use-xlsx-editor-sheet-commands";
import { useXlsxEditorClipboard } from "./use-xlsx-editor-clipboard";
import { useXlsxEditorKeyboard } from "./use-xlsx-editor-keyboard";
import { useXlsxEditorRibbonData } from "./use-xlsx-editor-ribbon-data";
import type {
  XlsxEditorProps,
  XlsxOpenFailure,
  XlsxSelection,
  XlsxViewState,
} from "./types";

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
  saveDestination = "cloud",
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
  // FRAME: the ribbon View > Zoom and the status-bar zoom share one echo.
  const viewEcho = useXlsxViewEcho();
  const [dark, setDark] = useState(() => typeof document !== "undefined" && document.documentElement.classList.contains("dark"));
  const translationRef = useRef(t);
  const sessionPropsRef = useRef({ editor, open, coordinator, capability, onOpen });
  const mountRef = useRef<{ documentKey: string; editor: XlsxEditorProps<TSnapshot>["editor"]; replayed: boolean } | null>(null);
  translationRef.current = t;
  sessionPropsRef.current = { editor, open, coordinator, capability, onOpen };

  const readOnly = permissions.canEdit === false || rendererHost?.file.readOnly === true || (capability !== undefined && capability.status !== "available");
  // A confirmed save names where it landed; a local file is not a cloud receipt.
  const saveStateLabel = t(coordinatorState.state === "saved" && saveDestination === "local" ? "office.xlsx.saveState.savedLocal" : `office.xlsx.saveState.${coordinatorState.state}`);
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

  useEffect(() => {
    const observer = new MutationObserver(() => setDark(document.documentElement.classList.contains("dark")));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setCoordinatorState(coordinator.getState());
    return coordinator.subscribe(setCoordinatorState);
  }, [coordinator, documentKey]);

  // FIX-EDITOR-SPLIT (UNI-926): the selection / active-sheet wiring - the live
  // sheet list, the selection-port and snapshot subscriptions and the
  // cell/sheet selection callbacks - now lives in ./use-xlsx-editor-selection.
  const { liveSheets, refreshSheets, selectCell, gridSheetId, selectSheet } = useXlsxEditorSelection({
    documentKey,
    editor,
    rendererHost,
    gridRef,
    gridReady,
    snapshot,
    selection,
    onSelectionChange,
    setSnapshot,
    setActiveSheet,
    setSelection,
    setActiveSheetId,
  });

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

  // FIX-EDITOR-SPLIT (UNI-926): cell commit, undo/redo, save preparation and
  // recalculation live in ./use-xlsx-editor-edits, which also owns markDirty.
  const { markDirty, commitCell, undo, redo, prepareSave, save, recalculate, cancelRecalculate } = useXlsxEditorEdits({
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
  });

  // FIX-EDITOR-SPLIT (UNI-926): the sheet-tab action dispatcher (pinned
  // command path + direct-op fallback) lives in ./use-xlsx-editor-sheet-commands.
  const runSheetAction = useXlsxEditorSheetCommands({
    canEdit,
    gridReady,
    gridCommands,
    gridSheetId,
    edit: editor.edit,
    markDirty,
    refreshSnapshot,
    refreshSheets,
    setRecalcError,
  });

  // FIX-EDITOR-SPLIT (UNI-926): copy / paste / cut, the clipboard failure
  // handler and the folded permissions live in ./use-xlsx-editor-clipboard.
  const { copy, paste, cut, clipboardFailure, clipboardPermissions, pasteNotice } = useXlsxEditorClipboard({
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
  });

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
  const protectNames = useEditorProtectNames({
    activeSheet: resolvedActiveSheet, readOnly, canEdit, rendererHost, liveSheets, snapshot, edit: editor.edit,
    onApplied: () => { markDirty(); refreshSnapshot(); }, onError: setRecalcError,
  });

  // Charts, pictures and shapes (UNI-940 X02): the hook owns the overlay and
  // the set_visual / remove_visual ops; see visuals/.
  const visuals = useXlsxVisuals({ gridRef, gridReady, selection, canEdit, editor, savedGeneration: coordinatorState.lastSavedGeneration, saving: coordinatorState.state === "saving", snapshot, fileVisuals: rendererHost?.fileVisuals, onApplied: markDirty,
    onError: setRecalcError, activeSheetId, activeSheetName: resolvedActiveSheet, sheets: liveSheets.length > 0 ? liveSheets : rendererHost?.file.sheets ?? [] });

  // FIX-EDITOR-SPLIT (UNI-926): the JSX key handler and the capture-phase
  // Ctrl/Cmd+S shortcut live in ./use-xlsx-editor-keyboard.
  const { keyboardHandler } = useXlsxEditorKeyboard({
    gridReady,
    copy,
    paste,
    undo,
    redo,
    clipboardFailure,
    save,
    rootRef,
    documentKey,
    editor,
  });


  // FIX-EDITOR-SPLIT (UNI-926): the sheet-tab strip's tab infos (live order +
  // read-only tab colours) live in ./use-xlsx-editor-ribbon-data.
  const { sheetTabInfos, tables, onTableEdits } = useXlsxEditorRibbonData(liveSheets, rendererHost, snapshot, documentKey);


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

  const dirty = coordinatorState.state === "dirty" || coordinatorState.dirtyGeneration > coordinatorState.lastSavedGeneration;
  const saving = coordinatorState.state === "saving";

  return (
    <div ref={rootRef} className={cn("flex h-full min-h-0 min-w-0 flex-1 flex-col bg-background", className)} data-testid="xlsx-editor" data-document-key={documentKey} onKeyDown={keyboardHandler} role="application" aria-busy={visibleState === "opening"} tabIndex={-1}>
      {!embedded ? <header className="flex min-h-11 items-center justify-between gap-3 border-b border-border px-3 py-2">
        <h1 className="min-w-0 truncate text-title font-semibold">{effectiveTitle}</h1>
        <span className="text-caption text-muted-foreground" data-testid="xlsx-open-state">
          {visibleState === "opening" ? t("office.xlsx.state.opening") : visibleState === "ready" ? saveStateLabel : t("office.xlsx.state.error")}
        </span>
      </header> : <span className="sr-only" data-testid="xlsx-open-state" role="status">{visibleState === "opening" ? t("office.xlsx.state.opening") : visibleState === "ready" ? saveStateLabel : t("office.xlsx.state.error")}</span>}
      {viewState === "ready" ? (
        <>
          <XlsxVisualsProvider visuals={visuals}>
          <OfficeFrame
            data-testid="xlsx-frame"
            canvasClassName="overflow-hidden"
            ribbon={
              <XlsxToolbar
                coordinator={coordinator}
                saveDestination={saveDestination}
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
                viewEcho={viewEcho}
                onNumberFormat={() => gridRef.current?.setNumberFormat("0.00")}
                recalculating={recalcProgress !== null}
                onUndo={undo}
                onRedo={redo}
                onRecalculate={recalculate}
                onCut={() => { void cut().catch(clipboardFailure); }}
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
                tables={tables} resolveSheetId={gridSheetId}
                onOpenFunctionLibrary={rendererHost ? () => setFunctionLibraryOpen(true) : undefined}
                onOpenShortcuts={rendererHost ? () => setShortcutsOpen(true) : undefined}
                onSave={() => save("button")}
                onCancelSave={coordinator.cancel ? () => { void coordinator.cancel?.().catch((error: unknown) => setRecalcError(error instanceof Error ? error.message : String(error))); } : undefined}
              />
            }
            subbar={
              <>
                <XlsxFormulaRow
                  address={selection?.endAddress ? `${selection.address}:${selection.endAddress}` : (selection?.address ?? "")}
                  value={formulaDraft}
                  disabled={!canEdit || selection === null}
                  onChange={setFormulaDraft}
                  onCommit={() => { void commitCell().catch((error: unknown) => setRecalcError(error instanceof Error ? error.message : String(error))); }}
                />
                {rendererHost && findOpen ? (
                  <XlsxFindPanel documentKey={documentKey} host={rendererHost} commands={gridCommands} selection={selection}
                    sheetName={selection?.sheet ?? activeSheet} dirtyGeneration={coordinatorState.dirtyGeneration} readOnly={readOnly} onClose={() => setFindOpen(false)} />
                ) : null}
                <XlsxFrameNotices recalcProgress={recalcProgress} recalcError={recalcError} editFailed={Boolean(gridEdits.error)} onCancelRecalculate={cancelRecalculate} saveErrorCode={coordinatorState.error?.code} editor={editor} grid={gridRef} pasteNotice={pasteNotice} />
              </>
            }
            bottom={
              <XlsxSheetTabsRow
                sheetTabsRef={sheetTabsRef}
                tabs={sheetTabInfos}
                activeSheet={resolvedActiveSheet}
                canEdit={canEdit}
                onSelect={selectSheet}
                onAction={runSheetAction}
              />
            }
            statusBar={
              <XlsxFrameStatusBar
                stateLabel={saveStateLabel}
                documentKey={documentKey}
                host={rendererHost}
                selection={selection}
                dirtyGeneration={coordinatorState.dirtyGeneration}
                viewEcho={viewEcho} snapshot={snapshot}
                commands={gridReady ? gridCommands : undefined}
                onOpenShortcuts={rendererHost ? () => setShortcutsOpen(true) : undefined}
              />
            }
          >
            <div className="flex h-full min-h-0 min-w-0 flex-col" data-testid="xlsx-canvas">
              {rendererHost ? (
                <XlsxGridSurface
                  ref={gridRef}
                  documentKey={documentKey}
                  host={rendererHost}
                  dark={dark}
                  readOnly={readOnly || !canEdit}
                  onContextMenu={contextMenu.open}
                  overlay={visuals.overlay} onViewportChange={visuals.onViewportChange}
                  onEdits={(edits) => { gridEdits.onEdits(edits); onTableEdits(edits); refreshFormatState(); refreshSheets(); }}
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
                      const nextSelection = xlsxSelectionFromGrid(sheetName ?? next.sheetId, next.range);
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
              <XlsxFallbackSurface sheet={activeSheetModel} selection={selection} onSelectCell={selectCell} />
              )}
            </div>
          </OfficeFrame>
          </XlsxVisualsProvider>
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
          {recalcFresh ? <p className="sr-only" role="status">{t("office.xlsx.recalc.fresh")}</p> : null}
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
