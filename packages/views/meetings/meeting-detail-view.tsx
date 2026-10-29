"use client";
import { useMemo, useState, type ReactNode } from "react";
import { Ban, CircleAlert, Pencil } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  displayMeetingStatus,
  useCancelMeeting,
  useEndMeeting,
  useInvitations,
  useJoinRequests,
  useMeeting,
  useMeetingActivity,
  useParticipants,
} from "@uniwork/core/meetings";
import { paths } from "@uniwork/core/paths";
import { useMeetingClerk } from "@uniwork/core/meetings/attendance";
import { useMeetingActionItems } from "@uniwork/core/meetings/action-items";
import { useMeetingMinutes, useMeetingMinutesEnabled } from "@uniwork/core/meetings/minutes";
import { useMeetingMotions } from "@uniwork/core/meetings/motions";
import { useMeetingSummaryRun } from "@uniwork/core/meetings/summary";
import { useFullTranscript } from "@uniwork/core/meetings/transcript";
import { useMeetingPermissions } from "@uniwork/core/permissions";
import { useMeetingScope } from "@uniwork/core/realtime";
import { ApiError } from "@uniwork/core/api";
import { toast } from "sonner";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { apiErrorCopy } from "../api-error-copy";
import { useOptionalNavigation } from "../navigation";
import { BreadcrumbHeader } from "../layout/breadcrumb-header";
import { CollectionPageHeaderAction } from "../layout/collection-page";
import { useWorkspace } from "../layout/workspace-context";
import { useAskUniPageContext } from "../ai/ask-uni-page-context";
import { MeetingSheet } from "./meeting-sheet";
import { DetailBody } from "./meeting-detail/detail-body";
import { DetailContext, type DetailContextValue } from "./meeting-detail/detail-context";
import { DetailHeader, DetailMenu, type DetailMenuItem } from "./meeting-detail/detail-header";
import { sectionFlags, viewerRole, visibleTabs } from "./meeting-detail/detail-model";
import { DetailSkeleton } from "./meeting-detail/detail-skeleton";
import { MeetingsCrumb } from "./meeting-detail/meetings-crumb";
import { DetailLoadFailed, DetailNotFound } from "./meeting-detail/detail-states";
import { DETAIL_SCROLLER_ID, DETAIL_SHEET } from "./meeting-detail/layout";
import { nextStepJobs, type MinutesState } from "./meeting-detail/next-step-jobs";
import { MeetingJustEndedCard } from "./meeting-detail/just-ended-card";
import { NextStepStrip } from "./meeting-detail/next-step-strip";
import { PhoneBarProvider, PhoneBottomBar, PhoneTop, useNarrow } from "./meeting-detail/phone-frame";
import { HistoryDrawer } from "./meeting-detail/rail/history-drawer";
import { PhonePeopleRow } from "./meeting-detail/rail/phone-rail";
import { Dialog440 } from "./meeting-detail/ui/overlay";
import { kitButton } from "./meeting-detail/ui/kit-buttons";
import { useDetailTab } from "./meeting-detail/use-detail-tab";
import { useInPersonStrip } from "./meeting-detail/use-in-person-strip";
import { useMemberIndex } from "./use-member-index";
import { scrollSectionIntoView, useMeetingSectionDeepLink } from "./use-meeting-section-deep-link";
import { useNow } from "./use-now";

