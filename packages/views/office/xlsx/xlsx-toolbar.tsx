"use client";

import { Save } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { XlsxToolbarGroupStrip } from "./toolbar/group-strip";
import { XLSX_TOOLBAR_GROUPS } from "./toolbar/registry";
import { XlsxToolbarTabStrip } from "./toolbar/tab-strip";
import { toolbarPanelDomId, toolbarTabDomId, XLSX_TOOLBAR_TABS } from "./toolbar/tabs";
import type { XlsxToolbarGroupDefinition, XlsxToolbarGroupProps, XlsxToolbarTabId } from "./toolbar/types";
import type { XlsxEditorPermissions, XlsxSaveCoordinator, XlsxSelection } from "./types";

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
 * The shell owns the ARIA tablist, the measured overflow and the persistent
 * right-side cluster (selection label, Save, Save progress/cancel, the recalc
 * and save-state live regions) so a save is never hidden behind a tab.
 * Command groups come from `toolbar/registry.ts` - Wave A tasks append there. */
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
  const groupsByTab = useMemo(() => {
    const map = new Map<XlsxToolbarTabId, XlsxToolbarGroupDefinition[]>(XLSX_TOOLBAR_TABS.map((tab) => [tab.id, []]));
    for (const group of XLSX_TOOLBAR_GROUPS) map.get(group.tab)?.push(group);
    return map;
  }, []);
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
      <XlsxToolbarTabStrip activeTab={activeTab} onActivate={setActiveTab} />
      <div className="flex min-h-11 flex-wrap items-center gap-1 px-2 py-1">
        {XLSX_TOOLBAR_TABS.map((tab) => (
          <div
            key={tab.id}
            id={toolbarPanelDomId(tab.id)}
            data-testid={toolbarPanelDomId(tab.id)}
            role="tabpanel"
            aria-labelledby={toolbarTabDomId(tab.id)}
            tabIndex={-1}
            hidden={tab.id !== activeTab}
            className={cn("min-w-0 flex-1 items-center gap-1", tab.id === activeTab && "flex")}
          >
            <XlsxToolbarGroupStrip tab={tab.id} groups={groupsByTab.get(tab.id) ?? []} context={groupProps} />
          </div>
        ))}
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
      </div>
    </div>
  );
}
