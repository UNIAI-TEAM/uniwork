"use client";
import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { RoomAudioRenderer, StartMediaButton, useIsRecording } from "@livekit/components-react";
import { CaptionsOff, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Meeting } from "@uniwork/core/types";
import { useMeetingCapabilities, useParticipants, useRecordings } from "@uniwork/core/meetings";
import { useMeetingViewSessionScope } from "@uniwork/core/meetings/view-session";
import { useAuthStore } from "@uniwork/core/auth";
import { useMeetingPermissions } from "@uniwork/core/permissions";
import { Button, buttonVariants } from "@uniwork/ui/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@uniwork/ui/components/ui/sheet";
import { useIsCompact } from "@uniwork/ui/hooks/use-mobile";
import { cn } from "@uniwork/ui/lib/utils";
import { Notice } from "../common/notice";
import { copilotPanelShown, liveItemsInView } from "./conference-layout";
import { catchUpLateMinutes, firstJoinedAt } from "./meeting-copilot/meeting-catch-up-card";
import { LiveItemsAnnouncer, useUnseenLiveItems } from "./meeting-copilot/live-items-unseen";
import type { MeetingFeedFilter } from "./meeting-copilot/feed-filter-chips";
import type { UniView } from "./meeting-copilot/uni-status-row";
import {
  captionsErrorKey,
  captionsSupported,
  MeetingLiveCaptions,
} from "./meeting-captions";
import { MeetingConnectionNotice } from "./meeting-connection-notice";
import { MeetingScribeCaptions, useScribeInRoom, useScribeJoinWait, useScribePaused } from "./meeting-scribe-captions";
import { scribeChipState } from "./meeting-scribe-chip";
import { MeetingControlBar } from "./meeting-control-bar";
import { MeetingStageFooter } from "./meeting-stage-footer";
import { MeetingCameraBackgroundSync } from "./meeting-camera-background-sync";
import { MeetingScreenShareWatcher } from "./meeting-screen-share-notices";
import { MeetingStageHeader } from "./meeting-stage-header";
import {
  MeetingRoomSidebar,
  MeetingSidebarDock,
  type MeetingSidebarTab,
} from "./meeting-room-sidebar";
import {
  ChatMessageAnnouncer,
  ParticipantPresenceAnnouncer,
  ReactionAnnouncer,
  ScreenShareAnnouncer,
  ScribeAnnouncer,
  useMeetingChatUnread,
} from "./meeting-room-announcers";
import { MeetingHostChangeToasts } from "./meeting-host-presence";
import { MeetingRoomAvatarsProvider } from "./meeting-room-avatars";
import { MeetingScheduleBanner } from "./meeting-schedule-banner";
import { MeetingVotePrompt } from "./meeting-vote-prompt";
import { guestIdentities, muteRequesterIdentities } from "./meeting-signals";
import { MeetingModerationProvider } from "./meeting-moderation";
import { MeetingSinglePresenter } from "./meeting-single-presenter";
import { MeetingStageTiles } from "./meeting-stage-tiles";
import { MeetingSignalsProvider } from "./use-meeting-signals";

export { tileGridClass, primaryGridClass } from "./conference-layout";

/** Same props, no repaint: a footer reflow or a caption leaves the side panel's tabs alone. */
const RoomSidebar = memo(MeetingRoomSidebar);

function sidebarRoomy(): boolean {
  return typeof window === "undefined" || window.matchMedia("(min-width: 1280px)").matches;
}

