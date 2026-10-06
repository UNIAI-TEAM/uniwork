"use client";

import { FilePlus2, ImagePlus, RotateCw, Save, Undo2, Redo2, Type, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import type { PdfSaveCoordinator, PdfSelection } from "./types";

export interface PdfToolbarProps {
  coordinator: PdfSaveCoordinator;
  dirty: boolean;
  saving: boolean;
  readOnly?: boolean;
  selection: PdfSelection | null;
  canUndo: boolean;
  canRedo: boolean;
  canEditText: boolean;
  canReplaceImage: boolean;
  canPageOps: boolean;
  canAnnotate: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onEditText: () => void;
  onReplaceImage: () => void;
  onInsertPage: () => void;
  onDeletePage: () => void;
  onRotatePage: () => void;
  onReorderPage: () => void;
  onExtractPage: () => void;
  onMergePages: () => void;
  onAnnotate?: () => void;
  onSave: () => void;
}

/** Commands are callbacks only. The toolbar cannot see bytes, paths, or an
 * engine transport; Save therefore always remains coordinator-owned. */
export function PdfToolbar({
  coordinator,
  dirty,
  saving,
  readOnly = false,
  selection,
  canUndo,
  canRedo,
  canEditText,
  canReplaceImage,
  canPageOps,
  canAnnotate,
  onUndo,
  onRedo,
  onEditText,
  onReplaceImage,
  onInsertPage,
  onDeletePage,
  onRotatePage,
  onReorderPage,
  onExtractPage,
  onMergePages,
  onAnnotate,
  onSave,
}: PdfToolbarProps) {
  const { t } = useTranslation();
  const blocked = readOnly || saving;
  const hasPage = selection?.page !== undefined;
  // Undo/Redo stay focusable on an empty stack: aria-disabled, blocked in JS.
  const undoBlocked = blocked || !canUndo;
  const redoBlocked = blocked || !canRedo;

  return (
    <div className="flex min-h-11 flex-wrap items-center gap-1 border-b border-border bg-muted/30 px-2 py-1" data-testid="pdf-toolbar" aria-label={t("office.pdf.toolbar.label")} role="toolbar">
      <Button type="button" variant="toolbar" size="icon-sm" aria-label={t("office.pdf.actions.undo")} aria-disabled={undoBlocked || undefined} onClick={() => { if (!undoBlocked) onUndo(); }}><Undo2 aria-hidden /></Button>
      <Button type="button" variant="toolbar" size="icon-sm" aria-label={t("office.pdf.actions.redo")} aria-disabled={redoBlocked || undefined} onClick={() => { if (!redoBlocked) onRedo(); }}><Redo2 aria-hidden /></Button>
      <span className="mx-1 h-5 w-px bg-border" aria-hidden />
      <Button type="button" variant="toolbar" size="icon-sm" aria-label={t("office.pdf.commands.editText")} disabled={blocked || !canEditText || selection?.kind !== "text"} onClick={onEditText}><Type aria-hidden /></Button>
      <Button type="button" variant="toolbar" size="icon-sm" aria-label={t("office.pdf.commands.replaceImage")} disabled={blocked || !canReplaceImage || selection?.kind !== "image"} onClick={onReplaceImage}><ImagePlus aria-hidden /></Button>
      <Button type="button" variant="toolbar" size="icon-sm" aria-label={t("office.pdf.commands.insertPage")} disabled={blocked || !canPageOps} onClick={onInsertPage}><FilePlus2 aria-hidden /></Button>
      <Button type="button" variant="toolbar" size="icon-sm" aria-label={t("office.pdf.commands.deletePage")} disabled={blocked || !canPageOps || !hasPage} onClick={onDeletePage}><Trash2 aria-hidden /></Button>
      <Button type="button" variant="toolbar" size="icon-sm" aria-label={t("office.pdf.commands.rotatePage")} disabled={blocked || !canPageOps || !hasPage} onClick={onRotatePage}><RotateCw aria-hidden /></Button>
      <Button type="button" variant="toolbar" size="sm" aria-label={t("office.pdf.commands.reorderPage")} disabled={blocked || !canPageOps || !hasPage} onClick={onReorderPage}>{t("office.pdf.commands.reorderPage")}</Button>
      <Button type="button" variant="toolbar" size="sm" aria-label={t("office.pdf.commands.extractPage")} disabled={blocked || !canPageOps || !hasPage} onClick={onExtractPage}>{t("office.pdf.commands.extractPage")}</Button>
      <Button type="button" variant="toolbar" size="sm" aria-label={t("office.pdf.commands.mergePages")} disabled={blocked || !canPageOps} onClick={onMergePages}>{t("office.pdf.commands.mergePages")}</Button>
      <Button type="button" variant="toolbar" size="sm" aria-label={t("office.pdf.commands.annotations")} disabled={blocked || !canAnnotate} onClick={onAnnotate}>{t("office.pdf.commands.annotations")}</Button>
      <span className="min-w-0 flex-1 truncate px-2 text-caption text-muted-foreground" data-testid="pdf-selection">{selection ? t("office.pdf.selection.page", { page: selection.page }) : t("office.pdf.selection.none")}</span>
      <Button type="button" variant="brand" size="sm" aria-disabled={blocked || !dirty || undefined} disabled={blocked || !dirty} data-testid="pdf-save" onClick={onSave}><Save aria-hidden />{saving ? t("office.pdf.actions.saving") : t("office.pdf.actions.save")}</Button>
      <span className="sr-only" role="status" aria-live="polite">{t(`office.pdf.saveState.${coordinator.getState().state}`)}</span>
    </div>
  );
}
