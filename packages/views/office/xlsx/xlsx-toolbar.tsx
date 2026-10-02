"use client";

import {
  Calculator,
  BarChart3,
  Clipboard,
  Copy,
  Grid3X3,
  Redo2,
  Save,
  Undo2,
} from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import type { XlsxCapability, XlsxEditorPermissions, XlsxSelection, XlsxSaveCoordinator } from "./types";

export interface XlsxToolbarProps {
  coordinator: XlsxSaveCoordinator;
  dirty: boolean;
  saving: boolean;
  readOnly?: boolean;
  permissions?: XlsxEditorPermissions;
  selection: XlsxSelection | null;
  canUndo: boolean;
  canRedo: boolean;
  canRecalculate: boolean;
  canFormat: boolean;
  onNumberFormat: () => void;
  recalculating: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onRecalculate: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onShowSheets: () => void;
  onSave: () => void;
  onCancelSave?: () => void;
}

function CapabilityButton({
  label,
  capability,
  children,
}: {
  label: string;
  capability?: XlsxCapability;
  children: ReactNode;
}) {
  const unavailable = capability !== undefined && capability.status !== "available";
  return (
    <Button
      type="button"
      variant="toolbar"
      size="icon-sm"
      aria-label={label}
      aria-disabled={unavailable || undefined}
      disabled={unavailable}
      title={capability?.reason ?? undefined}
    >
      {children}
    </Button>
  );
}

/** Commands are callbacks only. The toolbar has no byte, upload, or commit
 * path, which keeps every Save behind the G3-01 coordinator. */
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
  onNumberFormat,
  recalculating,
  onUndo,
  onRedo,
  onRecalculate,
  onCopy,
  onPaste,
  onShowSheets,
  onSave,
  onCancelSave,
}: XlsxToolbarProps) {
  const { t } = useTranslation();
  const blocked = readOnly;
  const noSelection = selection === null;
  const state = coordinator.getState();
  const selectedAddress = selection?.endAddress ? `${selection.address}:${selection.endAddress}` : selection?.address;
  const selectionLabel = selection
    ? t("office.xlsx.selection.range", { sheet: selection.sheet, address: selectedAddress })
    : t("office.xlsx.selection.none");

  return (
    <div
      className="flex min-h-11 flex-wrap items-center gap-1 border-b border-border bg-muted/30 px-2 py-1"
      data-testid="xlsx-toolbar"
      aria-label={t("office.xlsx.toolbar.label")}
    >
      <Button type="button" variant="toolbar" size="icon-sm" aria-label={t("office.xlsx.actions.undo")} disabled={blocked || !canUndo} onClick={onUndo}>
        <Undo2 aria-hidden />
      </Button>
      <Button type="button" variant="toolbar" size="icon-sm" aria-label={t("office.xlsx.actions.redo")} disabled={blocked || !canRedo} onClick={onRedo}>
        <Redo2 aria-hidden />
      </Button>
      <span className="mx-1 h-5 w-px bg-border" aria-hidden />
      <Button type="button" variant="toolbar" size="icon-sm" aria-label={t("office.xlsx.commands.sheets")} onClick={onShowSheets}>
        <Grid3X3 aria-hidden />
      </Button>
      <Button type="button" variant="toolbar" size="icon-sm" aria-label={t("office.xlsx.commands.numberFormat")} disabled={blocked || !canFormat} onClick={onNumberFormat} title="0.00">
        <span aria-hidden className="text-caption font-semibold">123</span>
      </Button>
      <CapabilityButton label={t("office.xlsx.commands.chart")} capability={{
        format: "xlsx",
        operation: "chart",
        host: "browser",
        engineBuild: "g2-04",
        contractRevision: "xlsx/1",
        status: "unavailable",
        reason: t("office.xlsx.capabilityPending"),
        fidelityWarnings: [],
      }}>
        <BarChart3 aria-hidden />
      </CapabilityButton>
      <Button type="button" variant="toolbar" size="icon-sm" aria-label={t("office.xlsx.actions.copy")} disabled={blocked || noSelection || permissions.canCopy === false} onClick={onCopy}>
        <Copy aria-hidden />
      </Button>
      <Button type="button" variant="toolbar" size="icon-sm" aria-label={t("office.xlsx.actions.paste")} disabled={blocked || noSelection || permissions.canPaste === false} onClick={onPaste}>
        <Clipboard aria-hidden />
      </Button>
      {canRecalculate ? <Button type="button" variant="toolbar" size="icon-sm" aria-label={t("office.xlsx.actions.recalculate")} disabled={blocked} onClick={onRecalculate}>
        <Calculator aria-hidden />
      </Button> : null}
      <span className="min-w-0 flex-1 truncate px-2 text-caption text-muted-foreground" data-testid="xlsx-selection">
        {selectionLabel}
      </span>
      <Button
        type="button"
        variant="brand"
        size="sm"
        aria-disabled={blocked || saving || !dirty || undefined}
        disabled={blocked || saving || !dirty}
        data-testid="xlsx-save"
        onClick={onSave}
      >
        <Save aria-hidden />
        {saving ? t("office.xlsx.actions.saving") : t("office.xlsx.actions.save")}
      </Button>
      <span className="sr-only" role="status" aria-live="polite">
        {recalculating ? t("office.xlsx.recalc.progress", { progress: 0 }) : t(`office.xlsx.saveState.${state.state}`)}
      </span>
      {saving ? <>
        <progress className="w-20" aria-label={t("office.xlsx.actions.saving")} data-testid="xlsx-save-progress" />
        {onCancelSave ? <Button type="button" variant="toolbar" size="sm" onClick={onCancelSave} data-testid="xlsx-save-cancel">{t("common.cancel")}</Button> : null}
      </> : null}
    </div>
  );
}
