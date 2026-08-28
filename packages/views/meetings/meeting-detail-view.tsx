"use client";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  useAddNote,
  useCancelMeeting,
  useEndMeeting,
  useInvitations,
  useMeeting,
  useNotes,
  useParticipants,
  useRespondInvitation,
  useStartMeeting,
} from "@uniwork/core/meetings";
import { paths } from "@uniwork/core/paths";
import { useMeetingPermissions } from "@uniwork/core/permissions";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { BreadcrumbHeader } from "../layout/breadcrumb-header";
import { useWorkspace } from "../layout/workspace-context";
import { MeetingHostPanel } from "./host-panel";

function fmt(iso: string) {
  return new Date(iso).toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "short" });
}

function statusKey(status: string | undefined): string {
  switch (status) {
    case "SCHEDULED":
    case "IN_PROGRESS":
    case "ENDED":
    case "CANCELED":
      return `meetings.status_${status}`;
    default:
      return "meetings.status_SCHEDULED";
  }
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
  const { workspace, user } = useWorkspace();
  const { data: meeting } = useMeeting(meetingId);
  const { data: notes } = useNotes(meetingId);
  const { data: invitations } = useInvitations(meetingId);
  const { data: participants } = useParticipants(meetingId);
  const { canHost, canCancel } = useMeetingPermissions(meeting ?? null, workspaceId);
  const addNote = useAddNote(meetingId);
  const start = useStartMeeting(workspaceId);
  const end = useEndMeeting(workspaceId);
  const cancel = useCancelMeeting(workspaceId);
  const rsvp = useRespondInvitation(meetingId);
  const [note, setNote] = useState("");

  const meetingsHref = paths.workspace(workspace.organization_slug, workspace.slug).meetings();
  const myParticipant = (participants ?? []).find((p) => p.user_id === user.id);
  const myInvite = (invitations ?? []).find((inv) => inv.participant_id === myParticipant?.id);

  if (!meeting) {
    return (
      <div className="flex h-full flex-col">
        <BreadcrumbHeader segments={[{ href: meetingsHref, label: t("meetings.title") }]} leaf={t("common.loading")} />
      </div>
    );
  }

  const scheduled = meeting.status === "SCHEDULED" || !meeting.status;
  const inProgress = meeting.status === "IN_PROGRESS";

  return (
    <div className="flex h-full flex-col">
      <BreadcrumbHeader
        segments={[{ href: meetingsHref, label: t("meetings.title") }]}
        leaf={meeting.title}
        actions={
          <>
            {canHost.allowed && scheduled ? (
              <Button size="sm" variant="outline" disabled={start.isPending} onClick={() => start.mutate(meetingId)}>
                {t("meetings.start")}
              </Button>
            ) : null}
            <Button size="sm" onClick={onJoin}>
              {t("meetings.join")}
            </Button>
            {canHost.allowed && inProgress ? (
              <Button size="sm" variant="outline" disabled={end.isPending} onClick={() => end.mutate(meetingId)}>
                {t("meetings.end")}
              </Button>
            ) : null}
            {canCancel.allowed && scheduled ? (
              <Button
                variant="destructive"
                size="sm"
                disabled={cancel.isPending}
                onClick={() => cancel.mutate(meetingId, { onSuccess: onDeleted })}
              >
                {t("meetings.cancel")}
              </Button>
            ) : null}
          </>
        }
      />
      <div className="mx-auto w-full max-w-2xl flex-1 overflow-auto p-6">
        <h1 className="text-title font-semibold text-foreground">{meeting.title}</h1>
        <p className="mt-1 text-label text-muted-foreground">{t(statusKey(meeting.status))}</p>
        <p className="mt-1 text-label tabular-nums text-muted-foreground">
          {fmt(meeting.starts_at)} – {fmt(meeting.ends_at)}
        </p>
        {meeting.description ? (
          <p className="mt-3 whitespace-pre-wrap text-body text-muted-foreground">{meeting.description}</p>
        ) : null}
        {myInvite && myInvite.response_status === "PENDING" ? (
          <div className="mt-4 flex items-center gap-2">
            <span className="text-label text-muted-foreground">{t("meetings.rsvp")}</span>
            <Button size="sm" onClick={() => rsvp.mutate({ invitationId: myInvite.id, response: "ACCEPTED" })}>
              {t("meetings.accept")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => rsvp.mutate({ invitationId: myInvite.id, response: "DECLINED" })}
            >
              {t("meetings.decline")}
            </Button>
          </div>
        ) : null}
        {canHost.allowed ? <MeetingHostPanel workspaceId={workspaceId} meeting={meeting} /> : null}
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
