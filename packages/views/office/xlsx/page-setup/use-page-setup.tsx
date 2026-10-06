"use client";

// C2 (UNI-926): the editor-side wiring for page setup, print and CSV export.
// UNI-952: print builds a copy of the active sheet and hands it to the
// injected port (print/use-xlsx-print.tsx); the dialog edits this session
// applied are kept per sheet so the copy honours them before a reopen.
// Extracted from xlsx-editor.tsx so that shell stays close to its size budget;
// this hook owns the dialog's open state, the set_page_setup op and the two
// host actions (print, CSV download). The pure serializer and DOM helpers live
// beside it (export/csv.ts, export/download.ts).

import { useCallback, useRef, useState, type ReactNode } from "react";
import type { XlsxPageSetupFields, XlsxWorkbookSnapshot } from "@uniwork/office-engine/xlsx";
import type { OfficePrintPort } from "../../print";
import { HeaderActionsFill } from "../../../layout/header-actions-slot";
import { useXlsxPrint } from "../print/use-xlsx-print";
import type { XlsxPrintGrid } from "../print/collect-live";
import type { XlsxGridHostPort } from "../xlsx-grid-surface";
import type { XlsxSelection } from "../types";
import { csvSheetFromSnapshot, serializeSheetToCsv } from "../export/csv";
import { csvFilename, downloadCsvFile } from "../export/download";
import { XlsxPageSetupDialog } from "./page-setup-dialog";

export interface XlsxPageSetupOptions {
  host: XlsxGridHostPort | undefined;
  selection: XlsxSelection | null;
  activeSheet: string | null;
  readOnly: boolean;
  canEdit: boolean;
  edit?: ((ops: readonly unknown[]) => Promise<void> | void) | undefined;
  /** The live session snapshot (kept current by every edit). Export CSV reads
   *  it rather than the open-time render model so unsaved in-session edits are
   *  included. */
  getSnapshot?: (() => XlsxWorkbookSnapshot | null) | undefined;
  onApplied: () => void;
  onError: (message: string) => void;
  /** UNI-952: the host print port (undefined = browser, null = none). */
  printPort?: OfficePrintPort | null | undefined;
  /** Printed document title. */
  title?: string | undefined;
  getGrid?: (() => XlsxPrintGrid | null) | undefined;
  resolveSheetId?: ((sheetName: string) => string | undefined) | undefined;
}

export interface XlsxPageSetupWiring {
  openPageSetup: () => void;
  applyPageSetup: (fields: XlsxPageSetupFields) => void;
  /** Absent when the host cannot print or no workbook is mounted. */
  print: (() => void) | undefined;
  /** A print run is pending (the ribbon button shows busy). */
  printBusy: boolean;
  /** The page header overflow-menu Print item (null without print). */
  printMenuItem: ReactNode;
  exportCsv: () => void;
  /** The dialog plus the print contribution to the page header menu and the
   *  print status line; the editor renders it once. */
  dialog: ReactNode;
}

export function useXlsxPageSetup(options: XlsxPageSetupOptions): XlsxPageSetupWiring {
  const { host, selection, activeSheet, readOnly, canEdit, edit, getSnapshot, onApplied, onError, printPort, title, getGrid, resolveSheetId } = options;
  const [pageSetupOpen, setPageSetupOpen] = useState(false);
  const sheetName = selection?.sheet ?? activeSheet;
  // Dialog edits applied this session, folded field-wise per sheet (last
  // write wins), like the session model folds the ops it saves. Keyed by the
  // sheet's grid id, so a later rename in the session keeps them.
  const sessionSetups = useRef(new Map<string, XlsxPageSetupFields>());

  // One set_page_setup op the session model folds; the gateway merges each
  // present field into the worksheet and keeps the rest verbatim.
  const applyPageSetup = useCallback((fields: XlsxPageSetupFields) => {
    if (!canEdit || !edit || !sheetName) return;
    void Promise.resolve(edit([{ op: "set_page_setup", target: { sheet: sheetName }, attributes: fields }]))
      .then(() => {
        const sheetKey = resolveSheetId?.(sheetName) ?? sheetName;
        sessionSetups.current.set(sheetKey, { ...sessionSetups.current.get(sheetKey), ...fields });
        onApplied();
      })
      .catch((error: unknown) => onError(error instanceof Error ? error.message : String(error)));
  }, [canEdit, edit, onApplied, onError, resolveSheetId, sheetName]);

  // Export CSV: the active sheet read from the LIVE session snapshot (kept
  // current by every edit), serialized by the pure serializer and downloaded
  // in this host. The open-time render model is deliberately not used: it is
  // built once at open and would silently omit unsaved in-session edits.
  const exportCsv = useCallback(() => {
    if (!host) return;
    const snapshot = getSnapshot?.();
    const sheets = snapshot?.sheets ?? [];
    const sheet = sheets.find((candidate) => candidate.name === sheetName) ?? sheets[0];
    if (!sheet) return;
    downloadCsvFile(csvFilename(sheet.name), serializeSheetToCsv(csvSheetFromSnapshot(sheet)));
  }, [getSnapshot, host, sheetName]);

  const printing = useXlsxPrint({
    port: printPort,
    host,
    sheetName,
    resolveSheetId,
    getSnapshot,
    getGrid,
    getSession: (sheetKey) => sessionSetups.current.get(sheetKey),
    title: title ?? host?.file.name ?? "",
  });

  const dialog = (
    <>
      {pageSetupOpen
        ? <XlsxPageSetupDialog selection={selection} readOnly={readOnly} onApply={applyPageSetup} onClose={() => setPageSetupOpen(false)} />
        : null}
      {printing.menuItem ? <HeaderActionsFill menuItems={printing.menuItem} /> : null}
      {printing.notice}
    </>
  );

  return {
    openPageSetup: () => setPageSetupOpen(true),
    applyPageSetup,
    print: printing.print,
    printBusy: printing.busy,
    printMenuItem: printing.menuItem,
    exportCsv,
    dialog,
  };
}