/** Bring a section into view and put focus on its first control (the strip's "Rà và giao"). */
function goToSection(headingId: string): void {
  const heading = document.getElementById(headingId);
  // The section carries the scroll margin (kit `.section { scroll-margin-top:24px }`), not its heading.
  if (heading) scrollSectionIntoView(heading.closest("section") ?? heading);
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
  onRecord,
  layout = "page",
  headerActions,
}: {
  workspaceId: string;
  meetingId: string;
  onJoin: () => void;
  onDeleted: () => void;
  /** Bắt đầu ghi âm of an in-person meeting (UNI-2247); absent, the page offers no recording. */
  onRecord?: (opts?: { send?: boolean }) => void;
  layout?: "page" | "panel";
  headerActions?: ReactNode;
}) {
  const { t } = useTranslation();
  const { workspace, user } = useWorkspace();
  // In-room events (roll, motions, transcript) are meeting-scoped; the detail
  // page shows them live, so it holds the meeting open like the room does.
  useMeetingScope(meetingId);
  const { data: meeting, isError, error, isPending, refetch } = useMeeting(meetingId);
  // The docked panel of a room is not the page; only the detail page is the context.
  useAskUniPageContext(meeting && layout === "page" ? { kind: "meeting", id: meetingId, label: meeting.title } : null);
  const { data: invitations } = useInvitations(meetingId);
  const { data: participants } = useParticipants(meetingId);
  const { data: joinRequests } = useJoinRequests(meetingId);
  const memberIndex = useMemberIndex(workspaceId);
  const now = useNow();
  const { data: activity } = useMeetingActivity(meetingId);
  const { canHost, canCancel } = useMeetingPermissions(meeting ?? null, workspaceId);
  // Host, secretary or workspace admin: the summary and the action items (spec D3).
  const { isClerk } = useMeetingClerk(meeting ?? null, workspaceId);
  const inPersonStrip = useInPersonStrip(workspaceId, meeting, isClerk, user.id);
  // The organization's own answer: an override for it turns the minutes on.
  const minutesOn = useMeetingMinutesEnabled(workspace.organization_id);
  const end = useEndMeeting(workspaceId);
  const cancel = useCancelMeeting(workspaceId);
  const nav = useOptionalNavigation();
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const isPhone = useNarrow(root, layout === "page");
  const [bar, setBar] = useState<HTMLDivElement | null>(null);
  const [scrolled, setScrolled] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [rollOpen, setRollOpen] = useState(false);
  const [followUpOpen, setFollowUpOpen] = useState(false);
  const [confirm, setConfirm] = useState<"cancel" | "end" | null>(null);
  // The question's copy outlives a close, so its exit animation does not read as the other question.
  const [confirmKind, setConfirmKind] = useState<"cancel" | "end">("cancel");
  const ask = (kind: "cancel" | "end") => {
    setConfirmKind(kind);
    setConfirm(kind);
  };
  // Why the last end/cancel failed, said under the header until the next try, and only
  // while the meeting stays as it was: once another host ended it, that failure is moot.
  const [closeError, setCloseError] = useState<{ text: string; status?: string } | null>(null);
  const [editOpen, setEditOpen] = useState(false);

  const status = meeting ? displayMeetingStatus(meeting, now) : "SCHEDULED";
  const activeParticipants = useMemo(() => (participants ?? []).filter((p) => p.status === "ACTIVE"), [participants]);
  const participantById = useMemo(() => new Map(activeParticipants.map((p) => [p.id, p])), [activeParticipants]);
  const viewer = viewerRole({
    userId: user.id,
    hostUserId: meeting?.host_user_id,
    participants: activeParticipants,
    canHost: canHost.allowed,
  });
  const aiReadable = meeting?.ai_content_readable !== false;
  const offeredTabs = meeting ? visibleTabs(status, viewer, { aiReadable, minutes: minutesOn }) : [];
  // Scribe off (AfterAIStates c4): no Lời thoại tab unless lines were heard before it was turned off.
  // Decided here, not in the bar, so a shared ?tab=transcript resolves to a tab the bar draws.
  const scribeOff = status === "ENDED" && meeting?.scribe_enabled === false && offeredTabs.includes("transcript");
  const { data: heard } = useFullTranscript(meetingId, scribeOff);
  const tabList = scribeOff && !heard?.length ? offeredTabs.filter((name) => name !== "transcript") : offeredTabs;
  const tab = useDetailTab(tabList, { urlBacked: layout === "page" });
  const ended = status === "ENDED";
  const live = status === "IN_PROGRESS" || status === "OVERTIME";
  const { data: actionItems } = useMeetingActionItems(ended && viewer !== "outsider" ? meetingId : "");
  const { data: minutes, isSuccess: minutesLoaded } = useMeetingMinutes(meetingId, ended && minutesOn && isClerk);
  const { data: motions } = useMeetingMotions(meetingId, live);
  // Same query as the summary section (one fetch): the strip says "Đang soạn tóm tắt" while it runs.
  const { data: summaryRun } = useMeetingSummaryRun(ended && isClerk && meeting?.ai_content_readable !== false ? meetingId : "");
  useMeetingSectionDeepLink({ ready: Boolean(meeting) && (live || ended) });

  const wsPaths = paths.workspace(workspace.organization_slug, workspace.slug);
  const meetingsHref = wsPaths.meetings();
  const missing = (!isPending && !isError && !meeting) ||
    (error instanceof ApiError && (error.status === 404 || error.status === 403));

  if (missing || isError) {
    // A missing meeting (or one this viewer may not see) and a failed load read
    // differently: one sends you back to the list, the other offers a retry.
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <BreadcrumbHeader
          segments={layout === "panel" ? [] : [{ href: meetingsHref, label: <MeetingsCrumb /> }]}
          leaf={t("meetings.detail.states.leaf")}
          actions={headerActions}
        />
        {missing ? <DetailNotFound listHref={meetingsHref} /> : <DetailLoadFailed onRetry={() => void refetch()} />}
      </div>
    );
  }
  if (!meeting) return <DetailSkeleton />;

  const nameOf = (userId?: string | null) =>
    memberIndex.memberOf(userId)?.display_name ??
    activeParticipants.find((p) => p.user_id === userId)?.display_name_snapshot ??
    "";
  const hostName = nameOf(meeting.host_user_id) || t("meetings.hostUnknown");
  const sections = sectionFlags({ status, viewer, aiReadable, minutesOn, hasProject: Boolean(meeting.project_id), inPerson: inPersonStrip.inPerson });
  const myParticipant = activeParticipants.find((p) => p.user_id === user.id);
  const canceledRow = (activity ?? []).find((a) => a.event_type === "MEETING_CANCELED");
  const pendingJoins = (joinRequests ?? []).filter((r) => r.status === "PENDING").length;
  const openVotes = (motions ?? []).filter((m) => m.status === "OPEN" && (isClerk || !m.my_ballot?.cast)).length;
  const minutesState: MinutesState = !minutesOn ? "off" : !minutesLoaded ? "off" : !minutes ? "none" : minutes.finalized ? "final" : "draft";
  const jobs = nextStepJobs({
    status,
    viewer,
    canHost: canHost.allowed,
    canCancel: canCancel.allowed,
    isClerk,
    hasInvitation: (invitations ?? []).some((inv) => inv.participant_id === myParticipant?.id),
    pendingNames: (invitations ?? [])
      .filter((inv) => inv.response_status === "PENDING")
      .map((inv) => participantById.get(inv.participant_id))
      .map((p) => p?.display_name_snapshot || nameOf(p?.user_id))
      .filter(Boolean),
    liveNeed: (sections.lobby ? pendingJoins : 0) + openVotes,
    windowAhead: Date.parse(meeting.ends_at) > now,
    items: actionItems?.items ?? null,
    userId: user.id,
    minutes: minutesState,
    minutesEditable: minutes?.can_edit === true,
    summaryRunning: summaryRun?.status === "running",
    ...inPersonStrip,
  });

  const stripHandlers = {
    onJoin,
    onRecord,
    onEnd: () => ask("end"),
    onReview: () => review(),
    onEdit: () => setEditOpen(true),
    onFinalize: () => tab.set("minutes", { finalize: "1" }),
    onFollowUpCreated: (id: string) => nav?.push(wsPaths.meeting(id)),
    hostName,
    clerkNames: [
      hostName,
      ...activeParticipants.filter((p) => p.is_secretary && p.user_id !== meeting.host_user_id).map((p) => nameOf(p.user_id) || p.display_name_snapshot || ""),
    ].filter(Boolean),
    canceledBy: canceledRow ? { name: nameOf(canceledRow.actor_id), at: canceledRow.occurred_at } : undefined,
  };
  // The room sends the host who ended the meeting here with ?ended=1 (board E); any later visit gets the strip.
  const justEndedJob =
    nav?.searchParams.get("ended") === "1" ? jobs.find((j) => j.kind === "closeOut") : undefined;

  const review = () => {
    // The page's router.replace commits after the next frame, so it scrolls through the
    // ?section= deep link once the overview is mounted; the panel's tab state commits in the click.
    if (layout === "page") return tab.set("overview", { section: "action-items" });
    tab.set("overview");
    requestAnimationFrame(() => goToSection("action-items-heading"));
  };
  const detail: DetailContextValue = {
    workspaceId,
    meeting,
    displayStatus: status,
    now,
    viewer,
    canHost: canHost.allowed,
    isClerk,
    aiReadable,
    layout,
    isPhone,
    memberIndex,
    participants: activeParticipants,
    invitations: invitations ?? [],
    rosterLoaded: participants !== undefined && invitations !== undefined,
    sections,
    tabs: {
      list: tabList,
      current: tab.current,
      set: (next) => tab.set(next),
      finalize: { open: tab.finalize, close: tab.closeFinalize },
      review,
    },
    roll: { open: rollOpen, setOpen: setRollOpen },
    transcribing: inPersonStrip.transcribing,
  };

  const scheduled = status === "SCHEDULED";
  const canEdit = canHost.allowed && status !== "CANCELED";
  const cancelable = canCancel.allowed && (scheduled || status === "MISSED");
  // The page's header bar carries edit and cancel as buttons and its rail the history;
  // a phone and the calendar panel draw no such bar or rail link, so they keep the ⋯.
  const inHeader = !isPhone && layout === "page";
  const menu: DetailMenuItem[] = inHeader
    ? []
    : [
        ...(canEdit ? [{ key: "edit", label: t("meetings.edit"), onSelect: () => setEditOpen(true) }] : []),
        ...(isPhone && canHost.allowed && live ? [{ key: "end", label: t("meetings.end"), onSelect: () => ask("end") }] : []),
        ...(isPhone && canHost.allowed && ended
          ? [{ key: "followUp", label: t("meetings.detail.header.followUp"), onSelect: () => setFollowUpOpen(true) }]
          : []),
        { key: "history", label: t("meetings.detail.header.history"), onSelect: () => setHistoryOpen(true) },
        ...(cancelable ? [{ key: "cancel", label: t("meetings.cancel"), destructive: true, onSelect: () => ask("cancel") }] : []),
      ];
  const menuNode = <DetailMenu items={menu} className={isPhone ? "size-11" : undefined} />;
  const actions = inHeader ? (
    <>
      {canEdit ? (
        <CollectionPageHeaderAction icon={Pencil} label={t("meetings.edit")} aria-haspopup="dialog" onClick={() => setEditOpen(true)} />
      ) : null}
      {cancelable ? (
        <CollectionPageHeaderAction icon={Ban} label={t("meetings.cancel")} variant="destructive" aria-haspopup="dialog" onClick={() => ask("cancel")} />
      ) : null}
      {headerActions}
    </>
  ) : (
    headerActions
  );

  return (
    <DetailContext.Provider value={detail}>
      <div ref={setRoot} className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {isPhone ? (
          <PhoneTop title={meeting.title} listHref={meetingsHref} showTitle={scrolled} menu={menuNode} />
        ) : (
          <BreadcrumbHeader
            segments={layout === "panel" ? [] : [{ href: meetingsHref, label: <MeetingsCrumb /> }]}
            leaf={meeting.title}
            actions={actions}
          />
        )}
        {/* relative: absolute descendants (sr-only text, checkbox inputs) belong to this scroller, not the frame. */}
        <div
          id={DETAIL_SCROLLER_ID}
          className="@container/meeting relative min-h-0 flex-1 overflow-auto"
          onScroll={isPhone ? (e) => setScrolled(e.currentTarget.scrollTop > 80) : undefined}
        >
          <PhoneBarProvider value={isPhone ? bar : null}>
            <div data-testid="meeting-detail-content" className={cn(DETAIL_SHEET, layout === "panel" && "max-w-none px-4 pt-4")}>
              <DetailHeader
                meeting={meeting}
                status={status}
                // A recording on this device says the meeting is under way before anyone recorded it held (board p11),
                // past its planned end too, where the clock alone would read it MISSED.
                statusOverride={(status === "SCHEDULED" || status === "MISSED") && inPersonStrip.unsent ? "IN_PROGRESS" : undefined}
                now={now}
                menu={isPhone ? null : menuNode}
              />
              {isPhone && ended ? <PhonePeopleRow /> : null}
              {closeError && closeError.status === meeting.status ? (
                <p role="alert" className="mt-4 flex items-start gap-2 text-body text-destructive">
                  <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
                  {closeError.text}
                </p>
              ) : null}
              {justEndedJob ? (
                <MeetingJustEndedCard job={justEndedJob} handlers={stripHandlers} />
              ) : (
                <NextStepStrip jobs={jobs} handlers={stripHandlers} />
              )}
              <DetailBody />
            </div>
          </PhoneBarProvider>
        </div>
        {isPhone ? (
          <PhoneBottomBar barRef={setBar} meetingId={meeting.id} title={meeting.title} workspaceId={workspaceId} ask={sections.ai} />
        ) : null}
        {/* The edit sheet opens from the header (⋯ on a phone or in the panel) and the missed strip's "Đặt lại lịch"; it outlives that row once the meeting is scheduled again. */}
        <MeetingSheet mode="edit" workspaceId={workspaceId} meeting={meeting} open={editOpen} showTrigger={false} onOpenChange={setEditOpen} />
        {followUpOpen ? (
          <MeetingSheet
            mode="followUp"
            workspaceId={workspaceId}
            previous={meeting}
            previousParticipants={activeParticipants}
            open
            showTrigger={false}
            onOpenChange={setFollowUpOpen}
            onDone={(id) => nav?.push(wsPaths.meeting(id))}
          />
        ) : null}
        <HistoryDrawer open={historyOpen} onOpenChange={setHistoryOpen} />
        <Dialog440
          role="alertdialog"
          open={confirm !== null}
          onOpenChange={(open) => !open && setConfirm(null)}
          title={confirmKind === "end" ? t("meetings.endConfirmTitle") : t("meetings.cancelConfirmTitle")}
          description={confirmKind === "end" ? t("meetings.detail.header.endConfirm") : t("meetings.cancelConfirm")}
          footer={
            <>
              <Button type="button" size="lg" variant="ghost" className={cn(kitButton.base, kitButton.ghost)} onClick={() => setConfirm(null)}>
                {t("meetings.detail.header.keep")}
              </Button>
              <Button
                type="button"
                size="lg"
                variant="destructiveSolid"
                className={kitButton.base}
                aria-disabled={end.isPending || cancel.isPending || undefined}
                onClick={() => {
                  if (end.isPending || cancel.isPending) return;
                  // Either way the question closes: on failure its answer is the
                  // line under the header, not a toast behind the dialog.
                  const onCloseError = (err: unknown) => {
                    setConfirm(null);
                    setCloseError({ text: apiErrorCopy(err) ?? t("common.error"), status: meeting.status });
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
              >
                {confirmKind === "end" ? t("meetings.confirmEnd") : t("meetings.confirmCancel")}
              </Button>
            </>
          }
        />
      </div>
    </DetailContext.Provider>
  );
}
