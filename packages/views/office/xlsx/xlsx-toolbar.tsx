"use client";

import { Redo2, Save, Search, Undo2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { OfficeRibbon } from "../ribbon";
import { forgetAppliedFormat } from "./number-format/applied-format";
import { xlsxRibbonTabs, XLSX_RIBBON_SCOPE } from "./toolbar/ribbon-data";
import { useViewEcho } from "./toolbar/view-echo";
import type { XlsxToolbarGroupProps, XlsxToolbarTabId } from "./toolbar/types";
import type { XlsxSaveCoordinator } from "./types";

export interface XlsxToolbarProps extends XlsxToolbarGroupProps {
  coordinator: XlsxSaveCoordinator;
  dirty: boolean;
  saving: boolean;
  onSave: () => void;
  onCancelSave?: () => void;
  showSave?: boolean;
  /** Where a confirmed save lands; local reads "saved on this device". */
  saveDestination?: "cloud" | "local";
}

/** Commands are callbacks only. The toolbar has no byte, upload, or commit
 * path, which keeps every Save behind the G3-01 coordinator.
 *
 * Chrome amendment R (UNI-926): the shell renders the SHARED <OfficeRibbon>
 * in place of the old tab strip + group strip. The ribbon owns the tab row, the
 * adaptive collapse, the collapse-to-tabs toggle and the simplified phone
 * layout; the shell keeps the persistent right-side cluster (Save, Save
 * progress/cancel, the recalc and save-state live regions) in the ribbon's
 * trailing slot so a save is never hidden behind a tab. Command groups still
 * come from `toolbar/registry.ts` via `toolbar/ribbon-data.ts`, so no command,
 * op or journal path changed.
 *
 * FIX-CHROME C6 (UNI-926): Undo/Redo move to the ribbon's quick-access slot at
 * the FAR LEFT of the tab row (before the tabs); Find & replace moves to the
 * FAR RIGHT of the tab row (trailing). The cell address is no longer shown in
 * the tab row - it belongs in the formula bar's name box and the status bar. */
export function XlsxToolbar({
  coordinator,
  dirty,
  saving,
  readOnly = false,
  permissions = {},
  selection,
  canUndo,
  canRedo,
  canRecalculate,
  canFormat,
  commands,
  host,
  unitId,
  documentKey,
  sheetName,
  resolveSheetId,
  tables,
  snapshot,
  readLiveSnapshot,
  onOpenFunctionLibrary,
  onOpenShortcuts,
  formatState,
  onNumberFormat,
  recalculating,
  onUndo,
  onRedo,
  onRecalculate,
  onCut,
  onCopy,
  onPaste,
  onShowSheets,
  onOpenFind,
  onOpenAdvancedFilter,
  onOpenPageSetup,
  onPrint,
  onExportCsv,
  onOpenProtect,
  onSave,
  onCancelSave,
  showSave = true,
  saveDestination = "cloud",
  viewEcho: externalViewEcho,
}: XlsxToolbarProps) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<XlsxToolbarTabId>("home");
  // The renderer view-state echoes (zoom percent, gridlines/headers, painter
  // armed) live HERE, in the shell that stays mounted for the whole session:
  // the ribbon mounts only the active tab's groups, so a group-local echo
  // would reset on every tab switch while the renderer kept its state.
  // FRAME: the editor lifts the echo so the status-bar zoom shares it.
  const viewEcho = useViewEcho(externalViewEcho);
  // The shell lives as long as the document: closing it drops its applied format.
  useEffect(() => (documentKey ? () => forgetAppliedFormat(documentKey) : undefined), [documentKey]);
  const blocked = readOnly;
  const state = coordinator.getState();
  const groupProps: XlsxToolbarGroupProps = {
    viewEcho,
    readOnly,
    permissions,
    selection,
    canUndo,
    canRedo,
    canRecalculate,
    canFormat,
    commands,
    host,
    unitId,
    documentKey,
    sheetName,
    resolveSheetId,
    tables,
    snapshot,
    readLiveSnapshot,
    onOpenFunctionLibrary,
    onOpenShortcuts,
    formatState,
    recalculating,
    onNumberFormat,
    onUndo,
    onRedo,
    onRecalculate,
    onCut,
    onCopy,
    onPaste,
    onShowSheets,
    onOpenFind,
    onOpenAdvancedFilter,
    onOpenPageSetup,
    onPrint,
    onExportCsv,
    onOpenProtect,
  };
  const findBlocked = blocked || !commands || !onOpenFind;

  return (
    <div className="shrink-0" data-testid="xlsx-toolbar" aria-label={t("office.xlsx.toolbar.label")}>
      <OfficeRibbon
        tabs={xlsxRibbonTabs(groupProps)}
        scope={XLSX_RIBBON_SCOPE}
        activeTabId={activeTab}
        onActiveTabChange={(id) => setActiveTab(id as XlsxToolbarTabId)}
        labelKey="office.ribbon.label"
        quickAccess={
          <>
            <Button
              type="button"
              variant="toolbar"
              size="icon-sm"
              aria-label={t("office.xlsx.actions.undo")}
              aria-disabled={blocked || !canUndo || undefined}
              data-testid="xlsx-undo"
              onClick={onUndo}
            >
              <Undo2 aria-hidden />
            </Button>
            <Button
              type="button"
              variant="toolbar"
              size="icon-sm"
              aria-label={t("office.xlsx.actions.redo")}
              aria-disabled={blocked || !canRedo || undefined}
              data-testid="xlsx-redo"
              onClick={onRedo}
            >
              <Redo2 aria-hidden />
            </Button>
          </>
        }
        trailing={
          <>
            <Button
              type="button"
              variant="toolbar"
              size="icon-sm"
              aria-label={t("office.xlsx.toolbar.groups.find.label")}
              aria-haspopup="dialog"
              aria-disabled={findBlocked || undefined}
              data-testid="xlsx-find-open"
              onClick={() => {
                if (findBlocked) return;
                onOpenFind?.();
              }}
            >
              <Search aria-hidden />
            </Button>
            {showSave ? (
              <Button
                type="button"
                variant="brand"
                size="sm"
                aria-disabled={blocked || saving || !dirty || undefined}
                data-testid="xlsx-save"
                onClick={onSave}
              >
                <Save aria-hidden />
                {saving ? t("office.xlsx.actions.saving") : t("office.xlsx.actions.save")}
              </Button>
            ) : null}
            <span className="sr-only" role="status" aria-live="polite">
              {recalculating ? t("office.xlsx.recalc.progress", { progress: 0 }) : t(state.state === "saved" && saveDestination === "local" ? "office.xlsx.saveState.savedLocal" : `office.xlsx.saveState.${state.state}`)}
            </span>
            {saving ? (
              <>
                <progress className="w-20" aria-label={t("office.xlsx.actions.saving")} data-testid="xlsx-save-progress" />
                {onCancelSave ? (
                  <Button type="button" variant="toolbar" size="sm" onClick={onCancelSave} data-testid="xlsx-save-cancel">
                    {t("common.cancel")}
                  </Button>
                ) : null}
              </>
            ) : null}
          </>
        }
      />
    </div>
  );
}
