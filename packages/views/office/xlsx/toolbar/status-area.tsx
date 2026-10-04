"use client";

import type { Ref } from "react";
import { XlsxSheetTabs, type XlsxSheetTab } from "../sheet-tabs";
import type { XlsxSheetTabAction } from "../sheet-commands";
import { XlsxStatusBar } from "../status-bar";
import type { XlsxGridHostPort } from "../xlsx-grid-surface";
import type { XlsxSelection } from "../types";

export interface XlsxStatusAreaProps {
  /** Focus target for the "show sheets" command (kept in the shell). */
  sheetTabsRef: Ref<HTMLDivElement>;
  tabs: readonly XlsxSheetTab[];
  activeSheet: string | null;
  canEdit: boolean;
  onSelect: (sheet: string) => void;
  onAction: (action: XlsxSheetTabAction) => void;
  documentKey: string;
  host?: XlsxGridHostPort;
  selection: XlsxSelection | null;
  dirtyGeneration: number;
}

/**
 * FIX-CHROME C11 (UNI-926): the XLSX status area. The sheet tabs sit HERE, in
 * the status area at the bottom next to the selection summary - not above the
 * formula bar. Extracted from `xlsx-editor.tsx` so the shell stays inside its
 * line budget; the strip and the status bar are unchanged.
 */
export function XlsxStatusArea({
  sheetTabsRef,
  tabs,
  activeSheet,
  canEdit,
  onSelect,
  onAction,
  documentKey,
  host,
  selection,
  dirtyGeneration,
}: XlsxStatusAreaProps) {
  return (
    <div className="flex shrink-0 items-center border-t border-border" data-testid="xlsx-status-area">
      <div ref={sheetTabsRef} tabIndex={-1} className="min-w-0 flex-1 outline-none">
        <XlsxSheetTabs tabs={tabs} activeSheet={activeSheet} canEdit={canEdit} onSelect={onSelect} onAction={onAction} />
      </div>
      <XlsxStatusBar className="shrink-0 border-t-0" documentKey={documentKey} host={host} selection={selection} dirtyGeneration={dirtyGeneration} />
    </div>
  );
}
