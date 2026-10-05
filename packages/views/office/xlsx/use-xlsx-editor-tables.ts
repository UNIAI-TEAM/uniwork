"use client";

// R4 (chrome amendment R): the live table list the contextual Table tabs read
// (state lives in use-xlsx-editor-ribbon-data.ts; this file folds the edits).
// The renderer emits a `table` edit when a table is created or removed this
// session (xlsx-edit-bridge `XlsxGridTableEdit`); this hook folds those edits
// into the list the toolbar needs, keyed by the sheet's live name so a session
// rename keeps the contextual tab aimed at the right sheet.
//
// A file-native table (one already in the .xlsx) has no edit: the engine's
// render model reads it from the package and the bridge carries it on
// `file.sheets[].tables`; `fileTablesToToolbar` seeds the list from there and
// session edits fold on top (FB-3).
import type { XlsxGridEdit } from "./xlsx-edit-bridge";
import { isSheetGridEdit, isTableGridEdit } from "./xlsx-edit-bridge";
import type { XlsxToolbarTable, XlsxToolbarTableRange } from "./toolbar/types";
import type { RendererWorkbookSheet } from "./xlsx-render-model-bridge";

/** The tables the opened file ships, keyed by sheet name (the toolbar shape). */
export function fileTablesToToolbar(sheets: readonly RendererWorkbookSheet[] | undefined): readonly XlsxToolbarTable[] {
  return (sheets ?? []).flatMap((sheet) =>
    (sheet.tables ?? []).map((table): XlsxToolbarTable => ({
      sheet: sheet.name,
      name: table.name,
      range: {
        startRow: table.range.startRow,
        endRow: table.range.endRow,
        startColumn: table.range.startColumn,
        endColumn: table.range.endColumn,
      },
    })),
  );
}

/** Fold one batch of grid edits into the live table list. */
export function foldTableEdits(
  tables: readonly XlsxToolbarTable[],
  edits: readonly XlsxGridEdit[],
  sheetName: (sheetId: string) => string | undefined,
): readonly XlsxToolbarTable[] {
  let next: XlsxToolbarTable[] | null = null;
  for (const edit of edits) {
    if (isSheetGridEdit(edit)) {
      // A rename carries the OLD name in `sheetName` (see XlsxGridSheetEdit), so
      // every entry keyed by it - file-native or session-created - moves to the
      // new name; a rename that touches no table leaves the list untouched.
      if (edit.sheetOp.kind !== "rename-sheet" || edit.sheetOp.newName === edit.sheetName) continue;
      const { newName } = edit.sheetOp;
      const source: readonly XlsxToolbarTable[] = next ?? tables;
      if (!source.some((table) => table.sheet === edit.sheetName)) continue;
      next = source.map((table) => (table.sheet === edit.sheetName ? { ...table, sheet: newName } : table));
      continue;
    }
    if (!isTableGridEdit(edit)) continue;
    const sheet = edit.sheetName ?? sheetName(edit.sheetId);
    if (!sheet) continue;
    if (next === null) next = [...tables];
    if (edit.table === null) {
      next = next.filter((table) => !(table.sheet === sheet && table.name === edit.name));
      continue;
    }
    const range: XlsxToolbarTableRange = { ...edit.table.area };
    const entry: XlsxToolbarTable = { sheet, name: edit.table.name, range };
    const index = next.findIndex((table) => table.sheet === sheet && table.name === edit.table!.name);
    if (index >= 0) next[index] = entry;
    else next.push(entry);
  }
  return next ?? tables;
}
