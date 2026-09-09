"use client";
import { useState } from "react";
import { NotebookPen, SendHorizontal } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAddNote, useNotes } from "@uniwork/core/meetings";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { PanelCard } from "../layout/panel-card";
import { MeetingPersonAvatar } from "./meeting-person";

/** Shared notes: a feed of who wrote what, and a composer at the bottom. */
export function MeetingNotesSection({ meetingId }: { meetingId: string }) {
  const { t } = useTranslation();
  const { data: notes } = useNotes(meetingId);
  const addNote = useAddNote(meetingId);
  const [note, setNote] = useState("");
  const list = notes ?? [];

  return (
    <PanelCard
      id="notes-heading"
      icon={NotebookPen}
      title={t("meetings.notes")}
      description={t("meetings.notesHint")}
      flush
      footer={
        <form
          className="flex min-w-0 items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (note.trim()) addNote.mutate(note, { onSuccess: () => setNote("") });
          }}
        >
          <Input
            className="min-w-0 flex-1 bg-surface"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t("meetings.notesPlaceholder")}
            aria-label={t("meetings.addNote")}
          />
          <Button type="submit" className="shrink-0" disabled={addNote.isPending || !note.trim()}>
            <SendHorizontal aria-hidden />
            {t("common.save")}
          </Button>
        </form>
      }
    >
      {list.length === 0 ? (
        <p className="px-4 py-6 text-center text-label text-muted-foreground">{t("meetings.notesEmpty")}</p>
      ) : (
        <ul className="divide-y divide-border">
          {list.map((n) => {
            const author = n.display_name ?? n.author_id;
            return (
              <li key={n.id} className="flex min-w-0 items-start gap-3 px-4 py-3">
                <MeetingPersonAvatar name={author} size="sm" className="mt-0.5" />
                <div className="min-w-0 flex-1">
                  <div className="text-caption font-medium text-muted-foreground">{author}</div>
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
