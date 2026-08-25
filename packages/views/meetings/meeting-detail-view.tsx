"use client";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAddNote, useDeleteMeeting, useMeeting, useNotes } from "@uniwork/core/meetings";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";

export function MeetingDetailView({
  workspaceId,
  meetingId,
  onJoin,
  onDeleted,
}: {
  workspaceId: string;
  meetingId: string;
  onJoin: () => void;
  onDeleted: () => void;
}) {
  const { t } = useTranslation();
  const { data: meeting } = useMeeting(meetingId);
  const { data: notes } = useNotes(meetingId);
  const addNote = useAddNote(meetingId);
  const del = useDeleteMeeting(workspaceId);
  const [note, setNote] = useState("");

  if (!meeting) return <p className="p-6 text-secondary">{t("common.loading")}</p>;

  return (
    <div className="mx-auto max-w-2xl p-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-lg font-semibold text-primary">{meeting.title}</h1>
          <p className="text-[13px] text-tertiary">
            {new Date(meeting.starts_at).toLocaleString("vi-VN")} –{" "}
            {new Date(meeting.ends_at).toLocaleString("vi-VN")}
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={onJoin}>{t("meetings.join")}</Button>
          <Button
            variant="danger"
            size="md"
            onClick={() => del.mutate(meetingId, { onSuccess: onDeleted })}
          >
            {t("common.delete")}
          </Button>
        </div>
      </div>
      {meeting.description && (
        <p className="mt-3 whitespace-pre-wrap text-sm text-secondary">{meeting.description}</p>
      )}
      <h2 className="mb-2 mt-6 text-sm font-semibold text-primary">{t("meetings.notes")}</h2>
      <ul className="space-y-2">
        {(notes ?? []).map((n) => (
          <li key={n.id} className="rounded-[var(--uw-radius)] border border-line bg-surface p-3">
            <div className="mb-1 text-[12px] text-tertiary">{n.display_name ?? n.author_id}</div>
            <div className="whitespace-pre-wrap text-sm text-primary">{n.body}</div>
          </li>
        ))}
      </ul>
      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (note.trim()) addNote.mutate(note, { onSuccess: () => setNote("") });
        }}
      >
        <Input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t("meetings.notes")}
        />
        <Button type="submit" disabled={addNote.isPending}>
          {t("common.save")}
        </Button>
      </form>
    </div>
  );
}
