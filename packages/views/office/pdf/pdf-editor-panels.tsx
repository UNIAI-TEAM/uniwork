"use client";

import { X } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { PdfTextEditPanel, type PdfTextEditPanelProps } from "./text";
import { PdfImageEditPanel, type PdfImageEditPanelProps } from "./image";
import { PdfNotesPanel, type PdfNotesPanelProps } from "./notes";
import { PdfFormsPanel, type PdfFormsPanelProps } from "./forms";
import { PdfSavedSignaturePicker, type PdfSavedSignaturePickerProps } from "./signatures";
import { PdfStampPalette, type PdfStampPaletteProps } from "./stamps";
import { PdfPageOpsPanel, type PdfPageOpsPanelProps } from "./page-ops";
import { PdfNUpDialog, PdfPageSizeDialog, type PdfNUpDialogProps, type PdfPageSizeDialogProps } from "./page-box";
import { PdfDocumentPropertiesDialog, type PdfDocumentPropertiesDialogProps } from "./properties";
import { PdfTextMarkupTools, type PdfTextMarkupToolsProps } from "./markups";
import { PdfDrawingTools, type PdfDrawingToolsProps } from "./drawings";
import { PdfInkTools, type PdfInkToolsProps } from "./ink";

/**
 * The panels the PDF editor shell can host. `page-box` and `properties` are
 * modal dialogs, so they have no inline body: their slot mounts the dialog and
 * the dialog's own `open` decides visibility.
 */
export type PdfEditorPanelId =
  | "text"
  | "image"
  | "notes"
  | "forms"
  | "signatures"
  | "stamps"
  | "page-ops"
  | "page-box"
  | "properties"
  | "markups"
  | "drawings"
  | "ink";

/**
 * One optional props bag per panel, each exactly the panel's own props. A
 * missing bag means the shell cannot host that panel yet, so it renders
 * nothing instead of an empty frame. Providers stay here — the host never
 * invents one; the shell owns them and passes them through.
 */
export interface PdfEditorPanelSlots {
  text?: PdfTextEditPanelProps;
  image?: PdfImageEditPanelProps;
  notes?: PdfNotesPanelProps;
  forms?: PdfFormsPanelProps;
  signatures?: PdfSavedSignaturePickerProps;
  stamps?: PdfStampPaletteProps;
  pageOps?: PdfPageOpsPanelProps;
  pageSize?: PdfPageSizeDialogProps;
  nUp?: PdfNUpDialogProps;
  properties?: PdfDocumentPropertiesDialogProps;
  markups?: PdfTextMarkupToolsProps;
  drawings?: PdfDrawingToolsProps;
  ink?: PdfInkToolsProps;
}

export interface PdfEditorPanelsProps {
  /** The inline panel to show; `null` closes the host and renders nothing. */
  activePanel: PdfEditorPanelId | null;
  /** Given, the host draws a close control for the active panel. */
  onActivePanelChange?: (panel: PdfEditorPanelId | null) => void;
  /** Per-panel props the shell owns; omitted panels are simply not hosted. */
  slots?: PdfEditorPanelSlots;
  className?: string;
}

/** The inline body for one panel id; null for the dialog-only ids and for a
 * panel the shell did not supply props for. */
function activePanelBody(panel: PdfEditorPanelId, slots: PdfEditorPanelSlots): ReactNode {
  switch (panel) {
    case "text":
      return slots.text ? <PdfTextEditPanel {...slots.text} /> : null;
    case "image":
      return slots.image ? <PdfImageEditPanel {...slots.image} /> : null;
    case "notes":
      return slots.notes ? <PdfNotesPanel {...slots.notes} /> : null;
    case "forms":
      return slots.forms ? <PdfFormsPanel {...slots.forms} /> : null;
    case "signatures":
      return slots.signatures ? <PdfSavedSignaturePicker {...slots.signatures} /> : null;
    case "stamps":
      return slots.stamps ? <PdfStampPalette {...slots.stamps} /> : null;
    case "page-ops":
      return slots.pageOps ? <PdfPageOpsPanel {...slots.pageOps} /> : null;
    case "markups":
      return slots.markups ? <PdfTextMarkupTools {...slots.markups} /> : null;
    case "drawings":
      return slots.drawings ? <PdfDrawingTools {...slots.drawings} /> : null;
    case "ink":
      return slots.ink ? <PdfInkTools {...slots.ink} /> : null;
    // Dialogs mount below, independent of the active panel.
    case "page-box":
    case "properties":
      return null;
  }
}

/**
 * The PDF editor panel host (UNI-925 B-2). The shell mounts one of these and
 * sets `activePanel` from its ribbon; every panel keeps its own props contract
 * and its own provider, so this component stays presentational and never
 * reaches the engine. Modal panels (page size, N-up, document properties)
 * mount whenever their slot is supplied and show themselves when open.
 */
export function PdfEditorPanels({ activePanel, onActivePanelChange, slots = {}, className }: PdfEditorPanelsProps) {
  const { t } = useTranslation();
  const body = activePanel ? activePanelBody(activePanel, slots) : null;

  return (
    <>
      {body ? (
        <aside
          className={cn("flex w-64 shrink-0 flex-col gap-3 overflow-auto border-l border-border bg-muted/10 p-2", className)}
          data-testid="pdf-editor-panels"
          data-active-panel={activePanel ?? undefined}
        >
          {onActivePanelChange ? (
            <div className="flex justify-end">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={t("common.close")}
                onClick={() => onActivePanelChange(null)}
              >
                <X aria-hidden />
              </Button>
            </div>
          ) : null}
          {body}
        </aside>
      ) : null}
      {slots.pageSize ? <PdfPageSizeDialog {...slots.pageSize} /> : null}
      {slots.nUp ? <PdfNUpDialog {...slots.nUp} /> : null}
      {slots.properties ? <PdfDocumentPropertiesDialog {...slots.properties} /> : null}
    </>
  );
}
