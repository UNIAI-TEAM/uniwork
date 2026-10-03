"use client";

// C2 (UNI-926): the editor-side wiring for page setup, print and CSV export.
// Extracted from xlsx-editor.tsx so that shell stays close to its size budget;
// this hook owns the dialog's open state, the set_page_setup op and the two
// host actions (print, CSV download). The pure serializer and DOM helpers live
// beside it (export/csv.ts, export/download.ts).

import { useCallback, useState, type ReactNode } from "react";
import type { XlsxPageSetupFields } from "@uniwork/office-engine/xlsx";
import type { XlsxGridHostPort } from "../xlsx-grid-surface";
import { toA1Address } from "../xlsx-render-model-bridge";
import type { XlsxSelection } from "../types";
import { serializeSheetToCsv } from "../export/csv";
import { csvFilename, downloadCsvFile, installPrintStylesheet, printDocument } from "../export/download";
import { XlsxPageSetupDialog } from "./page-setup-dialog";

export interface XlsxPageSetupOptions {
  host: XlsxGridHostPort | undefined;
  selection: XlsxSelection | null;
  activeSheet: string | null;
  readOnly: boolean;
  canEdit: boolean;
  edit?: ((ops: readonly unknown[]) => Promise<void> | void) | undefined;
  onApplied: () => void;
  onError: (message: string) => void;
}

export interface XlsxPageSetupWiring {
  openPageSetup: () => void;
  applyPageSetup: (fields: XlsxPageSetupFields) => void;
  print: () => void;
  exportCsv: () => void;
  dialog: ReactNode;
}

export function useXlsxPageSetup(options: XlsxPageSetupOptions): XlsxPageSetupWiring {
  const { host, selection, activeSheet, readOnly, canEdit, edit, onApplied, onError } = options;
  const [pageSetupOpen, setPageSetupOpen] = useState(false);
  const sheetName = selection?.sheet ?? activeSheet;

  // One set_page_setup op the session model folds; the gateway merges each
  // present field into the worksheet and keeps the rest verbatim.
  const applyPageSetup = useCallback((fields: XlsxPageSetupFields) => {
    if (!canEdit || !edit || !sheetName) return;
    void Promise.resolve(edit([{ op: "set_page_setup", target: { sheet: sheetName }, attributes: fields }]))
      .then(() => { onApplied(); })
      .catch((error: unknown) => onError(error instanceof Error ? error.message : String(error)));
  }, [canEdit, edit, onApplied, onError, sheetName]);

  // Export CSV: the active sheet's used range read through the render host
  // (cached formula results, the way the grid shows them), serialized by the
  // pure serializer and downloaded in this host.
  const exportCsv = useCallback(() => {
    const sheet = host?.file.sheets.find((candidate) => candidate.name === sheetName) ?? host?.file.sheets[0];
    if (!host || !sheet) return;
    void host.readRange({
      sessionId: host.file.sessionId,
      sheetId: sheet.id,
      range: { startRow: 0, endRow: Math.max(0, sheet.rowCount - 1), startColumn: 0, endColumn: Math.max(0, sheet.columnCount - 1) },
    }).then((result) => {
      const cells: Record<string, { v: string | number | boolean | null }> = {};
      for (const cell of result.cells) cells[toA1Address(cell.row, cell.column)] = { v: cell.value };
      downloadCsvFile(csvFilename(sheet.name), serializeSheetToCsv({ cells, rowCount: sheet.rowCount, columnCount: sheet.columnCount }));
    }).catch((error: unknown) => onError(error instanceof Error ? error.message : String(error)));
  }, [host, onError, sheetName]);

  // Print: the host print path with the print stylesheet installed once.
  const print = useCallback(() => {
    installPrintStylesheet();
    printDocument();
  }, []);

  const dialog = pageSetupOpen
    ? <XlsxPageSetupDialog selection={selection} readOnly={readOnly} onApply={applyPageSetup} onClose={() => setPageSetupOpen(false)} />
    : null;

  return { openPageSetup: () => setPageSetupOpen(true), applyPageSetup, print, exportCsv, dialog };
}
