"use client";

/* eslint-disable jsx-a11y/no-noninteractive-element-interactions -- the editor application landmark owns host shortcuts */

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@uniwork/ui/lib/utils";
import type { XlsxCellState, XlsxWorkbookSnapshot } from "@uniwork/office-engine/xlsx";
import { XlsxErrorState } from "./xlsx-error-state";
import { XlsxToolbar } from "./xlsx-toolbar";
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

function isSnapshot(value: unknown): value is XlsxWorkbookSnapshot {
  if (!value || typeof value !== "object") return false;
  const sheets = (value as { sheets?: unknown }).sheets;
  return Array.isArray(sheets) && sheets.every((sheet) => sheet && typeof sheet === "object" && typeof (sheet as { name?: unknown }).name === "string");
}

function cellText(cell: XlsxCellState | undefined): string {
  if (!cell) return "";
  if (cell.formula !== undefined) return cell.formula;
  return cell.value === null ? "" : String(cell.value);
}

function addressParts(address: string): { row: number; column: number } | null {
  const match = /^([A-Za-z]{1,3})([1-9][0-9]*)$/.exec(address);
  if (!match) return null;
  let column = 0;
  for (const char of match[1]!.toUpperCase()) column = column * 26 + char.charCodeAt(0) - 64;
  return { row: Number(match[2]) - 1, column: column - 1 };
}

function columnLabel(column: number): string {
  let number = column + 1;
  let result = "";
  while (number > 0) {
    result = String.fromCharCode(65 + ((number - 1) % 26)) + result;
    number = Math.floor((number - 1) / 26);
  }
  return result;
}

function snapshotForEditor<TSnapshot>(editor: XlsxEditorProps<TSnapshot>["editor"], outcome: XlsxOpenOutcome): XlsxWorkbookSnapshot | null {
  if (!isFailure(outcome) && isSnapshot(outcome.snapshot)) return outcome.snapshot;
  const candidate = editor.getWorkbookSnapshot?.();
  return isSnapshot(candidate) ? candidate : null;
}

/** XLSX format view. The host supplies the G2 browser adapter through the
 * EditorHandle; this component never imports a Node binding or writes bytes. */
