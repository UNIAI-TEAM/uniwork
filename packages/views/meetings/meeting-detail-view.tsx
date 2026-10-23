"use client";
import { useState, type ReactNode } from "react";
import { Ban, CalendarX2, CircleAlert, Pencil, PhoneOff, RotateCcw, Sparkles } from "lucide-react";
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
  useRestoreMeeting,
  useStartMeeting,
} from "@uniwork/core/meetings";
import { useAiCapabilities } from "@uniwork/core/ai";
import { paths } from "@uniwork/core/paths";
import { useMeetingClerk } from "@uniwork/core/meetings/attendance";
import { useMeetingActionItems } from "@uniwork/core/meetings/action-items";
import { useMeetingMinutes, useMeetingMinutesEnabled } from "@uniwork/core/meetings/minutes";
import { useMeetingPermissions } from "@uniwork/core/permissions";
import { useMeetingScope } from "@uniwork/core/realtime";
import { ApiError } from "@uniwork/core/api";
import { toast } from "sonner";
import { Button, buttonVariants } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { apiErrorCopy } from "../api-error-copy";
import { ConfirmDialog } from "../common/form-dialog";
import { Notice } from "../common/notice";
import { PanelCard } from "../common/panel-card";
import { toastApiError } from "../toast-api-error";
import { AppLink } from "../navigation";
import { BreadcrumbHeader } from "../layout/breadcrumb-header";
import { CollectionPageHeaderAction, CollectionPageState } from "../layout/collection-page";
import { useWorkspace } from "../layout/workspace-context";
import { MeetingActivityTimeline } from "./meeting-activity-timeline";
import { MeetingAttendanceCard } from "./meeting-attendance-card";
import { MeetingAskBox } from "./meeting-copilot/meeting-ask-box";
import { MeetingDetailAside, MeetingDetailRoster } from "./meeting-detail-aside";
import { AskUniFocusButton } from "../ai/ask-uni-focus-button";
import { MeetingDetailHero, type MeetingNextStep } from "./meeting-detail-hero";
import { MeetingEditDialog } from "./meeting-edit-dialog";
import { MeetingJoinRequestsPanel } from "./meeting-join-requests-panel";
import { MeetingMotionsSection } from "./meeting-motions-section";
import { MeetingNotesSection } from "./meeting-notes-section";
import { MeetingDetailPageSkeleton } from "./meeting-page-skeletons";
import { MeetingActionItemsSection } from "./meeting-action-items/meeting-action-items-section";
import { MeetingCarriedOverSection } from "./meeting-action-items/carried-over-section";
import { MeetingMinutesSection } from "./meeting-minutes-section";
import { MeetingSummaryPanel } from "./meeting-summary-panel";
import { MeetingAIAccessCard, MeetingAIRestrictedNotice } from "./meeting-ai-access-card";
import { MeetingTranscriptPanel } from "./meeting-transcript-panel";
import { useMemberIndex } from "./use-member-index";
import { scrollSectionIntoView, useMeetingSectionDeepLink } from "./use-meeting-section-deep-link";
import { useNow } from "./use-now";

/** The hero's next step: bring a section into view and put focus on its first control. */
function goToSection(headingId: string): void {
  const heading = document.getElementById(headingId);
  if (heading) scrollSectionIntoView(heading);
  heading
    ?.closest("section")
    ?.querySelector<HTMLElement>('[role="checkbox"], button:not([aria-disabled="true"]), a[href]')
    ?.focus({ preventScroll: true });
}

