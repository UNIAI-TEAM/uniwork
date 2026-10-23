"use client";
import { useState, type FormEvent, type KeyboardEvent } from "react";
import { NotebookPen, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAddNote, useNotes } from "@uniwork/core/meetings";
import { Button } from "@uniwork/ui/components/ui/button";
import { Textarea } from "@uniwork/ui/components/ui/textarea";
import { useCoarsePointer } from "@uniwork/ui/hooks/use-pointer";
import { PanelCard } from "../common/panel-card";
import { moduleTone } from "../layout/module-tones";
import { toastApiError } from "../toast-api-error";
import { formatMeetingStart, meetingLocale } from "./meeting-datetime";
import { MeetingPersonAvatar } from "./meeting-person";
import { formatRelativeTime } from "./meeting-relative-time";
import { MeetingRowsSkeleton, MeetingSectionError } from "./meeting-section-state";

/**
 * Shared notes: a feed of who wrote what and when, and a composer at the
 * bottom. With a keyboard, Enter adds the note and Shift+Enter breaks the
 * line; on touch, Enter is a line break (there is no Shift) and the button
 * adds the note. Once the meeting
 * is over (`locked`) the feed stays readable and the composer goes away.
 */
export function MeetingNotesSection({ meetingId, locked = false }: { meetingId: string; locked?: boolean }) {
  const { t, i18n } = useTranslation();
  const locale = meetingLocale(i18n.language);
  const { data: notes, isPending, isError, refetch } = useNotes(meetingId);
  const addNote = useAddNote(meetingId);
  const [note, setNote] = useState("");
  const coarse = useCoarsePointer();
  const list = notes ?? [];
  const ready = note.trim().length > 0 && !addNote.isPending;

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (!ready) return;
    addNote.mutate(note.trim(), {
      onSuccess: () => setNote(""),
      onError: (err) => toastApiError(err, t("meetings.noteAddFailed")),
    });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (coarse || e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
    e.preventDefault();
    submit();
  };

  return (
    <PanelCard
      id="notes-heading"
      icon={NotebookPen}
      iconTone={moduleTone("meetings")}
      title={t("meetings.notes")}
      description={t(locked ? "meetings.notesLockedHint" : "meetings.notesHint")}
      flush
      footer={
        locked ? undefined : (
          <form className="flex min-w-0 items-end gap-2" onSubmit={submit}>
            <Textarea
              rows={1}
              className="max-h-40 min-h-9 min-w-0 flex-1 resize-none bg-surface py-1.5 pointer-coarse:min-h-11"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={t("meetings.notesPlaceholder")}
              aria-label={t("meetings.addNote")}
              aria-describedby={coarse ? undefined : "notes-composer-hint"}
            />
            <Button type="submit" size="lg" className="shrink-0" disabled={!ready}>
              <Plus aria-hidden />
              {t("meetings.noteAdd")}
            </Button>
            {coarse ? null : (
              <span id="notes-composer-hint" className="sr-only">
                {t("meetings.notesComposerHint")}
              </span>
            )}
          </form>
        )
      }
    >
      {isPending ? (
        <MeetingRowsSkeleton rows={2} className="py-1" />
      ) : isError ? (
        <MeetingSectionError className="m-4" message={t("meetings.notesLoadFailed")} onRetry={() => void refetch()} />
      ) : list.length === 0 ? (
        <p className="px-4 py-6 text-center text-label text-muted-foreground">
          {t(locked ? "meetings.notesEmptyLocked" : "meetings.notesEmpty")}
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {list.map((n) => {
            const author = n.display_name?.trim() || t("meetings.formerMember");
            return (
              <li key={n.id} className="flex min-w-0 items-start gap-3 px-4 py-3">
                <MeetingPersonAvatar name={author} avatarUrl={n.avatar_url} size="sm" className="mt-0.5" />
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-baseline gap-2">
                    <span className="truncate text-label font-medium text-foreground">{author}</span>
                    {n.created_at ? (
                      <time
                        dateTime={n.created_at}
                        title={formatMeetingStart(n.created_at, locale)}
                        className="shrink-0 text-caption tabular-nums text-muted-foreground"
                      >
                        {formatRelativeTime(n.created_at, locale)}
                      </time>
                    ) : null}
                  </div>
                  <div className="mt-0.5 whitespace-pre-wrap break-words text-body text-foreground">{n.body}</div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </PanelCard>
  );
}
