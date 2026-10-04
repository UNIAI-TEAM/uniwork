"use client";

import { Save } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { OfficeRibbon } from "../ribbon";
import { xlsxRibbonTabs, XLSX_RIBBON_SCOPE } from "./toolbar/ribbon-data";
import type { XlsxToolbarGroupProps, XlsxToolbarTabId } from "./toolbar/types";
import type { XlsxSaveCoordinator } from "./types";

export interface XlsxToolbarProps extends XlsxToolbarGroupProps {
  coordinator: XlsxSaveCoordinator;
  dirty: boolean;
  saving: boolean;
  onSave: () => void;
  onCancelSave?: () => void;
  showSave?: boolean;
}

/** Commands are callbacks only. The toolbar has no byte, upload, or commit
 * path, which keeps every Save behind the G3-01 coordinator.
 *
 * Chrome amendment R (UNI-926): the shell now renders the SHARED <OfficeRibbon>
 * in place of the old tab strip + group strip. The ribbon owns the tab row, the
 * adaptive collapse, the collapse-to-tabs toggle and the simplified phone
 * layout; the shell keeps the persistent right-side cluster (selection label,
 * Save, Save progress/cancel, the recalc and save-state live regions) in the
 * ribbon's trailing slot so a save is never hidden behind a tab. Command groups
 * still come from `toolbar/registry.ts` via `toolbar/ribbon-data.ts`, so no
 * command, op or journal path changed. */
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
  sheetName,
  resolveSheetId,
  onOpenFunctionLibrary,
  onOpenShortcuts,
  formatState,
  onNumberFormat,
  recalculating,
  onUndo,
  onRedo,
  onRecalculate,
  onCopy,
  onPaste,
  onShowSheets,
  onOpenFind,
  onOpenAdvancedFilter,
  onOpenPageSetup,
  onPrint,
  onExportCsv,
  onSave,
  onCancelSave,
  showSave = true,
}: XlsxToolbarProps) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<XlsxToolbarTabId>("home");
  const blocked = readOnly;
  const state = coordinator.getState();
  const selectedAddress = selection?.endAddress ? `${selection.address}:${selection.endAddress}` : selection?.address;
  const selectionLabel = selection
    ? t("office.xlsx.selection.range", { sheet: selection.sheet, address: selectedAddress })
    : t("office.xlsx.selection.none");
  const groupProps: XlsxToolbarGroupProps = {
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
    sheetName,
    resolveSheetId,
    onOpenFunctionLibrary,
    onOpenShortcuts,
    formatState,
    recalculating,
    onNumberFormat,
    onUndo,
    onRedo,
    onRecalculate,
    onCopy,
    onPaste,
    onShowSheets,
    onOpenFind,
    onOpenAdvancedFilter,
    onOpenPageSetup,
    onPrint,
    onExportCsv,
  };

  return (
    <div className="flex flex-col border-b border-border bg-muted/30" data-testid="xlsx-toolbar" aria-label={t("office.xlsx.toolbar.label")}>
      <OfficeRibbon
        tabs={xlsxRibbonTabs(groupProps)}
        scope={XLSX_RIBBON_SCOPE}
        activeTabId={activeTab}
        onActiveTabChange={(id) => setActiveTab(id as XlsxToolbarTabId)}
        labelKey="office.ribbon.label"
        trailing={
          <>
            <span className="min-w-0 shrink truncate px-2 text-caption text-muted-foreground" data-testid="xlsx-selection">
              {selectionLabel}
            </span>
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
              {recalculating ? t("office.xlsx.recalc.progress", { progress: 0 }) : t(`office.xlsx.saveState.${state.state}`)}
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