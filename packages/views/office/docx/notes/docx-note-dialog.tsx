"use client";

// B3 (UNI-924): the insert-note dialog (genoffice's NotePrompt, review-actions
// :62-82). The caller inserts the marker at the caret and appends the list
// entry through the notes controller; this file only collects the text.
import { useEffect, useId, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@uniwork/ui/components/ui/dialog";
import { Label } from "@uniwork/ui/components/ui/label";
import { Textarea } from "@uniwork/ui/components/ui/textarea";
import type { DocxNoteKind } from "@uniwork/office-engine/docx";

export interface DocxNoteDialogProps {
  open: boolean;
  kind: DocxNoteKind;
  onOpenChange: (open: boolean) => void;
  /** Insert the note (marker + list entry); false when the editor refused the
   * reference, so the dialog stays open and reports it. The text is trimmed. */
  onSubmit: (text: string) => boolean;
}

export function DocxNoteDialog({ open, kind, onOpenChange, onSubmit }: DocxNoteDialogProps) {
  const { t } = useTranslation();
  const textId = useId();
  const [draft, setDraft] = useState("");
  const [refused, setRefused] = useState(false);

  useEffect(() => {
    if (open) {
      setDraft("");
      setRefused(false);
    }
  }, [open]);

  const title =
    kind === "footnote" ? t("office.docx.notes.insertFootnoteTitle") : t("office.docx.notes.insertEndnoteTitle");
  const submit = (): void => {
    const text = draft.trim();
    if (text.length === 0) return;
    if (!onSubmit(text)) setRefused(true);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      onOpenChange(false);
      return;
    }
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="docx-note-dialog" className="gap-3" closeLabel={t("common.close")} onKeyDown={onKeyDown}>
        <DialogHeader className="gap-1">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{t("office.docx.notes.insertHint")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label htmlFor={textId}>{t("office.docx.notes.textLabel")}</Label>
          <Textarea
            id={textId}
            autoFocus
            rows={3}
            value={draft}
            placeholder={t("office.docx.notes.textPlaceholder")}
            aria-label={t("office.docx.notes.textLabel")}
            onChange={(event) => setDraft(event.target.value)}
          />
          {refused ? (
            <p role="alert" className="text-caption text-destructive" data-testid="docx-note-insert-refused">
              {t("office.docx.notes.insertRefused")}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button type="button" disabled={draft.trim().length === 0} onClick={submit} data-testid="docx-note-insert">
            {t("office.docx.notes.insert")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
