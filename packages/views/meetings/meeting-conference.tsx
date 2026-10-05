"use client";
import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { RoomAudioRenderer, StartMediaButton, useIsRecording } from "@livekit/components-react";
import { CaptionsOff, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Meeting } from "@uniwork/core/types";
import { useMeetingCapabilities, useParticipants, useRecordings } from "@uniwork/core/meetings";
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
import { copilotPanelShown } from "./conference-layout";
import {
  captionsErrorKey,
  captionsSupported,
  MeetingLiveCaptions,
} from "./meeting-captions";
import { MeetingConnectionNotice } from "./meeting-connection-notice";
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
  useMeetingChatUnread,
} from "./meeting-room-announcers";
import { MeetingRoomAvatarsProvider } from "./meeting-room-avatars";
import { MeetingScheduleBanner } from "./meeting-schedule-banner";
import { MeetingVotePrompt } from "./meeting-vote-prompt";
import { guestIdentities, muteRequesterIdentities } from "./meeting-signals";
import { MeetingModerationProvider } from "./meeting-moderation";
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
  const handleFooterReserveChange = useCallback((heightPx: number) => {
    setFooterReserve((prev) => (prev === heightPx ? prev : heightPx));
  }, []);
  const handleCaptionsError = useCallback((code: string) => {
    setCaptionsError(code);
    setCaptionsOn(false);
  }, []);
  const resolvedMeetingId = meetingId ?? meeting?.id ?? "";
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
  const openMotions = useCallback(() => openSidebarTab("motions"), [openSidebarTab]);
  const toggleSidebar = useCallback(() => setSidebarPinned((v) => !v), []);
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
  const toggleCopilot = useCallback(() => {
    if (!copilotActive) {
      openSidebarTab("copilot");
      return;
    }
    if (compact) setSidebarSheetOpen(false);
    else setSidebarPinned(false);
  }, [compact, copilotActive, openSidebarTab]);
  const chatVisible = sidebarTab === "chat" && panelShown;
  const chatUnread = useMeetingChatUnread(resolvedMeetingId || undefined, chatVisible);

  const sheetClose = useMemo(
    () => (
      <SheetClose render={<Button type="button" variant="ghost" size="icon-sm" className="mt-0.5 shrink-0" />}>
        <X aria-hidden className="size-4" />
        <span className="sr-only">{t("common.close")}</span>
      </SheetClose>
    ),
    [t],
  );
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
      className="h-full w-full"
      tabsEnd={tabsEnd}
    />
  );

  const prompt = useMemo(
    () => (resolvedMeetingId ? <MeetingVotePrompt meetingId={resolvedMeetingId} onOpenTab={openMotions} /> : null),
    [resolvedMeetingId, openMotions],
  );
  const serverStt = caps?.server_stt === true;
  const captions = useMemo(
    () => (
      <MeetingLiveCaptions
        meetingId={resolvedMeetingId}
        enabled={captionsOn && !!resolvedMeetingId && !serverStt}
        onError={handleCaptionsError}
      />
    ),
    [resolvedMeetingId, captionsOn, serverStt, handleCaptionsError],
  );
  const recordingEnabled = caps?.recording === true;
  const controlBar = useMemo(
    () => (
      <MeetingControlBar
        onLeave={leave}
        meetingId={resolvedMeetingId || undefined}
        canHost={canHost.allowed}
        recordingEnabled={recordingEnabled}
        recording={recording}
        captionsAvailable={!serverStt && captionsSupported()}
        captionsOn={captionsOn}
        onToggleCaptions={toggleCaptions}
        onToggleCopilot={toggleCopilot}
        copilotActive={copilotActive}
      />
    ),
    [leave, resolvedMeetingId, canHost.allowed, recordingEnabled, recording, serverStt, captionsOn, toggleCaptions, toggleCopilot, copilotActive],
  );

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-app-shell">
      <div
        className={cn(
          "flex min-h-0 min-w-0 flex-1 px-3 pb-3 pt-2",
          !compact && sidebarPinned ? "gap-3" : "gap-0",
        )}
      >
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-2xl bg-meeting-stage ring-1 ring-surface-border">
          <div className="dark flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <MeetingStageHeader
              meeting={meeting}
              meetingTitle={meetingTitle}
              workspaceId={workspaceId}
              meetingsHref={meetingsHref}
              workspaceLabel={workspaceLabel}
              guestMode={guestMode}
              recording={recording}
              sidebarOpen={sidebarPinned}
              onToggleSidebar={compact ? undefined : toggleSidebar}
              onOpenSidebar={compact ? openSidebarSheet : undefined}
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
            className="min-h-0 w-[22rem] shrink-0 overflow-hidden rounded-2xl bg-surface ring-1 ring-surface-border xl:w-[24rem]"
          >
            {renderSidebar()}
          </MeetingSidebarDock>
        ) : null}
      </div>

      <MeetingCameraBackgroundSync />
      <MeetingScreenShareWatcher />

      {compact ? (
        <Sheet open={sidebarSheetOpen} onOpenChange={setSidebarSheetOpen}>
          <SheetContent side="right" className="p-0 data-[side=right]:w-[min(100%,24rem)]" showCloseButton={false}>
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
      <ChatMessageAnnouncer latest={chatUnread.latest} visible={chatVisible} />
    </div>
  );
}
