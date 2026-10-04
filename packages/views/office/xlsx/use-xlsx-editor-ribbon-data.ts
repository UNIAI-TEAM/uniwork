"use client";

// FIX-EDITOR-SPLIT (UNI-926): the sheet-tab presentation data extracted from
// xlsx-editor.tsx - the strip's tab infos (live sheet order plus the file's
// read-only tab colours). The memo body and dependency list are byte-identical
// to the shell it replaces.

import { useMemo } from "react";
import type { XlsxWorkbookSnapshot } from "@uniwork/office-engine/xlsx";
import type { XlsxGridHostPort, XlsxGridSheetInfo } from "./xlsx-grid-surface";
import type { XlsxSheetTab } from "./sheet-tabs";

export function useXlsxEditorRibbonData(
  liveSheets: readonly XlsxGridSheetInfo[],
  rendererHost: XlsxGridHostPort | undefined,
  snapshot: XlsxWorkbookSnapshot | null,
): readonly XlsxSheetTab[] {
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
  return sheetTabInfos;
}
