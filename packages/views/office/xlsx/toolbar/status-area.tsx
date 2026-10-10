"use client";

import type { Ref } from "react";
import { CircleQuestionMark } from "lucide-react";
import type { XlsxWorkbookSnapshot } from "@uniwork/office-engine/xlsx";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { OfficeStatusBar, OfficeStatusZoom } from "../../frame";
import { XlsxSheetTabs, type XlsxSheetTab } from "../sheet-tabs";
import type { XlsxSheetTabAction } from "../sheet-commands";
import { XlsxStatusBar } from "../status-bar";
import { stepZoom, XLSX_ZOOM_DEFAULT, XLSX_ZOOM_MAX, XLSX_ZOOM_MIN } from "../view/zoom";
import type { XlsxGridHostPort } from "../xlsx-grid-surface";
import type { XlsxSelection } from "../types";
import type { XlsxToolbarGroupProps } from "./types";
import { XLSX_ZOOM_SET_COMMAND, zoomRatioTarget, type XlsxViewEcho } from "./view-echo";

export interface XlsxSheetTabsRowProps {
  /** Focus target for the "show sheets" command (kept in the shell). */
  sheetTabsRef: Ref<HTMLDivElement>;
  tabs: readonly XlsxSheetTab[];
  activeSheet: string | null;
  canEdit: boolean;
  onSelect: (sheet: string) => void;
  onAction: (action: XlsxSheetTabAction) => void;
}

/**
 * FRAME F10 (UNI-926): the sheet-tab row, mounted in OfficeFrame's `bottom`
 * slot - one row directly above the status bar, like Excel. The strip owns
 * its own surface and horizontal scroll.
 */
export function XlsxSheetTabsRow({ sheetTabsRef, tabs, activeSheet, canEdit, onSelect, onAction }: XlsxSheetTabsRowProps) {
  return (
    <div ref={sheetTabsRef} tabIndex={-1} className="min-w-0 shrink-0 outline-none" data-testid="xlsx-status-area">
      <XlsxSheetTabs tabs={tabs} activeSheet={activeSheet} canEdit={canEdit} onSelect={onSelect} onAction={onAction} />
    </div>
  );
}

export interface XlsxFrameStatusBarProps {
  /** Readout at the start of the row (save state, Excel's "Ready"). */
  stateLabel: string;
  documentKey: string;
  host?: XlsxGridHostPort;
  selection: XlsxSelection | null;
  dirtyGeneration: number;
  viewEcho: XlsxViewEcho;
  /** F2: the live workbook snapshot the selection summary reads (never the frozen open-time model). */
  snapshot?: XlsxWorkbookSnapshot | null;
  commands?: XlsxToolbarGroupProps["commands"];
  onOpenShortcuts?: () => void;
}

/**
 * FRAME F9 (UNI-926): the ONE status row of the XLSX frame - state at the
 * start, the selection summary and the zoom at the end, help last. The zoom
 * shares the ribbon's hoisted echo and sends the same absolute command as
 * View > Zoom, so both controls always agree.
 */
export function XlsxFrameStatusBar({ stateLabel, documentKey, host, selection, dirtyGeneration, viewEcho, snapshot, commands, onOpenShortcuts }: XlsxFrameStatusBarProps) {
  const { t } = useTranslation();
  const zoomTo = (percent: number) => {
    if (!commands) return;
    void commands.execute(XLSX_ZOOM_SET_COMMAND, zoomRatioTarget(percent));
    viewEcho.setZoomPercent(percent);
  };
  const zoomable = commands !== null && commands !== undefined;
  return (
    <OfficeStatusBar
      start={<span data-testid="xlsx-status-state">{stateLabel}</span>}
      end={
        <>
          <XlsxStatusBar inline documentKey={documentKey} host={host} selection={selection} dirtyGeneration={dirtyGeneration} snapshot={snapshot} />
          <OfficeStatusZoom
            value={viewEcho.zoomPercent}
            min={XLSX_ZOOM_MIN}
            max={XLSX_ZOOM_MAX}
            onZoomIn={zoomable ? () => zoomTo(stepZoom(viewEcho.zoomPercent, 1)) : undefined}
            onZoomOut={zoomable ? () => zoomTo(stepZoom(viewEcho.zoomPercent, -1)) : undefined}
            onReset={zoomable ? () => zoomTo(XLSX_ZOOM_DEFAULT) : undefined}
          />
        </>
      }
      help={
        onOpenShortcuts ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={t("office.xlsx.shortcuts.open")}
            title={t("office.xlsx.shortcuts.openHint")}
            aria-haspopup="dialog"
            data-testid="xlsx-status-help"
            onClick={onOpenShortcuts}
          >
            <CircleQuestionMark aria-hidden />
          </Button>
        ) : null
      }
    />
  );
}
