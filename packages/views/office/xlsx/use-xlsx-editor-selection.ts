"use client";

// FIX-EDITOR-SPLIT (UNI-926): the selection / active-sheet wiring extracted
// from xlsx-editor.tsx. It owns the live sheet list, the selection-port and
// snapshot subscriptions, and the cell/sheet selection callbacks. The bodies,
// dependency arrays and ordering are byte-identical to the shell it replaces.

import { useCallback, useEffect, useState, type Dispatch, type RefObject, type SetStateAction } from "react";
import type { XlsxWorkbookSnapshot } from "@uniwork/office-engine/xlsx";
import type { XlsxGridHandle, XlsxGridHostPort, XlsxGridSheetInfo } from "./xlsx-grid-surface";
import { addressParts } from "./xlsx-editor-model";
import type { XlsxEditorHandle, XlsxSelection } from "./types";

export interface XlsxEditorSelectionOptions<TSnapshot = XlsxWorkbookSnapshot> {
  documentKey: string;
  editor: XlsxEditorHandle<TSnapshot>;
  rendererHost: XlsxGridHostPort | undefined;
  gridRef: RefObject<XlsxGridHandle | null>;
  gridReady: boolean;
  snapshot: XlsxWorkbookSnapshot | null;
  selection: XlsxSelection | null;
  onSelectionChange: ((selection: XlsxSelection | null) => void) | undefined;
  setSnapshot: Dispatch<SetStateAction<XlsxWorkbookSnapshot | null>>;
  setActiveSheet: Dispatch<SetStateAction<string | null>>;
  setSelection: Dispatch<SetStateAction<XlsxSelection | null>>;
  setActiveSheetId: Dispatch<SetStateAction<string | null>>;
}

export interface XlsxEditorSelectionWiring {
  liveSheets: readonly XlsxGridSheetInfo[];
  refreshSheets: () => void;
  selectCell: (next: XlsxSelection) => void;
  gridSheetId: (sheetName: string) => string | undefined;
  selectSheet: (sheetName: string) => void;
}

export function useXlsxEditorSelection<TSnapshot = XlsxWorkbookSnapshot>(
  options: XlsxEditorSelectionOptions<TSnapshot>,
): XlsxEditorSelectionWiring {
  const {
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
  } = options;

  // Live sheet list (tab order, names, hidden) for the sheet-tab strip: the
  // mounted grid's own state, so a session rename/add/reorder is reflected the
  // moment it happens. Empty without a grid (the snapshot drives the strip).
  const [liveSheets, setLiveSheets] = useState<readonly XlsxGridSheetInfo[]>([]);
  const refreshSheets = useCallback(() => {
    setLiveSheets(gridRef.current?.getSheets?.() ?? []);
  }, [gridRef]);

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
  }, [documentKey, editor, onSelectionChange, setActiveSheet, setSelection]);

  useEffect(() => {
    const subscribe = editor.subscribeSnapshot;
    if (!subscribe) return undefined;
    return subscribe((next) => {
      setSnapshot(next);
      setActiveSheet((current) => next.sheets.some((sheet) => sheet.name === current) ? current : next.sheets[0]?.name ?? null);
    });
  }, [editor, setActiveSheet, setSnapshot]);

  const selectCell = useCallback((next: XlsxSelection) => {
    setSelection(next);
    setActiveSheet(next.sheet);
    editor.selection?.setSelection?.(next);
    onSelectionChange?.(next);
  }, [editor.selection, onSelectionChange, setActiveSheet, setSelection]);

  // The live grid id wins over the host file's id map: a session rename keeps
  // the id but changes the name, so the file lookup goes stale.
  const gridSheetId = useCallback((sheetName: string): string | undefined =>
    gridRef.current?.getSheets?.().find((sheet) => sheet.name === sheetName)?.id ??
    rendererHost?.file.sheets.find((sheet) => sheet.name === sheetName)?.id,
  [gridRef, rendererHost]);

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
  }, [editor.selection, gridReady, gridRef, gridSheetId, onSelectionChange, selection?.sheet, setActiveSheet, setActiveSheetId, setSelection, snapshot]);

  return { liveSheets, refreshSheets, selectCell, gridSheetId, selectSheet };
}