export function MeetingDetailView({
  workspaceId,
  meetingId,
  onJoin,
  onDeleted,
  layout = "page",
  headerActions,
}: {
  workspaceId: string;
  meetingId: string;
  onJoin: () => void;
  onDeleted: () => void;
  layout?: "page" | "panel";
  headerActions?: ReactNode;
}) {
  const { t } = useTranslation();
  const { workspace, user } = useWorkspace();
  // In-room events (roll, motions, transcript) are meeting-scoped; the detail
  // page shows them live, so it holds the meeting open like the room does.
  useMeetingScope(meetingId);
  const { data: meeting, isError, error, isPending, refetch } = useMeeting(meetingId);
  const { data: invitations } = useInvitations(meetingId);
  const { data: participants } = useParticipants(meetingId);
  const { data: joinRequests } = useJoinRequests(meetingId);
  const { memberOf } = useMemberIndex(workspaceId);
  const nowMs = useNow();
  const { data: activity } = useMeetingActivity(meetingId);
  const { data: aiCaps } = useAiCapabilities(workspaceId);
  const { canHost, canCancel } = useMeetingPermissions(meeting ?? null, workspaceId);
  // Host, secretary or workspace admin: the summary and the action items (spec D3).
  const { isClerk } = useMeetingClerk(meeting ?? null, workspaceId);
  // The organization's own answer: an override for it turns the minutes on.
  const minutesOn = useMeetingMinutesEnabled(workspace.organization_id);
  // What the clerk does next once the meeting has ended (the hero names it).
  const clerkAfter = isClerk && meeting?.status === "ENDED";
  const { data: actionItems } = useMeetingActionItems(clerkAfter ? meetingId : "");
  const minutesQuery = useMeetingMinutes(meetingId, clerkAfter && minutesOn);
  const start = useStartMeeting(workspaceId);
  const end = useEndMeeting(workspaceId);
  const cancel = useCancelMeeting(workspaceId);
  const restore = useRestoreMeeting(workspaceId);
  const extend = useExtendMeeting(workspaceId);
  const [confirm, setConfirm] = useState<"cancel" | "end" | null>(null);
  // Why the last end/cancel failed, said at the top of the page until the next try, and
  // only while the meeting stays as it was: once another host ended it, that failure is moot.
  const [closeError, setCloseError] = useState<{ text: string; status?: string } | null>(null);
  // The summary reminder opens here (C-11 §9.1 V1); the panel exists only
  // once the meeting is loaded and has started.
  useMeetingSectionDeepLink({
    ready: Boolean(meeting) && (meeting?.status === "IN_PROGRESS" || meeting?.status === "ENDED"),
  });

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
          segments={layout === "panel" ? [] : [{ href: meetingsHref, label: t("meetings.title") }]}
          leaf={t(missing ? "meetings.notFound" : "meetings.loadFailed")}
          actions={headerActions}
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
  // Absent on an older server: readable, as before.
  const aiRestricted = meeting.ai_content_readable === false;
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
  const pendingItems = actionItems?.counts.pending ?? 0;
  const nextStep: MeetingNextStep | null = !clerkAfter
    ? null
    : pendingItems > 0
      ? { kind: "assign", pending: pendingItems, onGo: () => goToSection("action-items-heading") }
      : minutesOn && minutesQuery.isSuccess && !minutesQuery.data
        ? { kind: "minutes", onGo: () => goToSection("meeting-minutes-heading") }
        : null;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <BreadcrumbHeader
        segments={layout === "panel" ? [] : [{ href: meetingsHref, label: t("meetings.title") }]}
        leaf={meeting.title}
        actions={
          <>
            {layout === "page" && canHost.allowed && (scheduled || inProgress) ? (
              <MeetingEditDialog
                workspaceId={workspaceId}
                meeting={meeting}
                trigger={<CollectionPageHeaderAction icon={Pencil} label={t("meetings.edit")} />}
              />
            ) : null}
            {layout === "page" && canHost.allowed && status === "IN_PROGRESS" ? (
              <CollectionPageHeaderAction
                icon={PhoneOff}
                label={t("meetings.end")}
                variant="outline"
                onClick={() => setConfirm("end")}
              />
            ) : null}
            {layout === "page" && canCancel.allowed && status === "SCHEDULED" ? (
              <CollectionPageHeaderAction
                icon={Ban}
                label={t("meetings.cancel")}
                variant="destructive"
                onClick={() => setConfirm("cancel")}
              />
            ) : null}
            {layout === "page" && canCancel.allowed && meeting.status === "CANCELED" && new Date(meeting.ends_at).getTime() > nowMs ? (
              <CollectionPageHeaderAction
                icon={RotateCcw}
                label={t("meetings.restore")}
                variant="outline"
                aria-disabled={restore.isPending || undefined}
                onClick={() =>
                  restore.mutate(
                    { meetingId, version: meeting.version },
                    { onSuccess: () => toast.success(t("meetings.meetingRestoredToast")), onError },
                  )
                }
              />
            ) : null}
            <AskUniFocusButton kind="meeting" id={meetingId} title={meeting.title} workspaceId={workspaceId} />
            {headerActions}
          </>
        }
      />
      {/* relative: absolute descendants (sr-only text, checkbox inputs) belong to this scroller, not the frame. */}
      <div className="relative min-h-0 flex-1 overflow-auto">
        <div
          data-testid="meeting-detail-content"
          className={cn(
            "mx-auto flex w-full flex-col",
            layout === "panel" ? "max-w-none gap-3 p-3" : "max-w-7xl gap-4 p-4 sm:p-6",
          )}
        >
          {closeError && closeError.status === meeting.status ? (
            <Notice tone="destructive" icon={CircleAlert} layout="inline" live="assertive">
              {closeError.text}
            </Notice>
          ) : null}
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
            nextStep={nextStep}
          />

          {/* The aside scrolls with the page: a sticky column taller than the
              viewport would leave its bottom unreachable. Below lg the columns
              collapse into one flow (the main column is `contents`). Before and
              during the meeting, who is in and how to get in come right after
              any waiting guests; once it is over the work (summary, action
              items, minutes) leads and the roster and details follow. From lg
              the roster heads the side column. */}
          <div
            data-testid="meeting-detail-sections"
            className={cn(
              "flex min-w-0 flex-col",
              layout === "panel"
                ? "gap-3"
                : "gap-4 lg:grid lg:grid-cols-[minmax(0,1fr)_20rem] lg:grid-rows-[auto_1fr] lg:items-start xl:grid-cols-[minmax(0,1fr)_22rem]",
            )}
          >
            <div
              className={cn(
                "contents",
                layout === "page" &&
                  "lg:col-start-1 lg:row-span-2 lg:row-start-1 lg:flex lg:min-w-0 lg:flex-col lg:gap-4",
              )}
            >
              {highlightJoinRequests ? (
                <div className="order-1 min-w-0">
                  <MeetingJoinRequestsPanel meetingId={meetingId} compact />
                </div>
              ) : null}
              {/* Drafted before the meeting and run while it is live: the head of the working column. */}
              <div className="order-3 min-w-0 empty:hidden">
                <MeetingMotionsSection meeting={meeting} workspaceId={workspaceId} />
              </div>
              {/* What was said is for the people of the meeting (UNI-1995 access): a
                  member outside it reads one sentence, not two failed panels. */}
              {showSummary && aiRestricted ? (
                <div className="order-3 min-w-0">
                  <MeetingAIRestrictedNotice />
                </div>
              ) : null}
              {showSummary && !aiRestricted ? (
                <div className="order-3 min-w-0">
                  <MeetingSummaryPanel workspaceId={workspaceId} meeting={meeting} canClerk={isClerk} />
                </div>
              ) : null}
              {showSummary && !aiRestricted ? (
                <div className="order-3 min-w-0">
                  <MeetingTranscriptPanel workspaceId={workspaceId} meeting={meeting} canClerk={isClerk} />
                </div>
              ) : null}
              {showSummary ? (
                <div className="order-3 min-w-0">
                  <MeetingActionItemsSection
                    workspaceId={workspaceId}
                    meetingId={meeting.id}
                    projectId={meeting.project_id}
                    canClerk={isClerk}
                  />
                </div>
              ) : null}
              {/* The minutes page, made once the meeting has ended (spec D12). */}
              {minutesOn && meeting.status === "ENDED" ? (
                <div className="order-3 min-w-0">
                  <MeetingMinutesSection workspaceId={workspaceId} meetingId={meeting.id} canClerk={isClerk} />
                </div>
              ) : null}
              {/* What earlier meetings of the project left open, for the one about to run (spec D8). */}
              {(scheduled || inProgress) && meeting.project_id ? (
                <div className="order-3 min-w-0 empty:hidden">
                  <MeetingCarriedOverSection workspaceId={workspaceId} meetingId={meeting.id} />
                </div>
              ) : null}
              {showSummary && aiCaps?.ask_uni ? (
                <div className="order-3 min-w-0">
                  <PanelCard title={t("meetings.askUniTitle")} icon={Sparkles}>
                    {/* Chat takes a message only from someone in the room. */}
                    <MeetingAskBox workspaceId={workspaceId} meetingId={meetingId} canShare={inProgress && Boolean(myParticipant)} />
                  </PanelCard>
                </div>
              ) : null}
              {/* The roll is working space while the meeting runs, so it gets the wide column. */}
              <div className="order-3 min-w-0 empty:hidden">
                <MeetingAttendanceCard meeting={meeting} workspaceId={workspaceId} />
              </div>
              <div className="order-3 min-w-0">
                <MeetingNotesSection meetingId={meetingId} locked={closed} />
              </div>
              <div className="order-3 min-w-0">
                {/* Folded once the meeting is over: history, not work. */}
                <MeetingActivityTimeline workspaceId={workspaceId} meetingId={meetingId} defaultOpen={!closed} />
              </div>
            </div>
            <div
              className={cn(
                "min-w-0",
                closed ? "order-4" : "order-2",
                layout === "page" && "lg:col-start-2 lg:row-start-1",
              )}
            >
              <MeetingDetailRoster
                workspaceId={workspaceId}
                meeting={meeting}
                invitations={invitations ?? []}
                canHost={canHost.allowed}
              />
            </div>
            <aside
              className={cn(
                "min-w-0",
                closed ? "order-4" : "order-2",
                layout === "page" && "lg:col-start-2 lg:row-start-2",
              )}
            >
              <div className="flex min-w-0 flex-col gap-4">
                <MeetingAIAccessCard workspaceId={workspaceId} meeting={meeting} canHost={canHost.allowed} canClerk={isClerk} />
                <MeetingDetailAside workspaceId={workspaceId} meeting={meeting} canHost={canHost.allowed} />
              </div>
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
          // Either way the question closes: on failure its answer is the
          // notice above the hero, not a toast behind the dialog.
          const onCloseError = (err: unknown) => {
            setConfirm(null);
            setCloseError({ text: apiErrorCopy(err) ?? t("common.error"), status: meeting?.status });
          };
          setCloseError(null);
          if (confirm === "end") {
            end.mutate(meetingId, {
              onSuccess: () => {
                setConfirm(null);
                toast.success(t("meetings.meetingEndedToast"));
              },
              onError: onCloseError,
            });
          } else {
            cancel.mutate(meetingId, {
              onSuccess: () => {
                setConfirm(null);
                toast.success(t("meetings.meetingCanceledToast"));
                onDeleted();
              },
              onError: onCloseError,
            });
          }
        }}
      />
    </div>
  );
}
