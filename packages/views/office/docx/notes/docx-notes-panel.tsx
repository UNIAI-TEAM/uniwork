"use client";

// B3 (UNI-924): the notes pane. Presentational on purpose — the toolbar group
// owns open/dialog state and calls the command runtime; this file renders the
// footnote/endnote lists (number + text, Word's part order), the inline text
// editor, jump-to-reference, delete-with-confirm and the empty state.
import { CornerDownRight, NotebookText, Pencil, Trash2, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@uniwork/ui/components/ui/alert-dialog";
import { Button } from "@uniwork/ui/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@uniwork/ui/components/ui/empty";
import { Separator } from "@uniwork/ui/components/ui/separator";
import { Textarea } from "@uniwork/ui/components/ui/textarea";
import { cn } from "@uniwork/ui/lib/utils";
import type { DocxNoteInfo, DocxNoteKind } from "@uniwork/office-engine/docx";
import { noteNumberOf } from "./docx-note-model";

export interface DocxNotesPanelProps {
  footnotes: DocxNoteInfo[];
  endnotes: DocxNoteInfo[];
  readOnly: boolean;
  /** The open document still carries a reference marker for the note. */
  hasRef(kind: DocxNoteKind, id: string): boolean;
  onEdit(kind: DocxNoteKind, id: string, text: string): void;
  onDelete(kind: DocxNoteKind, id: string): void;
  onJump(kind: DocxNoteKind, id: string): void;
  onClose(): void;
}

interface NoteTarget {
  kind: DocxNoteKind;
  id: string;
}

export function DocxNotesPanel({
  footnotes,
  endnotes,
  readOnly,
  hasRef,
  onEdit,
  onDelete,
  onJump,
  onClose,
}: DocxNotesPanelProps) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState<NoteTarget | null>(null);
  const [draft, setDraft] = useState("");
  const [pendingDelete, setPendingDelete] = useState<NoteTarget | null>(null);
  const editable = !readOnly;

  const startEdit = (kind: DocxNoteKind, note: DocxNoteInfo) => {
    setEditing({ kind, id: note.id });
    setDraft(note.text);
  };

  const submitEdit = () => {
    const text = draft.trim();
    if (!editing || text.length === 0) return;
    onEdit(editing.kind, editing.id, text);
    setEditing(null);
  };

  const renderSection = (kind: DocxNoteKind, label: string, notes: DocxNoteInfo[]) => {
    if (notes.length === 0) return null;
    return (
      <div className="flex flex-col gap-1.5">
        <span className="text-label text-muted-foreground">{label}</span>
        {notes.map((note) => {
          const isEditing = editing?.kind === kind && editing.id === note.id;
          const anchored = hasRef(kind, note.id);
          return (
            <div key={note.id} className="flex flex-col gap-1.5 rounded-lg bg-surface-raised p-2 ring-1 ring-surface-border">
              <div className="flex items-start gap-2">
                <span
                  className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-caption text-muted-foreground"
                  aria-hidden
                >
                  {noteNumberOf(notes, note.id)}
                </span>
                {isEditing ? (
                  <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <Textarea
                      autoFocus
                      rows={3}
                      value={draft}
                      aria-label={t("office.docx.notes.textLabel")}
                      placeholder={t("office.docx.notes.textPlaceholder")}
                      onChange={(event) => setDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) submitEdit();
                        if (event.key === "Escape") setEditing(null);
                      }}
                    />
                    <div className="flex justify-end gap-1">
                      <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(null)}>
                        {t("common.cancel")}
                      </Button>
                      <Button type="button" size="sm" disabled={draft.trim().length === 0} onClick={submitEdit}>
                        {t("office.docx.notes.save")}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left text-body"
                    disabled={!anchored}
                    title={anchored ? t("office.docx.notes.jump") : t("office.docx.notes.missingRef")}
                    onClick={() => onJump(kind, note.id)}
                  >
                    {note.text || t("office.docx.notes.emptyNote")}
                    {anchored ? null : (
                      <span className="block text-caption text-muted-foreground">{t("office.docx.notes.missingRef")}</span>
                    )}
                  </button>
                )}
              </div>
              {isEditing ? null : (
                <div className="flex flex-wrap items-center gap-1">
                  <Button type="button" variant="ghost" size="sm" disabled={!editable} onClick={() => startEdit(kind, note)}>
                    <Pencil aria-hidden />
                    {t("office.docx.notes.edit")}
                  </Button>
                  <Button type="button" variant="ghost" size="sm" disabled={!editable} onClick={() => setPendingDelete({ kind, id: note.id })}>
                    <Trash2 aria-hidden />
                    {t("office.docx.notes.delete")}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    disabled={!anchored}
                    aria-label={t("office.docx.notes.jump")}
                    title={t("office.docx.notes.jump")}
                    onClick={() => onJump(kind, note.id)}
                  >
                    <CornerDownRight aria-hidden />
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  const total = footnotes.length + endnotes.length;

  return (
    <div className="flex max-h-[70vh] w-full min-w-0 flex-col gap-2" data-testid="docx-notes-panel">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 font-heading text-title-sm font-medium">
          <NotebookText aria-hidden />
          {t("office.docx.notes.title")}
        </span>
        <Button type="button" variant="ghost" size="icon-sm" aria-label={t("office.docx.notes.close")} onClick={onClose}>
          <X aria-hidden />
        </Button>
      </div>
      {editable ? null : <p className="text-caption text-muted-foreground">{t("office.docx.notes.readOnlyNote")}</p>}
      <Separator />
      <div className={cn("flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-0.5", total === 0 && "justify-center")}>
        {renderSection("footnote", t("office.docx.notes.footnotes"), footnotes)}
        {renderSection("endnote", t("office.docx.notes.endnotes"), endnotes)}
        {total === 0 ? (
          <Empty className="border-0 p-4">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <NotebookText aria-hidden />
              </EmptyMedia>
              <EmptyTitle as="h3">{t("office.docx.notes.empty")}</EmptyTitle>
              <EmptyDescription>{t("office.docx.notes.emptyHint")}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : null}
      </div>
      <AlertDialog open={pendingDelete !== null} onOpenChange={(next) => { if (!next) setPendingDelete(null); }}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("office.docx.notes.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("office.docx.notes.deleteDescription")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructiveSolid"
              onClick={() => {
                if (pendingDelete) onDelete(pendingDelete.kind, pendingDelete.id);
                setPendingDelete(null);
              }}
            >
              {t("office.docx.notes.deleteConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