export function XlsxEditor<TSnapshot = XlsxWorkbookSnapshot>({
  documentKey,
  editor,
  open,
  coordinator,
  capability,
  permissions = {},
  title,
  className,
  onOpen,
  onSelectionChange,
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
  const translationRef = useRef(t);
  const sessionPropsRef = useRef({ editor, open, coordinator, capability, onOpen });
  translationRef.current = t;
  sessionPropsRef.current = { editor, open, coordinator, capability, onOpen };

  const readOnly = permissions.canEdit === false || (capability !== undefined && capability.status !== "available");
  const effectiveTitle = title ?? t("office.xlsx.title");
  const activeSheetModel = snapshot?.sheets.find((sheet) => sheet.name === activeSheet) ?? snapshot?.sheets[0];
  const activeCell = selection && activeSheetModel?.name === selection.sheet ? activeSheetModel.cells[selection.address] : undefined;
  const canEdit = typeof editor.edit === "function" && !readOnly;
  const recalcController = editor.recalculate;

  const refreshSnapshot = useCallback(() => {
    const next = editor.getWorkbookSnapshot?.();
    if (isSnapshot(next)) setSnapshot(next);
  }, [editor]);

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
    const cleanupSession = sessionPropsRef.current;
    disposedRef.current = false;

    const run = async () => {
      // Retry must use the latest session ports. The effect intentionally only
      // depends on documentKey, so a parent can refresh open/coordinator
      // identities without tearing down an active edit session.
      const session = sessionPropsRef.current;
      openAbortRef.current?.abort();
      const controller = new AbortController();
      openAbortRef.current = controller;
      setViewState("opening");
      setFailure(null);
      setSnapshot(null);
      setRecalcError(null);
      setRecalcFresh(false);

      if (session.capability !== undefined && session.capability.status !== "available") {
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
      void cleanupSession.editor.cancel?.("document_changed");
      void cleanupSession.coordinator.cancel?.();
      void cleanupSession.editor.dispose();
      openAttemptRef.current = null;
    };
  }, [documentKey]);

  useEffect(() => {
    setFormulaDraft(cellText(activeCell));
  }, [activeCell, selection?.address]);

  const selectCell = useCallback((next: XlsxSelection) => {
    setSelection(next);
    setActiveSheet(next.sheet);
    editor.selection?.setSelection?.(next);
    onSelectionChange?.(next);
  }, [editor.selection, onSelectionChange]);

  const selectSheet = useCallback((sheetName: string) => {
    setActiveSheet(sheetName);
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
  }, [editor.selection, onSelectionChange, selection?.sheet, snapshot]);

  const markDirty = useCallback(() => {
    coordinator.markDirty?.(editor.getDirtyGeneration());
    setRecalcFresh(false);
  }, [coordinator, editor]);

  const commitCell = useCallback(async () => {
    if (!canEdit || !selection || formulaDraft === cellText(activeCell)) return;
    const text = formulaDraft;
    const op = { op: "set_cell", target: { sheet: selection.sheet, cell: selection.address }, text };
    await editor.edit?.([op]);
    markDirty();
    refreshSnapshot();
  }, [activeCell, canEdit, editor, formulaDraft, markDirty, refreshSnapshot, selection]);

  const undo = useCallback(() => {
    if (readOnly) return;
    editor.undo?.();
    markDirty();
    refreshSnapshot();
  }, [editor, markDirty, readOnly, refreshSnapshot]);

  const redo = useCallback(() => {
    if (readOnly) return;
    editor.redo?.();
    markDirty();
    refreshSnapshot();
  }, [editor, markDirty, readOnly, refreshSnapshot]);

  const save = useCallback((entryPoint: "button" | "shortcut" = "button") => {
    if (viewState !== "ready" || readOnly) return;
    void coordinator.save(entryPoint);
  }, [coordinator, readOnly, viewState]);

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
    await editor.clipboard.writeText(cellText(activeCell));
  }, [activeCell, editor.clipboard, permissions.canCopy, selection]);

  const paste = useCallback(async () => {
    if (!selection || !canEdit || permissions.canPaste === false || !editor.clipboard?.readText) return;
    const text = await editor.clipboard.readText();
    setFormulaDraft(text);
    const op = { op: "set_cell", target: { sheet: selection.sheet, cell: selection.address }, text };
    await editor.edit?.([op]);
    markDirty();
    refreshSnapshot();
  }, [canEdit, editor, markDirty, permissions.canPaste, refreshSnapshot, selection]);

  const keyboardHandler = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing) return;
    const modifier = event.metaKey || event.ctrlKey;
    if (!modifier) return;
    const key = event.key.toLowerCase();
    if (key === "s") {
      event.preventDefault();
      save("shortcut");
    } else if (key === "c" && !(event.target instanceof HTMLInputElement)) {
      event.preventDefault();
      void copy();
    } else if (key === "v" && !(event.target instanceof HTMLInputElement)) {
      event.preventDefault();
      void paste();
    } else if (key === "z" && !event.shiftKey && !(event.target instanceof HTMLInputElement)) {
      event.preventDefault();
      undo();
    } else if ((key === "y" || (key === "z" && event.shiftKey)) && !(event.target instanceof HTMLInputElement)) {
      event.preventDefault();
      redo();
    }
  }, [copy, paste, redo, save, undo]);

  const sheets = snapshot?.sheets ?? [];
  const cells = useMemo(() => activeSheetModel?.cells ?? {}, [activeSheetModel]);
  const visibleAddresses = useMemo(() => Object.keys(cells).map((address) => ({ address, parts: addressParts(address) })).filter((cell): cell is { address: string; parts: { row: number; column: number } } => cell.parts !== null), [cells]);
  const maxRow = visibleAddresses.reduce((max, cell) => Math.max(max, cell.parts.row), 0);
  const maxColumn = visibleAddresses.reduce((max, cell) => Math.max(max, cell.parts.column), 0);
  const dirty = coordinatorState.state === "dirty" || coordinatorState.dirtyGeneration > coordinatorState.lastSavedGeneration;
  const saving = coordinatorState.state === "saving";

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col bg-background", className)} data-testid="xlsx-editor" data-document-key={documentKey} onKeyDown={keyboardHandler} role="application" tabIndex={-1}>
      <header className="flex min-h-11 items-center justify-between gap-3 border-b border-border px-3 py-2">
        <h1 className="min-w-0 truncate text-title font-semibold">{effectiveTitle}</h1>
        <span className="text-caption text-muted-foreground" data-testid="xlsx-open-state">
          {viewState === "opening" ? t("office.xlsx.state.opening") : viewState === "ready" ? t(`office.xlsx.saveState.${coordinatorState.state}`) : t("office.xlsx.state.error")}
        </span>
      </header>
      {viewState === "ready" ? (
        <>
          <XlsxToolbar
            coordinator={coordinator}
            dirty={dirty}
            saving={saving}
            readOnly={readOnly}
            permissions={permissions}
            selection={selection}
            canUndo={typeof editor.undo === "function"}
            canRedo={typeof editor.redo === "function"}
            canRecalculate={recalcController !== undefined}
            recalculating={recalcProgress !== null}
            onUndo={undo}
            onRedo={redo}
            onRecalculate={recalculate}
            onCopy={() => void copy()}
            onPaste={() => void paste()}
            onShowSheets={() => sheetTabsRef.current?.focus()}
            onSave={() => save("button")}
          />
          {recalcProgress !== null ? (
            <div className="flex items-center gap-2 border-b border-border bg-muted/20 px-3 py-1 text-caption" data-testid="xlsx-recalc-progress" role="status">
              <span>{t("office.xlsx.recalc.progress", { progress: recalcProgress })}</span>
              <progress max={100} value={recalcProgress} aria-label={t("office.xlsx.recalc.progress", { progress: recalcProgress })} />
              <button type="button" className="text-primary underline" onClick={cancelRecalculate} data-testid="xlsx-recalc-cancel">{t("office.xlsx.recalc.cancel")}</button>
            </div>
          ) : null}
          {recalcError ? <p className="border-b border-destructive/30 bg-destructive/10 px-3 py-1 text-caption text-destructive" role="alert" data-testid="xlsx-recalc-error">{recalcError}</p> : null}
          {recalcFresh ? <p className="sr-only" role="status">{t("office.xlsx.recalc.fresh")}</p> : null}
          <div className="flex min-h-0 flex-1 flex-col" data-testid="xlsx-canvas">
            <div ref={sheetTabsRef} tabIndex={-1} className="flex items-center gap-1 overflow-x-auto border-b border-border px-2 py-1" role="tablist" aria-label={t("office.xlsx.sheets.label")}>
              {sheets.map((sheet) => (
                <button key={sheet.name} type="button" role="tab" aria-selected={sheet.name === activeSheetModel?.name} className="rounded px-3 py-1 text-label hover:bg-muted aria-selected:bg-muted" onClick={() => selectSheet(sheet.name)}>{sheet.name}</button>
              ))}
              {sheets.length === 0 ? <span className="px-2 text-caption text-muted-foreground">{t("office.xlsx.surface.ready")}</span> : null}
            </div>
            <div className="flex items-center gap-2 border-b border-border bg-muted/10 px-3 py-2">
              <label htmlFor="xlsx-formula-bar" className="text-caption font-medium">{t("office.xlsx.formula.label")}</label>
              <input id="xlsx-formula-bar" value={formulaDraft} disabled={!canEdit || selection === null} onChange={(event) => setFormulaDraft(event.target.value)} onBlur={() => void commitCell()} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void commitCell(); } }} className="min-w-0 flex-1 rounded border border-input bg-background px-2 py-1 font-mono text-caption" data-testid="xlsx-formula-bar" aria-label={t("office.xlsx.formula.label")} />
            </div>
            <div className="min-h-64 flex-1 overflow-auto bg-muted/20 p-3" data-testid="xlsx-workbook-surface">
              {activeSheetModel ? (
                <table className="border-collapse text-caption" aria-label={t("office.xlsx.surface.table", { sheet: activeSheetModel.name })}>
                  <thead><tr><th className="sticky left-0 border border-border bg-muted px-2 py-1" aria-hidden />{Array.from({ length: maxColumn + 1 }, (_, column) => <th key={column} className="border border-border bg-muted px-3 py-1 font-medium">{columnLabel(column)}</th>)}</tr></thead>
                  <tbody>{Array.from({ length: maxRow + 1 }, (_, row) => <tr key={row}><th className="sticky left-0 border border-border bg-muted px-2 py-1 font-medium">{row + 1}</th>{Array.from({ length: maxColumn + 1 }, (_, column) => { const address = `${columnLabel(column)}${row + 1}`; const value = activeSheetModel.cells[address]; const selected = selection?.sheet === activeSheetModel.name && selection.address === address; return <td key={address} className={cn("min-w-24 border border-border bg-background p-0", selected && "ring-2 ring-primary ring-inset")}><button type="button" className="block min-h-8 w-full px-2 text-left" aria-label={`${activeSheetModel.name} ${address}`} aria-pressed={selected} data-testid={`xlsx-cell-${activeSheetModel.name}-${address}`} onClick={() => selectCell({ sheet: activeSheetModel.name, address })}>{cellText(value)}</button></td>; })}</tr>)}</tbody>
                </table>
              ) : <p className="text-body text-muted-foreground">{t("office.xlsx.surface.ready")}</p>}
            </div>
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
