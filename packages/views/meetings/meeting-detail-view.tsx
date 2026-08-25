"use client";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAddNote, useDeleteMeeting, useMeeting, useNotes } from "@uniwork/core/meetings";
import { paths } from "@uniwork/core/paths";
import { useWorkspacePermissions } from "@uniwork/core/permissions";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { BreadcrumbHeader } from "../layout/breadcrumb-header";
import { useWorkspace } from "../layout/workspace-context";

function fmt(iso: string) {
  return new Date(iso).toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "short" });
}

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
  const { workspace } = useWorkspace();
  const { data: meeting } = useMeeting(meetingId);
  const { data: notes } = useNotes(meetingId);
  const { canDeleteMeeting } = useWorkspacePermissions(workspaceId);
  const addNote = useAddNote(meetingId);
  const del = useDeleteMeeting(workspaceId);
  const [note, setNote] = useState("");

  const meetingsHref = paths.workspace(workspace.organization_slug, workspace.slug).meetings();

  if (!meeting) {
    return (
      <div className="flex h-full flex-col">
        <BreadcrumbHeader segments={[{ href: meetingsHref, label: t("meetings.title") }]} leaf={t("common.loading")} />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <BreadcrumbHeader
        segments={[{ href: meetingsHref, label: t("meetings.title") }]}
        leaf={meeting.title}
        actions={
          <>
            <Button size="sm" onClick={onJoin}>
              {t("meetings.join")}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              aria-disabled={!canDeleteMeeting.allowed || undefined}
              title={canDeleteMeeting.allowed ? undefined : canDeleteMeeting.message}
              onClick={() => del.mutate(meetingId, { onSuccess: onDeleted })}
            >
              {t("common.delete")}
            </Button>
          </>
        }
      />
      <div className="mx-auto w-full max-w-2xl flex-1 overflow-auto p-6">
        <h1 className="text-title font-semibold text-foreground">{meeting.title}</h1>
        <p className="mt-1 text-label tabular-nums text-muted-foreground">
          {fmt(meeting.starts_at)} – {fmt(meeting.ends_at)}
        </p>
        {meeting.description && (
          <p className="mt-3 whitespace-pre-wrap text-body text-muted-foreground">{meeting.description}</p>
        )}
        <h2 className="mb-2 mt-6 text-body font-semibold text-foreground">{t("meetings.notes")}</h2>
        <ul className="space-y-2">
          {(notes ?? []).map((n) => (
            <li key={n.id} className="rounded-lg border border-border bg-surface p-3">
              <div className="mb-1 text-caption text-muted-foreground">{n.display_name ?? n.author_id}</div>
              <div className="whitespace-pre-wrap text-body text-foreground">{n.body}</div>
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
    </div>
  );
}
