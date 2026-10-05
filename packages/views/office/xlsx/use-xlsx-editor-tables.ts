"use client";

// R4 (chrome amendment R): the live table list the contextual Table tabs read
// (state lives in use-xlsx-editor-ribbon-data.ts; this file folds the edits).
// The renderer emits a `table` edit when a table is created or removed this
// session (xlsx-edit-bridge `XlsxGridTableEdit`); this hook folds those edits
// into the list the toolbar needs, keyed by the sheet's live name so a session
// rename keeps the contextual tab aimed at the right sheet.
//
// A file-native table (one already in the .xlsx) has no edit and no renderer
// read-back yet, so it is a known gap reported with the fix - the contextual
// tab covers tables the session creates, which is the finding R4 describes.
import type { XlsxGridEdit } from "./xlsx-edit-bridge";
import { isTableGridEdit } from "./xlsx-edit-bridge";
import type { XlsxToolbarTable, XlsxToolbarTableRange } from "./toolbar/types";

/** Fold one batch of grid edits into the live table list. */
export function foldTableEdits(
  tables: readonly XlsxToolbarTable[],
  edits: readonly XlsxGridEdit[],
  sheetName: (sheetId: string) => string | undefined,
): readonly XlsxToolbarTable[] {
  let next: XlsxToolbarTable[] | null = null;
  for (const edit of edits) {
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
