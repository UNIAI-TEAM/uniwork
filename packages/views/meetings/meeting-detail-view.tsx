"use client";
import { useState } from "react";
import { Ban, Pencil, PhoneOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  canEnterScheduledMeeting,
  useCancelMeeting,
  useEndMeeting,
  useInvitations,
  useJoinRequests,
  useMeeting,
  useParticipants,
  useStartMeeting,
} from "@uniwork/core/meetings";
import { paths } from "@uniwork/core/paths";
import { useMeetingPermissions } from "@uniwork/core/permissions";
import { useWorkspaceEvents } from "@uniwork/core/realtime";
import { useMembers } from "@uniwork/core/workspaces";
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
import { toastApiError } from "../toast-api-error";
import { BreadcrumbHeader } from "../layout/breadcrumb-header";
import { CollectionPageHeaderAction } from "../layout/collection-page";
import { useWorkspace } from "../layout/workspace-context";
import { MeetingActivityTimeline } from "./meeting-activity-timeline";
import { MeetingDetailAside } from "./meeting-detail-aside";
import { MeetingDetailHero } from "./meeting-detail-hero";
import { MeetingEditDialog } from "./meeting-edit-dialog";
import { MeetingJoinRequestsPanel } from "./meeting-join-requests-panel";
import { MeetingNotesSection } from "./meeting-notes-section";
import { MeetingSummaryPanel } from "./meeting-summary-panel";

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
  useWorkspaceEvents(workspaceId);
  const { data: meeting } = useMeeting(meetingId);
  const { data: invitations } = useInvitations(meetingId);
  const { data: participants } = useParticipants(meetingId);
  const { data: joinRequests } = useJoinRequests(meetingId);
  const { data: members } = useMembers(workspaceId);
  const { canHost, canCancel } = useMeetingPermissions(meeting ?? null, workspaceId);
  const start = useStartMeeting(workspaceId);
  const end = useEndMeeting(workspaceId);
  const cancel = useCancelMeeting(workspaceId);
  const [confirm, setConfirm] = useState<"cancel" | "end" | null>(null);

  const meetingsHref = paths.workspace(workspace.organization_slug, workspace.slug).meetings();
  const activeParticipants = (participants ?? []).filter((p) => p.status === "ACTIVE");
  const myParticipant = activeParticipants.find((p) => p.user_id === user.id);
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
  const canEnter = canEnterScheduledMeeting(meeting);
  const showSummary = inProgress || meeting.status === "ENDED";
  const highlightJoinRequests = canHost.allowed && pendingJoins > 0;
  const hostName =
    members?.find((m) => m.user_id === meeting.host_user_id)?.display_name ??
    activeParticipants.find((p) => p.user_id === meeting.host_user_id)?.display_name_snapshot ??
    t("meetings.hostUnknown");

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <BreadcrumbHeader
        segments={[{ href: meetingsHref, label: t("meetings.title") }]}
        leaf={meeting.title}
        actions={
          <>
            {canHost.allowed && (scheduled || inProgress) ? (
              <MeetingEditDialog
                workspaceId={workspaceId}
                meeting={meeting}
                trigger={<CollectionPageHeaderAction icon={Pencil} label={t("meetings.edit")} />}
              />
            ) : null}
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
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 p-4 sm:p-6 lg:p-8">
          <MeetingDetailHero
            meeting={meeting}
            hostName={hostName}
            participants={activeParticipants}
            myInvite={myInvite}
            canHost={canHost.allowed}
            canEnter={canEnter}
            pendingJoins={pendingJoins}
            startPending={start.isPending}
            onStart={() => start.mutate(meetingId, { onError: (err) => toastApiError(err, t("common.error")) })}
            onJoin={onJoin}
          />

          <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start xl:grid-cols-[minmax(0,1fr)_22rem]">
            <div className="flex min-w-0 flex-col gap-6">
              {highlightJoinRequests ? <MeetingJoinRequestsPanel meetingId={meetingId} compact /> : null}
              {showSummary ? (
                <MeetingSummaryPanel workspaceId={workspaceId} meeting={meeting} canHost={canHost.allowed} />
              ) : null}
              <MeetingNotesSection meetingId={meetingId} />
              <MeetingActivityTimeline workspaceId={workspaceId} meetingId={meetingId} defaultOpen />
            </div>
            <aside className="min-w-0 lg:sticky lg:top-0">
              <MeetingDetailAside
                workspaceId={workspaceId}
                meeting={meeting}
                invitations={invitations ?? []}
                canHost={canHost.allowed}
              />
            </aside>
          </div>
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
