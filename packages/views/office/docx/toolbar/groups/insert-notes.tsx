"use client";

// B3 (UNI-924): insert ▸ notes. The two insert entries place a footnote or
// endnote marker at the caret through the dialog; the pane trigger opens the
// notes list (edit/delete/jump). Every mutation goes through the shared
// command runtime, so the toolbar never touches the editor directly.
import { BookOpenText, NotebookText, Superscript } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@uniwork/ui/components/ui/popover";
import type { DocxNoteInfo, DocxNoteKind } from "@uniwork/office-engine/docx";
import { DocxNoteDialog } from "../../notes/docx-note-dialog";
import { DocxNotesPanel } from "../../notes/docx-notes-panel";
import type { DocxToolbarGroupContext } from "../types";

/** Shared empty lists for the closed or pre-open state (never mutated). */
const EMPTY_NOTES: { footnotes: DocxNoteInfo[]; endnotes: DocxNoteInfo[] } = { footnotes: [], endnotes: [] };

export function InsertNotesGroup({ format, commands, readOnly, saving }: DocxToolbarGroupContext) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [dialogKind, setDialogKind] = useState<DocxNoteKind | null>(null);
  const notes = format?.docxNotes ?? EMPTY_NOTES;
  const total = notes.footnotes.length + notes.endnotes.length;
  const editable = !readOnly && !saving && !!commands;
  const canInsert = editable && (commands?.canInsertDocxNote() ?? false);
  const noSelection = editable && !canInsert;

  return (
    <>
      <Button
        type="button"
        variant="toolbar"
        size="icon-sm"
        disabled={!canInsert}
        aria-label={t("office.docx.notes.insertFootnote")}
        title={noSelection ? t("office.docx.notes.noSelection") : t("office.docx.notes.insertFootnote")}
        data-testid="docx-note-insert-footnote"
        onClick={() => setDialogKind("footnote")}
      >
        <Superscript aria-hidden />
      </Button>
      <Button
        type="button"
        variant="toolbar"
        size="icon-sm"
        disabled={!canInsert}
        aria-label={t("office.docx.notes.insertEndnote")}
        title={noSelection ? t("office.docx.notes.noSelection") : t("office.docx.notes.insertEndnote")}
        data-testid="docx-note-insert-endnote"
        onClick={() => setDialogKind("endnote")}
      >
        <BookOpenText aria-hidden />
      </Button>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          disabled={!commands}
          render={
            <Button type="button" variant="toolbar" size="icon-sm" aria-label={t("office.docx.notes.open")} aria-pressed={open} data-testid="docx-notes-open">
              <NotebookText aria-hidden />
              {total > 0 ? <span className="text-caption text-muted-foreground">{total}</span> : null}
            </Button>
          }
        />
        <PopoverContent align="end" className="w-80">
          <DocxNotesPanel
            footnotes={notes.footnotes}
            endnotes={notes.endnotes}
            readOnly={!editable}
            hasRef={(kind, id) => commands?.hasDocxNoteRef(kind, id) ?? false}
            onEdit={(kind, id, text) => {
              commands?.setDocxNoteText(kind, id, text);
            }}
            onDelete={(kind, id) => {
              commands?.deleteDocxNote(kind, id);
            }}
            onJump={(kind, id) => {
              commands?.jumpToDocxNote(kind, id);
            }}
            onClose={() => setOpen(false)}
          />
        </PopoverContent>
      </Popover>
      <DocxNoteDialog
        open={dialogKind !== null}
        kind={dialogKind ?? "footnote"}
        onOpenChange={(next) => {
          if (!next) setDialogKind(null);
        }}
        onSubmit={(text) => {
          // Only an accepted insert may close the dialog: insertDocxNote
          // returns null when the editor refused the marker, and the dialog
          // reports that instead of closing silently.
          if (!dialogKind || !commands?.insertDocxNote(dialogKind, text)) return false;
          setDialogKind(null);
          return true;
        }}
      />
    </>
  );
}
