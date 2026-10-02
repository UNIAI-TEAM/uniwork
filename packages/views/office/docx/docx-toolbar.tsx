"use client";

import { Bold, ImagePlus, Italic, List, ListOrdered, Redo2, Save, Table2, Underline as UnderlineIcon, Undo2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Select } from "@uniwork/ui/components/ui/select";
import type { DocxFormatCommands, DocxFormatState, DocxSelection, DocxSaveCoordinator } from "./types";

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
  onSave?: () => void;
  /** Absent until a real editing surface (use-docx-tiptap-handle.ts) is
   * mounted — the format buttons stay disabled, same as a missing selection. */
  format: DocxFormatState | null;
  commands?: DocxFormatCommands;
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
  format,
  commands,
}: DocxToolbarProps) {
  const { t } = useTranslation();
  const blocked = readOnly || saving || !commands || !format;
  const selectionLabel = selection
    ? t("office.docx.selection.range", { from: selection.from, to: selection.to })
    : t("office.docx.selection.none");
  const headingValue = format?.headingLevel ? String(format.headingLevel) : "paragraph";

  return (
    <div
      className="flex min-h-11 flex-wrap items-center gap-1 border-b border-border bg-muted/30 px-2 py-1"
      data-testid="docx-toolbar"
      aria-label={t("office.docx.toolbar.label")}
      role="toolbar"
    >
      <Button type="button" variant="toolbar" size="icon-sm" aria-label={t("office.docx.actions.undo")} disabled={readOnly || saving || !canUndo} onClick={onUndo}>
        <Undo2 aria-hidden />
      </Button>
      <Button type="button" variant="toolbar" size="icon-sm" aria-label={t("office.docx.actions.redo")} disabled={readOnly || saving || !canRedo} onClick={onRedo}>
        <Redo2 aria-hidden />
      </Button>
      <span className="mx-1 h-5 w-px bg-border" aria-hidden />
      <Button
        type="button"
        variant="toolbar"
        size="icon-sm"
        aria-label={t("office.docx.commands.bold")}
        aria-pressed={format?.bold ?? false}
        disabled={blocked}
        onClick={() => commands?.toggleBold()}
      >
        <Bold aria-hidden />
      </Button>
      <Button
        type="button"
        variant="toolbar"
        size="icon-sm"
        aria-label={t("office.docx.commands.italic")}
        aria-pressed={format?.italic ?? false}
        disabled={blocked}
        onClick={() => commands?.toggleItalic()}
      >
        <Italic aria-hidden />
      </Button>
      <Button
        type="button"
        variant="toolbar"
        size="icon-sm"
        aria-label={t("office.docx.commands.underline")}
        aria-pressed={format?.underline ?? false}
        disabled={blocked}
        onClick={() => commands?.toggleUnderline()}
      >
        <UnderlineIcon aria-hidden />
      </Button>
      <span className="mx-1 h-5 w-px bg-border" aria-hidden />
      <Select
        aria-label={t("office.docx.commands.heading")}
        triggerVariant="subtle"
        value={headingValue}
        disabled={blocked}
        onValueChange={(value) => commands?.setHeading(value === "paragraph" ? null : Number(value))}
        items={[
          { value: "paragraph", label: t("office.docx.commands.headingParagraph") },
          { value: "1", label: t("office.docx.commands.headingLevel", { level: "1" }) },
          { value: "2", label: t("office.docx.commands.headingLevel", { level: "2" }) },
          { value: "3", label: t("office.docx.commands.headingLevel", { level: "3" }) },
        ]}
      />
      <Button
        type="button"
        variant="toolbar"
        size="icon-sm"
        aria-label={t("office.docx.commands.bulletList")}
        aria-pressed={format?.listKind === "bullet"}
        disabled={blocked}
        onClick={() => commands?.toggleList("bullet")}
      >
        <List aria-hidden />
      </Button>
      <Button
        type="button"
        variant="toolbar"
        size="icon-sm"
        aria-label={t("office.docx.commands.orderedList")}
        aria-pressed={format?.listKind === "ordered"}
        disabled={blocked}
        onClick={() => commands?.toggleList("ordered")}
      >
        <ListOrdered aria-hidden />
      </Button>
      <span className="mx-1 h-5 w-px bg-border" aria-hidden />
      <Button type="button" variant="toolbar" size="icon-sm" aria-label={t("office.docx.commands.table")} aria-disabled="true" title={t("office.docx.capabilityPending")}>
        <Table2 aria-hidden />
      </Button>
      <Button type="button" variant="toolbar" size="icon-sm" aria-label={t("office.docx.commands.image")} aria-disabled="true" title={t("office.docx.capabilityPending")}>
        <ImagePlus aria-hidden />
      </Button>
      <span className="min-w-0 flex-1 truncate px-2 text-caption text-muted-foreground" data-testid="docx-selection">
        {selectionLabel}
      </span>
      {onSave ? <Button
        type="button"
        variant="brand"
        size="sm"
        aria-disabled={readOnly || saving || !dirty || undefined}
        disabled={readOnly || saving || !dirty}
        data-testid="docx-save"
        onClick={() => onSave()}
      >
        <Save aria-hidden />
        {saving ? t("office.docx.actions.saving") : t("office.docx.actions.save")}
      </Button> : null}
      {onSave ? <span className="sr-only" role="status" aria-live="polite">
        {t(`office.docx.saveState.${coordinator.getState().state}`)}
      </span> : null}
    </div>
  );
}
