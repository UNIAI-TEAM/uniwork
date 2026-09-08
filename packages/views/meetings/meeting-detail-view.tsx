"use client";
import { useState } from "react";
import { Ban, Pencil, PhoneOff, Play, Video } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  canEnterScheduledMeeting,
  useAddNote,
  useCancelMeeting,
  useEndMeeting,
  useInvitations,
  useJoinRequests,
  useMeeting,
  useNotes,
  useParticipants,
  useStartMeeting,
} from "@uniwork/core/meetings";
import { paths } from "@uniwork/core/paths";
import { useMeetingPermissions } from "@uniwork/core/permissions";
import { useWorkspaceEvents } from "@uniwork/core/realtime";
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
import { Input } from "@uniwork/ui/components/ui/input";
import { toast } from "sonner";
import { toastApiError } from "../toast-api-error";
import { BreadcrumbHeader } from "../layout/breadcrumb-header";
import { CollectionPageHeaderAction } from "../layout/collection-page";
import { useWorkspace } from "../layout/workspace-context";
import { MeetingActivityTimeline } from "./meeting-activity-timeline";
import { formatMeetingRange, meetingLocale } from "./meeting-datetime";
import { MeetingEditDialog } from "./meeting-edit-dialog";
import { MeetingHostPanel } from "./host-panel";
import { MeetingJoinRequestsPanel } from "./meeting-join-requests-panel";
import { MeetingPanelCard } from "./meeting-panel-card";
import { MeetingParticipantsSection } from "./meeting-participants-section";
import { MeetingRsvpBar } from "./meeting-rsvp-bar";
import { MeetingCalendarButton, MeetingSummaryPanel } from "./meeting-summary-panel";
import { MeetingStatusBadge } from "./meeting-status-badge";

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
  const { t, i18n } = useTranslation();
  const { workspace, user } = useWorkspace();
  useWorkspaceEvents(workspaceId);
  const { data: meeting } = useMeeting(meetingId);
  const { data: notes } = useNotes(meetingId);
  const { data: invitations } = useInvitations(meetingId);
  const { data: participants } = useParticipants(meetingId);
  const { data: joinRequests } = useJoinRequests(meetingId);
  const { canHost, canCancel } = useMeetingPermissions(meeting ?? null, workspaceId);
  const addNote = useAddNote(meetingId);
  const start = useStartMeeting(workspaceId);
  const end = useEndMeeting(workspaceId);
  const cancel = useCancelMeeting(workspaceId);
  const [note, setNote] = useState("");
  const [confirm, setConfirm] = useState<"cancel" | "end" | null>(null);

  const meetingsHref = paths.workspace(workspace.organization_slug, workspace.slug).meetings();
  const myParticipant = (participants ?? []).find((p) => p.user_id === user.id);
  const myInvite = (invitations ?? []).find((inv) => inv.participant_id === myParticipant?.id);
  const pendingJoins = (joinRequests ?? []).filter((r) => r.status === "PENDING").length;

  if (!meeting) {
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <BreadcrumbHeader segments={[{ href: meetingsHref, label: t("meetings.title") }]} leaf={t("common.loading")} />
      </div>
    );
  }

  const scheduled = meeting.status === "SCHEDULED" || !meeting.status;
  const inProgress = meeting.status === "IN_PROGRESS";
  const closed = meeting.status === "ENDED" || meeting.status === "CANCELED";
  const canEnter = canEnterScheduledMeeting(meeting);
  const showSummary = inProgress || meeting.status === "ENDED";
  const highlightJoinRequests = canHost.allowed && pendingJoins > 0;

  const notesSection = (
    <MeetingPanelCard id="notes-heading" title={t("meetings.notes")}>
      {(notes ?? []).length === 0 ? (
        <p className="mb-3 text-label text-muted-foreground">{t("meetings.notesEmpty")}</p>
      ) : (
        <ul className="mb-3 space-y-2">
          {(notes ?? []).map((n) => (
            <li key={n.id} className="rounded-lg border border-border bg-surface-hover/50 p-3">
              <div className="mb-1 text-caption text-muted-foreground">{n.display_name ?? n.author_id}</div>
              <div className="whitespace-pre-wrap break-words text-body text-foreground">{n.body}</div>
            </li>
          ))}
        </ul>
      )}
      <form
        className="flex min-w-0 flex-col gap-2 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          if (note.trim()) addNote.mutate(note, { onSuccess: () => setNote("") });
        }}
      >
        <Input
          className="min-w-0 flex-1 rounded-xl"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t("meetings.notesPlaceholder")}
        />
        <Button type="submit" className="shrink-0" disabled={addNote.isPending}>
          {t("common.save")}
        </Button>
      </form>
    </MeetingPanelCard>
  );

  const summarySection = showSummary ? (
    <MeetingSummaryPanel workspaceId={workspaceId} meeting={meeting} canHost={canHost.allowed} />
  ) : null;

  const peopleSection = canHost.allowed ? (
    <MeetingHostPanel
      workspaceId={workspaceId}
      meeting={meeting}
      invitations={invitations ?? []}
      showJoinRequests={!highlightJoinRequests}
    />
  ) : (
    <MeetingParticipantsSection
      workspaceId={workspaceId}
      meeting={meeting}
      invitations={invitations ?? []}
      canManage={false}
    />
  );

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <BreadcrumbHeader
        segments={[{ href: meetingsHref, label: t("meetings.title") }]}
        leaf={meeting.title}
        actions={
          <>
            {canHost.allowed && scheduled && canEnter ? (
              <CollectionPageHeaderAction
                icon={Play}
                label={t("meetings.start")}
                variant="outline"
                disabled={start.isPending}
                onClick={() => start.mutate(meetingId, { onError: (err) => toastApiError(err, t("common.error")) })}
              />
            ) : null}
            {canHost.allowed && (scheduled || inProgress) ? (
              <MeetingEditDialog
                workspaceId={workspaceId}
                meeting={meeting}
                trigger={<CollectionPageHeaderAction icon={Pencil} label={t("meetings.edit")} />}
              />
            ) : null}
            {closed || !canEnter ? null : (
              <CollectionPageHeaderAction
                icon={Video}
                label={canHost.allowed && pendingJoins > 0 ? `${t("meetings.join")} (${pendingJoins})` : t("meetings.join")}
                variant="default"
                onClick={onJoin}
              />
            )}
            {canHost.allowed && inProgress ? (
              <CollectionPageHeaderAction
                icon={PhoneOff}
                label={t("meetings.end")}
                variant="outline"
                onClick={() => setConfirm("end")}
              />
            ) : null}
            {canCancel.allowed && scheduled ? (
              <CollectionPageHeaderAction
                icon={Ban}
                label={t("meetings.cancel")}
                variant="destructive"
                onClick={() => setConfirm("cancel")}
              />
            ) : null}
          </>
        }
      />
      <div className="min-h-0 flex-1 overflow-auto p-4 sm:p-6">
        <div className="rounded-xl border border-border bg-surface p-4 sm:p-5">
          <div className="flex min-w-0 flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <h1 className="text-pretty text-title font-semibold text-foreground">{meeting.title}</h1>
                <MeetingStatusBadge status={meeting.status} />
              </div>
              <p className="mt-1 text-label tabular-nums text-muted-foreground">
                {formatMeetingRange(meeting.starts_at, meeting.ends_at, meetingLocale(i18n.language))}
              </p>
              {meeting.description ? (
                <p className="mt-3 max-w-3xl whitespace-pre-wrap break-words text-pretty text-body text-muted-foreground">
                  {meeting.description}
                </p>
              ) : null}
              {!canEnter && !closed ? (
                <p className="mt-3 text-body text-destructive">{t("meetings.pastScheduledEndHint")}</p>
              ) : null}
            </div>
            <div className="flex shrink-0 flex-col gap-3 lg:items-end">
              {myInvite ? <MeetingRsvpBar meetingId={meetingId} invitation={myInvite} /> : null}
              {meeting.status !== "CANCELED" ? <MeetingCalendarButton meetingId={meetingId} /> : null}
            </div>
          </div>
        </div>

        <div className="mt-6 flex min-w-0 flex-col gap-6">
          {highlightJoinRequests ? <MeetingJoinRequestsPanel meetingId={meetingId} compact /> : null}
          {peopleSection}
          {notesSection}
          {summarySection}
          <MeetingActivityTimeline workspaceId={workspaceId} meetingId={meetingId} />
        </div>
      </div>
      <AlertDialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm === "end" ? t("meetings.endConfirmTitle") : t("meetings.cancelConfirmTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === "end" ? t("meetings.endConfirm") : t("meetings.cancelConfirm")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.back")}</AlertDialogCancel>
            <AlertDialogAction
              variant={confirm === "cancel" ? "destructive" : "default"}
              disabled={end.isPending || cancel.isPending}
              onClick={() => {
                if (confirm === "end") {
                  end.mutate(meetingId, { onError: (err) => toastApiError(err, t("common.error")) });
                } else {
                  cancel.mutate(meetingId, {
                    onSuccess: onDeleted,
                    onError: (err) => toastApiError(err, t("common.error")),
                  });
                }
                setConfirm(null);
              }}
            >
              {confirm === "end" ? t("meetings.confirmEnd") : t("meetings.confirmCancel")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
