"use client";
import { useState } from "react";
import { Ban, CalendarX2, Pencil, PhoneOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  displayMeetingStatus,
  useCancelMeeting,
  useEndMeeting,
  useExtendMeeting,
  useInvitations,
  useJoinRequests,
  useMeeting,
  useMeetingActivity,
  useParticipants,
  useStartMeeting,
} from "@uniwork/core/meetings";
import { paths } from "@uniwork/core/paths";
import { useMeetingPermissions } from "@uniwork/core/permissions";
import { useWorkspaceEvents } from "@uniwork/core/realtime";
import { ApiError } from "@uniwork/core/api";
import { toast } from "sonner";
import { Button, buttonVariants } from "@uniwork/ui/components/ui/button";
import { ConfirmDialog } from "../common/form-dialog";
import { toastApiError } from "../toast-api-error";
import { AppLink } from "../navigation";
import { BreadcrumbHeader } from "../layout/breadcrumb-header";
import { CollectionPageHeaderAction, CollectionPageState } from "../layout/collection-page";
import { useWorkspace } from "../layout/workspace-context";
import { MeetingActivityTimeline } from "./meeting-activity-timeline";
import { MeetingDetailAside, MeetingDetailRoster } from "./meeting-detail-aside";
import { MeetingDetailHero } from "./meeting-detail-hero";
import { MeetingEditDialog } from "./meeting-edit-dialog";
import { MeetingJoinRequestsPanel } from "./meeting-join-requests-panel";
import { MeetingNotesSection } from "./meeting-notes-section";
import { MeetingDetailPageSkeleton } from "./meeting-page-skeletons";
import { MeetingSummaryPanel } from "./meeting-summary-panel";
import { useMemberIndex } from "./use-member-index";
import { useNow } from "./use-now";

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
  const { data: meeting, isError, error, isPending, refetch } = useMeeting(meetingId);
  const { data: invitations } = useInvitations(meetingId);
  const { data: participants } = useParticipants(meetingId);
  const { data: joinRequests } = useJoinRequests(meetingId);
  const { memberOf } = useMemberIndex(workspaceId);
  const nowMs = useNow();
  const { data: activity } = useMeetingActivity(meetingId);
  const { canHost, canCancel } = useMeetingPermissions(meeting ?? null, workspaceId);
  const start = useStartMeeting(workspaceId);
  const end = useEndMeeting(workspaceId);
  const cancel = useCancelMeeting(workspaceId);
  const extend = useExtendMeeting(workspaceId);
  const [confirm, setConfirm] = useState<"cancel" | "end" | null>(null);

  const meetingsHref = paths.workspace(workspace.organization_slug, workspace.slug).meetings();
  const activeParticipants = (participants ?? []).filter((p) => p.status === "ACTIVE");
  const myParticipant = activeParticipants.find((p) => p.user_id === user.id);
  const myInvite = (invitations ?? []).find((inv) => inv.participant_id === myParticipant?.id);
  const pendingJoins = (joinRequests ?? []).filter((r) => r.status === "PENDING").length;

  // A missing meeting (or one this viewer may not see) and a failed load read
  // differently: one sends you back to the list, the other offers a retry.
  const missing = (!isPending && !isError && !meeting) ||
    (error instanceof ApiError && (error.status === 404 || error.status === 403));
  if (missing || isError) {
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <BreadcrumbHeader
          segments={[{ href: meetingsHref, label: t("meetings.title") }]}
          leaf={t(missing ? "meetings.notFound" : "meetings.loadFailed")}
        />
        <CollectionPageState
          icon={CalendarX2}
          tone={missing ? "muted" : "destructive"}
          role={missing ? undefined : "alert"}
          title={t(missing ? "meetings.notFound" : "meetings.loadFailed")}
          description={missing ? t("meetings.notFoundHint") : undefined}
          actions={
            missing ? (
              <AppLink href={meetingsHref} className={buttonVariants({ variant: "outline", size: "sm" })}>
                {t("meetings.backToList")}
              </AppLink>
            ) : (
              <Button size="sm" variant="outline" onClick={() => void refetch()}>
                {t("common.retry")}
              </Button>
            )
          }
        />
      </div>
    );
  }

  if (!meeting) return <MeetingDetailPageSkeleton />;

  const scheduled = meeting.status === "SCHEDULED" || !meeting.status;
  const inProgress = meeting.status === "IN_PROGRESS";
  const status = displayMeetingStatus(meeting, nowMs);
  const closed = meeting.status === "ENDED" || meeting.status === "CANCELED";
  const showSummary = inProgress || meeting.status === "ENDED";
  const highlightJoinRequests = canHost.allowed && pendingJoins > 0;
  const hostMember = memberOf(meeting.host_user_id);
  const hostName =
    hostMember?.display_name ??
    activeParticipants.find((p) => p.user_id === meeting.host_user_id)?.display_name_snapshot ??
    t("meetings.hostUnknown");
  // The host already has their own line in the hero; the stack is everyone else.
  const people = activeParticipants.filter((p) => p.user_id !== meeting.host_user_id).map((p) => ({
    id: p.id,
    name: p.display_name_snapshot || memberOf(p.user_id)?.display_name || t("meetings.formerMember"),
    avatarUrl: memberOf(p.user_id)?.avatar_url,
  }));
  const canceledAt = (activity ?? []).find((a) => a.event_type === "MEETING_CANCELED")?.occurred_at;
  const onError = (err: unknown) => toastApiError(err, t("common.error"));

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
            {canHost.allowed && status === "IN_PROGRESS" ? (
              <CollectionPageHeaderAction
                icon={PhoneOff}
                label={t("meetings.end")}
                variant="outline"
                onClick={() => setConfirm("end")}
              />
            ) : null}
            {canCancel.allowed && status === "SCHEDULED" ? (
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
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 p-4 sm:p-6">
          <MeetingDetailHero
            workspaceId={workspaceId}
            meeting={meeting}
            host={{ name: hostName, avatarUrl: hostMember?.avatar_url }}
            people={people}
            myInvite={myInvite}
            canHost={canHost.allowed}
            canCancel={canCancel.allowed}
            pendingJoins={pendingJoins}
            canceledAt={canceledAt}
            startPending={start.isPending}
            extendPending={extend.isPending}
            onStart={() => start.mutate(meetingId, { onError })}
            onJoin={onJoin}
            onExtend={() =>
              extend.mutate(meetingId, { onSuccess: () => toast.success(t("meetings.extendedFifteen")), onError })
            }
            onEnd={() => setConfirm("end")}
            onCancel={() => setConfirm("cancel")}
          />

          {/* The aside scrolls with the page: a sticky column taller than the
              viewport would leave its bottom unreachable. Below lg the columns
              collapse into one flow (the main column is `contents`), ordered
              so who is in comes right after any waiting guests, ahead of the
              summary and notes; from lg the roster heads the side column. */}
          <div className="flex min-w-0 flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,1fr)_20rem] lg:grid-rows-[auto_1fr] lg:items-start xl:grid-cols-[minmax(0,1fr)_22rem]">
            <div className="contents lg:col-start-1 lg:row-span-2 lg:row-start-1 lg:flex lg:min-w-0 lg:flex-col lg:gap-4">
              {highlightJoinRequests ? (
                <div className="order-1 min-w-0">
                  <MeetingJoinRequestsPanel meetingId={meetingId} compact />
                </div>
              ) : null}
              {showSummary ? (
                <div className="order-3 min-w-0">
                  <MeetingSummaryPanel workspaceId={workspaceId} meeting={meeting} canHost={canHost.allowed} />
                </div>
              ) : null}
              <div className="order-3 min-w-0">
                <MeetingNotesSection meetingId={meetingId} locked={closed} />
              </div>
              <div className="order-3 min-w-0">
                <MeetingActivityTimeline workspaceId={workspaceId} meetingId={meetingId} defaultOpen />
              </div>
            </div>
            <div className="order-2 min-w-0 lg:col-start-2 lg:row-start-1">
              <MeetingDetailRoster
                workspaceId={workspaceId}
                meeting={meeting}
                invitations={invitations ?? []}
                canHost={canHost.allowed}
              />
            </div>
            <aside className="order-4 min-w-0 lg:col-start-2 lg:row-start-2">
              <MeetingDetailAside workspaceId={workspaceId} meeting={meeting} canHost={canHost.allowed} />
            </aside>
          </div>
        </div>
      </div>
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={confirm === "end" ? t("meetings.endConfirmTitle") : t("meetings.cancelConfirmTitle")}
        description={confirm === "end" ? t("meetings.endConfirm") : t("meetings.cancelConfirm")}
        confirmLabel={confirm === "end" ? t("meetings.confirmEnd") : t("meetings.confirmCancel")}
        pending={end.isPending || cancel.isPending}
        onConfirm={() => {
          // Close once the server agrees: a failed end/cancel keeps the
          // question on screen next to its error.
          if (confirm === "end") {
            end.mutate(meetingId, {
              onSuccess: () => {
                setConfirm(null);
                toast.success(t("meetings.meetingEndedToast"));
              },
              onError,
            });
          } else {
            cancel.mutate(meetingId, {
              onSuccess: () => {
                setConfirm(null);
                toast.success(t("meetings.meetingCanceledToast"));
                onDeleted();
              },
              onError,
            });
          }
        }}
      />
    </div>
  );
}
