"use client";

/* eslint-disable jsx-a11y/no-noninteractive-element-interactions -- the editor application landmark owns host shortcuts */

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@uniwork/ui/lib/utils";
import type { XlsxWorkbookSnapshot } from "@uniwork/office-engine/xlsx";
import { XlsxErrorState } from "./xlsx-error-state";
import { XlsxGridSurface, type XlsxGridHandle } from "./xlsx-grid-surface";
import { toA1Address } from "./xlsx-render-model-bridge";
import { XlsxToolbar } from "./xlsx-toolbar";
import type { XlsxToolbarCommands } from "./toolbar/types";
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
  // The toolbar's one command port: it reaches the mounted renderer only, and
  // the renderer's policy gate keeps every command savable or refused.
  const gridCommands = useMemo<XlsxToolbarCommands>(() => ({
    execute: (id, params) => gridRef.current?.executeCommand(id, params) ?? false,
  }), []);

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

  const selectSheet = useCallback((sheetName: string) => {
    setActiveSheet(sheetName);
    const rendererSheet = rendererHost?.file.sheets.find((sheet) => sheet.name === sheetName);
    if (gridReady && rendererSheet) { gridRef.current?.selectSheet(rendererSheet.id); return; }
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
  }, [editor.selection, gridReady, onSelectionChange, rendererHost, selection?.sheet, snapshot]);

  const markDirty = useCallback(() => {
    coordinator.markDirty?.(editor.getDirtyGeneration());
    setRecalcFresh(false);
  }, [coordinator, editor]);

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

  const sheets = snapshot?.sheets ?? [];
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
            permissions={{ ...permissions, canCopy: permissions.canCopy !== false && typeof editor.clipboard?.writeText === "function", canPaste: permissions.canPaste !== false && typeof editor.clipboard?.readText === "function" }}
            selection={selection}
            canUndo={gridReady || typeof editor.undo === "function"}
            canRedo={gridReady || typeof editor.redo === "function"}
            canRecalculate={recalcController !== undefined}
            canFormat={gridReady && selection !== null}
            commands={gridCommands}
            onNumberFormat={() => gridRef.current?.setNumberFormat("0.00")}
            recalculating={recalcProgress !== null}
            onUndo={undo}
            onRedo={redo}
            onRecalculate={recalculate}
            onCopy={() => { void copy().catch(clipboardFailure); }}
            onPaste={() => { void paste().catch(clipboardFailure); }}
            onShowSheets={() => sheetTabsRef.current?.focus()}
            onSave={() => save("button")}
            onCancelSave={coordinator.cancel ? () => { void coordinator.cancel?.().catch((error: unknown) => setRecalcError(error instanceof Error ? error.message : String(error))); } : undefined}
          />
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
            <div ref={sheetTabsRef} tabIndex={-1} className="flex items-center gap-1 overflow-x-auto border-b border-border px-2 py-1" role="tablist" aria-label={t("office.xlsx.sheets.label")}>
              {sheets.map((sheet) => (
                <button key={sheet.name} type="button" role="tab" aria-selected={sheet.name === activeSheetModel?.name} className="rounded px-3 py-1 text-label hover:bg-muted aria-selected:bg-muted pointer-coarse:min-h-11 pointer-coarse:min-w-11" onClick={() => selectSheet(sheet.name)}>{sheet.name}</button>
              ))}
              {sheets.length === 0 ? <span className="px-2 text-caption text-muted-foreground">{t("office.xlsx.surface.ready")}</span> : null}
            </div>
            <div className="flex items-center gap-2 border-b border-border bg-muted/10 px-3 py-2">
              <label htmlFor="xlsx-formula-bar" className="text-caption font-medium">{t("office.xlsx.formula.label")}</label>
              <input id="xlsx-formula-bar" value={formulaDraft} disabled={!canEdit || selection === null} onChange={(event) => setFormulaDraft(event.target.value)} onBlur={() => { void commitCell().catch((error: unknown) => setRecalcError(error instanceof Error ? error.message : String(error))); }} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void commitCell().catch((error: unknown) => setRecalcError(error instanceof Error ? error.message : String(error))); } }} className="min-w-0 flex-1 rounded border border-input bg-background px-2 py-1 font-mono text-caption pointer-coarse:min-h-11" data-testid="xlsx-formula-bar" aria-label={t("office.xlsx.formula.label")} />
            </div>
            {rendererHost ? (
              <XlsxGridSurface
                ref={gridRef}
                documentKey={documentKey}
                host={rendererHost}
                dark={dark}
                readOnly={readOnly || !canEdit}
                onEdits={gridEdits.onEdits}
                onReady={() => setGridReady(true)}
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
                    return;
                  }
                  const sheet = rendererHost.file.sheets.find((candidate) => candidate.id === next.sheetId);
                  const nextSelection: XlsxSelection = {
                    sheet: sheet?.name ?? next.sheetId,
                    address: toA1Address(next.range.startRow, next.range.startColumn),
                    ...(next.range.startRow !== next.range.endRow || next.range.startColumn !== next.range.endColumn
                      ? { endAddress: toA1Address(next.range.endRow, next.range.endColumn) }
                      : {}),
                  };
                  setSelection(nextSelection);
                  setActiveSheet(nextSelection.sheet);
                  editor.selection?.setSelection?.(nextSelection);
                  onSelectionChange?.(nextSelection);
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
