"use client";

// FIX-EDITOR-SPLIT (UNI-926): the sheet-tab presentation data extracted from
// xlsx-editor.tsx - the strip's tab infos (live sheet order plus the file's
// read-only tab colours). The memo body and dependency list are byte-identical
// to the shell it replaces.

import { useCallback, useEffect, useMemo, useState } from "react";
import type { XlsxWorkbookSnapshot } from "@uniwork/office-engine/xlsx";
import type { XlsxGridHostPort, XlsxGridSheetInfo } from "./xlsx-grid-surface";
import type { XlsxSheetTab } from "./sheet-tabs";
import { fileTablesToToolbar, foldTableEdits } from "./use-xlsx-editor-tables";
import type { XlsxGridEdit } from "./xlsx-edit-bridge";
import type { XlsxToolbarTable } from "./toolbar/types";

export function useXlsxEditorRibbonData(
  liveSheets: readonly XlsxGridSheetInfo[],
  rendererHost: XlsxGridHostPort | undefined,
  snapshot: XlsxWorkbookSnapshot | null,
  documentKey: string,
): { sheetTabInfos: readonly XlsxSheetTab[]; tables: readonly XlsxToolbarTable[]; onTableEdits: (edits: readonly XlsxGridEdit[]) => void } {
  // R4: the live tables the contextual Table tabs answer to, folded from the
  // renderer's table edits (kept here so the shell stays within its line cap).
  // FB-3: it starts from the tables the opened file ships (render model ->
  // `file.sheets[].tables`); session edits fold on top.
  const fileSheets = rendererHost?.file.sheets;
  const fileTables = useMemo(() => fileTablesToToolbar(fileSheets), [fileSheets]);
  const [tables, setTables] = useState<readonly XlsxToolbarTable[]>(fileTables);
  // A different document (or a reloaded file) restarts from its own tables:
  // the folded list is per document.
  useEffect(() => { setTables(fileTables); }, [documentKey, fileTables]);
  const onTableEdits =useCallback((edits: readonly XlsxGridEdit[]) => {
    setTables((current) => foldTableEdits(current, edits, (sheetId) => liveSheets.find((sheet) => sheet.id === sheetId)?.name));
  }, [liveSheets]);
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
  return { sheetTabInfos, tables, onTableEdits };
}