export function MeetingConference(props: {
  meetingId?: string;
  meeting?: Meeting;
  meetingTitle?: string;
  workspaceId?: string;
  meetingsHref?: string;
  workspaceLabel?: string;
  guestMode?: boolean;
  onLeave: () => void;
  /** Device trouble (a blocked mic, a busy camera) shown on the stage, above the tiles. */
  deviceNotice?: ReactNode;
}) {
  const { canHost } = useMeetingPermissions(props.meeting ?? null, props.workspaceId ?? "");
  const { data: apiParticipants } = useParticipants(props.meetingId ?? props.meeting?.id ?? "");
  const hostIdentities = useMemo(
    () => muteRequesterIdentities(props.meeting?.host_user_id, apiParticipants ?? []),
    [apiParticipants, props.meeting?.host_user_id],
  );
  const guests = useMemo(() => guestIdentities(apiParticipants ?? []), [apiParticipants]);
  // Hide and pin are for this visit: leaving the room forgets them.
  useMeetingViewSessionScope(props.meetingId ?? props.meeting?.id);
  return (
    <MeetingSignalsProvider canHost={canHost.allowed} hostIdentities={hostIdentities}>
      <MeetingModerationProvider meetingId={props.meetingId ?? props.meeting?.id} canHost={canHost.allowed && !props.guestMode}>
        <MeetingRoomAvatarsProvider
          participants={apiParticipants}
          workspaceId={props.guestMode ? "" : (props.workspaceId ?? "")}
        >
          <ConferenceStage {...props} guests={guests} />
        </MeetingRoomAvatarsProvider>
      </MeetingModerationProvider>
    </MeetingSignalsProvider>
  );
}

