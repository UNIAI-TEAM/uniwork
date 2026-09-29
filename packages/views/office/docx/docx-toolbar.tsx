"use client";

import { Bold, ImagePlus, Italic, Redo2, Save, Table2, Undo2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import type { DocxSelection, DocxSaveCoordinator } from "./types";

export interface DocxToolbarProps {
  coordinator: DocxSaveCoordinator;
  dirty: boolean;
  saving: boolean;
  readOnly?: boolean;
  selection: DocxSelection | null;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onSave: () => void;
}

/** DOCX commands are intentionally callbacks. A toolbar never receives bytes,
 * a host adapter, or a transport, so every Save stays on the coordinator path. */
export function DocxToolbar({
  coordinator,
  dirty,
  saving,
  readOnly = false,
  selection,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onSave,
}: DocxToolbarProps) {
  const { t } = useTranslation();
  const blocked = readOnly || saving;
  const selectionLabel = selection
    ? t("office.docx.selection.range", { from: selection.from, to: selection.to })
    : t("office.docx.selection.none");

  return (
    <div
      className="flex min-h-11 flex-wrap items-center gap-1 border-b border-border bg-muted/30 px-2 py-1"
      data-testid="docx-toolbar"
      aria-label={t("office.docx.toolbar.label")}
    >
      <Button type="button" variant="toolbar" size="icon-sm" aria-label={t("office.docx.actions.undo")} disabled={blocked || !canUndo} onClick={onUndo}>
        <Undo2 aria-hidden />
      </Button>
      <Button type="button" variant="toolbar" size="icon-sm" aria-label={t("office.docx.actions.redo")} disabled={blocked || !canRedo} onClick={onRedo}>
        <Redo2 aria-hidden />
      </Button>
      <span className="mx-1 h-5 w-px bg-border" aria-hidden />
      <Button type="button" variant="toolbar" size="icon-sm" aria-label={t("office.docx.commands.bold")} aria-disabled="true" title={t("office.docx.capabilityPending")}>
        <Bold aria-hidden />
      </Button>
      <Button type="button" variant="toolbar" size="icon-sm" aria-label={t("office.docx.commands.italic")} aria-disabled="true" title={t("office.docx.capabilityPending")}>
        <Italic aria-hidden />
      </Button>
      <Button type="button" variant="toolbar" size="icon-sm" aria-label={t("office.docx.commands.table")} aria-disabled="true" title={t("office.docx.capabilityPending")}>
        <Table2 aria-hidden />
      </Button>
      <Button type="button" variant="toolbar" size="icon-sm" aria-label={t("office.docx.commands.image")} aria-disabled="true" title={t("office.docx.capabilityPending")}>
        <ImagePlus aria-hidden />
      </Button>
      <span className="min-w-0 flex-1 truncate px-2 text-caption text-muted-foreground" data-testid="docx-selection">
        {selectionLabel}
      </span>
      <Button
        type="button"
        variant="brand"
        size="sm"
        aria-disabled={blocked || !dirty || undefined}
        disabled={blocked || !dirty}
        data-testid="docx-save"
        onClick={onSave}
      >
        <Save aria-hidden />
        {saving ? t("office.docx.actions.saving") : t("office.docx.actions.save")}
      </Button>
      <span className="sr-only" role="status" aria-live="polite">
        {t(`office.docx.saveState.${coordinator.getState().state}`)}
      </span>
    </div>
  );
}
