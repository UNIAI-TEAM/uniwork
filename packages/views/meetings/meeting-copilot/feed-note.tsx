"use client";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Ellipsis, PencilLine } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "@uniwork/core/auth";
import { useDeleteNote, useUpdateNote } from "@uniwork/core/meetings";
import type { MeetingNote } from "@uniwork/core/types/meeting";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@uniwork/ui/components/ui/alert-dialog";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";
import { Textarea } from "@uniwork/ui/components/ui/textarea";
import { toastApiError } from "../../toast-api-error";

// The ⋯ of a note row; a deleted note hands focus to a neighbour's.
const ACTIONS = "[data-note-actions]";

/**
 * A note in the UNI feed: its body, who wrote it and whether it was edited.
 * Its author and the meeting's clerks may also edit it in place or delete it
 * (UNI-2217); the server holds the same rule.
 */
export function FeedNoteContent({ note, canClerk, meetingId }: { note: MeetingNote; canClerk: boolean; meetingId: string }) {
  const { t } = useTranslation();
  const viewerId = useAuthStore((s) => s.user?.id);
  const canChange = canClerk || (!!viewerId && viewerId === note.author_id);
  const update = useUpdateNote(meetingId);
  const remove = useDeleteNote(meetingId);
  // null while the note is read, the text being written while it is edited.
  const [draft, setDraft] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const actionsRef = useRef<HTMLButtonElement>(null);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const refocusActions = useRef(false);
  const deleted = useRef(false);
  const editing = draft !== null;

  useEffect(() => {
    if (editing) {
      const field = fieldRef.current;
      field?.focus();
      field?.setSelectionRange(field.value.length, field.value.length);
    } else if (refocusActions.current) {
      refocusActions.current = false;
      actionsRef.current?.focus();
    }
  }, [editing]);

  const short = note.body.length > 40 ? `${note.body.slice(0, 40)}…` : note.body;
  const trimmed = draft?.trim() ?? "";
  const close = () => {
    refocusActions.current = true;
    setDraft(null);
  };
  const save = () => {
    if (!trimmed || update.isPending) return;
    update.mutate({ noteId: note.id, body: trimmed }, { onSuccess: close, onError: (err) => toastApiError(err, t("common.error")) });
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Escape") {
      // The panel around the feed must not close with the editor.
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      save();
    }
  };
  // The row is about to go: focus moves on to the next note's ⋯, else the previous one's, else the list.
  const neighbour = () => {
    const row = actionsRef.current?.closest("li");
    return (
      row?.nextElementSibling?.querySelector<HTMLElement>(ACTIONS) ??
      row?.previousElementSibling?.querySelector<HTMLElement>(ACTIONS) ??
      row?.closest<HTMLElement>("ol") ??
      true
    );
  };

  return (
    <>
      {editing ? (
        <div>
          <Textarea
            ref={fieldRef}
            aria-label={t("meetings.panel.feed.note.field")}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            className="min-h-0"
          />
          <div className="mt-1.5 flex justify-end gap-1.5">
            <Button type="button" size="sm" variant="ghost" onClick={close}>
              {t("common.cancel")}
            </Button>
            <Button type="button" size="sm" aria-disabled={!trimmed || update.isPending} onClick={save}>
              {t("common.save")}
            </Button>
          </div>
        </div>
      ) : (
        <p className="text-body text-pretty text-foreground">{note.body}</p>
      )}
      <div className="mt-1.5 flex items-center gap-1">
        <p className="flex min-w-0 items-center gap-1 text-caption text-muted-foreground">
          <PencilLine aria-hidden className="size-3" />
          {note.display_name}
          {note.edited_at ? <span>{t("meetings.panel.feed.note.edited")}</span> : null}
        </p>
        {canChange && !editing ? (
          // Shown on hover or focus where a pointer can hover, always on touch.
          <div className="ml-auto shrink-0 pointer-fine:opacity-0 pointer-fine:group-focus-within/note:opacity-100 pointer-fine:group-hover/note:opacity-100 pointer-fine:has-[[aria-expanded=true]]:opacity-100">
            <DropdownMenu>
              <DropdownMenuTrigger
                ref={actionsRef}
                data-note-actions=""
                render={
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    className="text-muted-foreground"
                    aria-label={t("meetings.panel.feed.note.actions", { text: short })}
                  />
                }
              >
                <Ellipsis aria-hidden className="size-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-36">
                <DropdownMenuItem onClick={() => setDraft(note.body)}>{t("meetings.panel.feed.note.edit")}</DropdownMenuItem>
                <DropdownMenuItem
                  variant="destructive"
                  disabled={remove.isPending}
                  onClick={() => {
                    deleted.current = false;
                    setConfirming(true);
                  }}
                >
                  {t("meetings.panel.feed.note.delete")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ) : null}
      </div>
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent finalFocus={() => (deleted.current ? neighbour() : true)}>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("meetings.panel.feed.note.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("meetings.panel.feed.note.deleteBody")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                deleted.current = true;
                setConfirming(false);
                remove.mutate(note.id, { onError: (err) => toastApiError(err, t("common.error")) });
              }}
            >
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