function ConferenceStage({
  meetingId,
  meeting,
  meetingTitle,
  workspaceId,
  meetingsHref,
  workspaceLabel,
  guestMode,
  guests,
  onLeave,
  deviceNotice,
}: {
  meetingId?: string;
  meeting?: Meeting;
  meetingTitle?: string;
  workspaceId?: string;
  meetingsHref?: string;
  workspaceLabel?: string;
  guestMode?: boolean;
  guests: ReadonlySet<string>;
  onLeave: () => void;
  deviceNotice?: ReactNode;
}) {
  const { t } = useTranslation();
  const compact = useIsCompact();
  const [sidebarSheetOpen, setSidebarSheetOpen] = useState(false);
  // The panel starts docked only where the stage keeps room for its header;
  // between lg and xl it squeezed the title to a few letters.
  const [sidebarPinned, setSidebarPinned] = useState(sidebarRoomy);
  const [sidebarTab, setSidebarTab] = useState<MeetingSidebarTab>(guestMode ? "chat" : "copilot");
  const [captionsOn, setCaptionsOn] = useState(false);
  const [captionsError, setCaptionsError] = useState<string | null>(null);
  const [footerReserve, setFooterReserve] = useState(96);
  const stageContentRef = useRef<HTMLDivElement>(null);
  // The stage frame the scribe's captions float over (state, so the captions follow it once it mounts).
  const [stageFrame, setStageFrame] = useState<HTMLDivElement | null>(null);
  const handleFooterReserveChange = useCallback((heightPx: number) => {
    setFooterReserve((prev) => (prev === heightPx ? prev : heightPx));
  }, []);
  const handleCaptionsError = useCallback((code: string) => {
    setCaptionsError(code);
    setCaptionsOn(false);
  }, []);
  const resolvedMeetingId = meetingId ?? meeting?.id ?? "";
  // The late joiner's catch-up counts from their first entry this session, not this mount.
  const joinedAt = useMemo(() => firstJoinedAt(resolvedMeetingId), [resolvedMeetingId]);
  const viewerId = useAuthStore((s) => s.user?.id);
  const [catchUpDismissed, setCatchUpDismissed] = useState(false);
  const dismissCatchUp = useCallback(() => setCatchUpDismissed(true), []);
  const lateMinutes = catchUpDismissed
    ? null
    : catchUpLateMinutes({ meeting, joinedAt, viewerId, guest: guestMode });
  const { canHost } = useMeetingPermissions(meeting ?? null, workspaceId ?? "");
  const { data: caps } = useMeetingCapabilities(workspaceId ?? "");
  const { data: recordings } = useRecordings(resolvedMeetingId);
  // LiveKit tells every participant, guests included; the query covers the
  // moments before the egress reports in.
  const roomRecording = useIsRecording();
  const recording = roomRecording || (recordings ?? []).some((r) => r.status === "ACTIVE");
  // The room view may hand a fresh callback on each of its renders; the
  // control bar is memoized, so it gets one that never changes.
  const onLeaveRef = useRef(onLeave);
  useLayoutEffect(() => {
    onLeaveRef.current = onLeave;
  });
  const leave = useCallback(() => onLeaveRef.current(), []);

  const openSidebarTab = useCallback(
    (tab: MeetingSidebarTab) => {
      setSidebarTab(tab);
      if (compact) setSidebarSheetOpen(true);
      else setSidebarPinned(true);
    },
    [compact],
  );
  const openPeople = useCallback(() => openSidebarTab("participants"), [openSidebarTab]);
  // The prompt's card goes away under its own button once Votes is on screen,
  // so the keyboard follows to the Votes tab.
  const [dockFocusRequest, setDockFocusRequest] = useState(0);
  const openMotions = useCallback(() => {
    openSidebarTab("motions");
    setDockFocusRequest((n) => n + 1);
  }, [openSidebarTab]);
  const toggleSidebar = useCallback(() => setSidebarPinned((v) => !v), []);
  // The panel's own collapse button leaves with the panel; the header's toggle reopens it.
  const collapseSidebar = useCallback(() => {
    setSidebarPinned(false);
    stageFrame?.querySelector<HTMLElement>("[data-panel-toggle]")?.focus();
  }, [stageFrame]);
  const openSidebarSheet = useCallback(() => setSidebarSheetOpen(true), []);
  const toggleCaptions = useCallback(() => {
    setCaptionsError(null);
    setCaptionsOn((v) => !v);
  }, []);
  const panelShown = compact ? sidebarSheetOpen : sidebarPinned;
  const copilotActive = copilotPanelShown({
    tab: sidebarTab,
    compact,
    sheetOpen: sidebarSheetOpen,
    pinned: sidebarPinned,
  });
  // Once the UNI panel has been on screen, the catch-up is no longer news.
  const [catchUpSeen, setCatchUpSeen] = useState(false);
  if (copilotActive && lateMinutes !== null && !catchUpSeen) setCatchUpSeen(true);
  const copilotBadge = lateMinutes !== null && !catchUpSeen;
  const chatVisible = sidebarTab === "chat" && panelShown;
  // The Votes tab carries the same ballot as the stage's prompt: one on screen at a time.
  const votesTabShown = sidebarTab === "motions" && panelShown;
  // The live items the scribe writes are seen once the UNI highlights show them (all kinds, or the tasks).
  const [uniView, setUniView] = useState<UniView>("feed");
  const [uniFilter, setUniFilter] = useState<MeetingFeedFilter>("all");
  const onUniViewChange = useCallback((view: UniView, filter: MeetingFeedFilter) => {
    setUniView(view);
    setUniFilter(filter);
  }, []);
  const liveItemsSeeing = liveItemsInView(copilotActive, uniView, uniFilter);
  const liveItems = useUnseenLiveItems(guestMode ? undefined : resolvedMeetingId || undefined, liveItemsSeeing);
  const chatUnread = useMeetingChatUnread(resolvedMeetingId || undefined, chatVisible);
  // What waits in UNI behind a closed panel rides on the header's panel button (the Main board has no UNI button in the dock).
  const panelNews = panelShown
    ? null
    : copilotBadge
      ? t("meetings.aiCopilotCatchUp")
      : liveItems.count > 0
        ? t("meetings.aiCopilotLiveItems", { count: liveItems.count })
        : null;

  const sheetClose = useMemo(
    () => (
      <SheetClose
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-11 shrink-0 rounded-xl bg-surface-hover text-foreground"
          />
        }
      >
        <X aria-hidden className="size-4" />
        <span className="sr-only">{t("common.close")}</span>
      </SheetClose>
    ),
    [t],
  );
  // The AI scribe in the room captions everyone; without it, or while its STT
  // fails (benchmark #1), each viewer keeps their own Web Speech captions (spec D12).
  const scribeInRoom = useScribeInRoom();
  const scribePaused = useScribePaused();
  const scribeCaptioning = scribeInRoom && !scribePaused;
  // What the scribe is doing (the UNI tab's status row), where the workspace has one. On its way in
  // ("joining"), the scribe's own box says so rather than handing the viewer device captions for its first seconds.
  const scribeState = caps?.scribe === true && meeting ? scribeChipState(meeting, scribeInRoom, scribePaused) : undefined;
  const scribeJoining = useScribeJoinWait(scribeState === "joining");
  const renderSidebar = (tabsEnd?: ReactNode) => (
    <RoomSidebar
      meetingId={resolvedMeetingId || undefined}
      meeting={meeting}
      workspaceId={workspaceId}
      canHost={canHost.allowed}
      guestMode={guestMode}
      tab={sidebarTab}
      onTabChange={setSidebarTab}
      chatUnread={chatUnread.unread}
      lateMinutes={lateMinutes}
      onDismissCatchUp={dismissCatchUp}
      className="h-full w-full"
      tabsEnd={tabsEnd}
      onCollapse={compact ? undefined : collapseSidebar}
      scribeOn={scribeInRoom}
      scribeState={scribeState}
      liveItemsUnseen={liveItems.count}
      liveItemIds={liveItems.ids}
      onUniViewChange={onUniViewChange}
    />
  );

  const prompt = useMemo(
    () =>
      resolvedMeetingId ? (
        <MeetingVotePrompt meetingId={resolvedMeetingId} onOpenTab={openMotions} hidden={votesTabShown} />
      ) : null,
    [resolvedMeetingId, openMotions, votesTabShown],
  );
  const captions = useMemo(
    () =>
      scribeCaptioning || scribeJoining ? (
        <MeetingScribeCaptions
          enabled={captionsOn}
          joining={!scribeCaptioning}
          meetingId={resolvedMeetingId || undefined}
          stage={stageFrame}
        />
      ) : (
        <MeetingLiveCaptions
          meetingId={resolvedMeetingId}
          enabled={captionsOn && !!resolvedMeetingId}
          onError={handleCaptionsError}
        />
      ),
    [resolvedMeetingId, captionsOn, scribeCaptioning, scribeJoining, stageFrame, handleCaptionsError],
  );
  const recordingEnabled = caps?.recording === true;
  const hostLeave = useMemo(
    () =>
      canHost.allowed && !guestMode && workspaceId && meeting?.status === "IN_PROGRESS" ? { meeting, workspaceId } : undefined,
    [canHost.allowed, guestMode, workspaceId, meeting],
  );
  const controlBar = useMemo(
    () => (
      <MeetingControlBar
        onLeave={leave}
        meetingId={resolvedMeetingId || undefined}
        canHost={canHost.allowed}
        hostLeave={hostLeave}
        recordingEnabled={recordingEnabled}
        recording={recording}
        captionsAvailable={scribeInRoom || scribeJoining || captionsSupported()}
        captionsOn={captionsOn}
        onToggleCaptions={toggleCaptions}
      />
    ),
    [leave, resolvedMeetingId, canHost.allowed, hostLeave, recordingEnabled, recording, scribeInRoom, scribeJoining, captionsOn, toggleCaptions],
  );

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-app-shell">
      <div
        className={cn(
          "flex min-h-0 min-w-0 flex-1 px-3 pb-3 pt-2",
          !compact && sidebarPinned ? "gap-3" : "gap-0",
        )}
      >
        <div
          ref={setStageFrame}
          className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-2xl bg-meeting-stage ring-1 ring-surface-border"
        >
          <div className="dark flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <MeetingStageHeader
              meeting={meeting}
              meetingTitle={meetingTitle}
              workspaceId={workspaceId}
              meetingsHref={meetingsHref}
              workspaceLabel={workspaceLabel}
              guestMode={guestMode}
              recording={recording}
              scribeAvailable={caps?.scribe === true}
              sidebarOpen={sidebarPinned}
              onToggleSidebar={compact ? undefined : toggleSidebar}
              onOpenSidebar={compact ? openSidebarSheet : undefined}
              panelNews={panelNews}
              onOpenPeople={openPeople}
              peopleOpen={sidebarTab === "participants" && panelShown}
            />
            <div
              ref={stageContentRef}
              // `isolate` keeps the tiles' own z layers (ring, controls) inside the
              // stage, so nothing here paints over what hangs from the header.
              className="relative isolate flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden px-3 pt-3 pb-2 sm:px-4 sm:pb-2"
              data-testid="meeting-stage-content"
            >
              <MeetingConnectionNotice />
              {deviceNotice}
              {captionsError ? (
                <Notice
                  tone="destructive"
                  icon={CaptionsOff}
                  layout="inline"
                  className="mb-2 shrink-0"
                  action={
                    <Button type="button" size="sm" variant="ghost" onClick={() => setCaptionsError(null)}>
                      {t("common.close")}
                    </Button>
                  }
                >
                  {t(captionsErrorKey(captionsError))}
                </Notice>
              ) : null}
              <MeetingScheduleBanner
                endsAt={meeting?.ends_at}
                canHost={canHost.allowed && !guestMode}
                meetingId={meeting?.id ?? meetingId}
                workspaceId={workspaceId}
              />
              <MeetingStageTiles canHost={canHost.allowed} guests={guests} />
              {/* Room for the floating footer; sized in one step, never animated, so tiles reflow once. */}
              <div
                aria-hidden
                className="shrink-0"
                style={{ height: footerReserve }}
                data-testid="meeting-stage-footer-spacer"
              />
            </div>

            <StartMediaButton
              label={t("meetings.allowMedia")}
              className={cn(buttonVariants({ variant: "brand" }), "absolute left-1/2 z-10 -translate-x-1/2")}
              style={{ bottom: footerReserve + 16 }}
            />
          </div>

          <MeetingStageFooter
            stageContentRef={stageContentRef}
            captionsOn={captionsOn}
            prompt={prompt}
            captions={captions}
            onReserveHeightChange={handleFooterReserveChange}
            controlBar={controlBar}
          />
        </div>

        {!compact ? (
          <MeetingSidebarDock
            open={sidebarPinned}
            focusRequest={dockFocusRequest}
            className="min-h-0 w-[22rem] shrink-0 overflow-hidden rounded-2xl bg-surface ring-1 ring-surface-border xl:w-[24rem]"
          >
            {renderSidebar()}
          </MeetingSidebarDock>
        ) : null}
      </div>

      <MeetingCameraBackgroundSync />
      <MeetingScreenShareWatcher />
      <MeetingSinglePresenter />

      {compact ? (
        <Sheet open={sidebarSheetOpen} onOpenChange={setSidebarSheetOpen}>
          {/* Rises from the bottom over the stage, leaving its top in view. */}
          <SheetContent
            side="bottom"
            // The room stays in sight behind the sheet, neither blurred nor dimmed (Phone board).
            overlayClassName="bg-transparent supports-backdrop-filter:backdrop-blur-none"
            className="gap-0 overflow-hidden rounded-t-[22px] border-t-0 bg-surface p-0 data-[side=bottom]:h-[72dvh]"
            showCloseButton={false}
          >
            <div aria-hidden className="mx-auto mt-2 mb-1 h-[5px] w-10 shrink-0 rounded-[3px] bg-border" />
            <SheetHeader className="sr-only">
              <SheetTitle>{t("meetings.roomPanel")}</SheetTitle>
            </SheetHeader>
            {/* The sheet's close button sits in the tab row: laid over it, it covered the last tab on a phone. */}
            {sidebarSheetOpen ? renderSidebar(sheetClose) : null}
          </SheetContent>
        </Sheet>
      ) : null}

      <RoomAudioRenderer />
      <ReactionAnnouncer />
      <ParticipantPresenceAnnouncer />
      <ScreenShareAnnouncer />
      <ScribeAnnouncer meeting={meeting} />
      {meeting && !guestMode ? <MeetingHostChangeToasts meeting={meeting} /> : null}
      <ChatMessageAnnouncer latest={chatUnread.latest} visible={chatVisible} />
      <LiveItemsAnnouncer count={liveItems.count} latest={liveItems.latest} seeing={liveItemsSeeing} />
    </div>
  );
}
