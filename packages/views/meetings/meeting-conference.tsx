"use client";
import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import {
  isTrackReference,
  RoomAudioRenderer,
  StartMediaButton,
  useIsRecording,
  useSpeakingParticipants,
  useTracks,
  type TrackReferenceOrPlaceholder,
} from "@livekit/components-react";
import { Track } from "livekit-client";
import { CaptionsOff, ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Meeting } from "@uniwork/core/types";
import { useMeetingCapabilities, useParticipants, useRecordings } from "@uniwork/core/meetings";
import { useMeetingRoomPreferencesStore } from "@uniwork/core/meetings/room-preferences";
import { useMeetingViewSessionStore } from "@uniwork/core/meetings/view-session";
import { useMeetingPermissions } from "@uniwork/core/permissions";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@uniwork/ui/components/ui/sheet";
import { useIsCompact } from "@uniwork/ui/hooks/use-mobile";
import { cn } from "@uniwork/ui/lib/utils";
import { Notice } from "../common/notice";
import {
  copilotPanelShown,
  resolveConferenceStage,
  trackTileKey,
} from "./conference-layout";
import {
  captionsErrorKey,
  captionsSupported,
  MeetingLiveCaptions,
} from "./meeting-captions";
import { MeetingConnectionNotice } from "./meeting-connection-notice";
import { MeetingControlBar } from "./meeting-control-bar";
import { MeetingStageFooter } from "./meeting-stage-footer";
import { MeetingCameraBackgroundSync } from "./meeting-camera-background-sync";
import { MeetingParticipantTile } from "./meeting-participant-tile";
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
import { MeetingScheduleBanner } from "./meeting-schedule-banner";
import { guestIdentities, muteRequesterIdentities, participantRole } from "./meeting-signals";
import { MeetingSignalsProvider } from "./use-meeting-signals";

export { tileGridClass, primaryGridClass } from "./conference-layout";

/** The "+N" tile at the end of a strip; its count is read out as words. */
function OverflowTile({ count, className }: { count: number; className?: string }) {
  const { t } = useTranslation();
  return (
    <div
      className={cn(
        "flex aspect-[4/3] shrink-0 items-center justify-center rounded-xl bg-muted text-caption font-medium text-muted-foreground ring-1 ring-surface-border",
        className,
      )}
    >
      <span aria-hidden>{t("meetings.moreParticipantsShort", { count })}</span>
      <span className="sr-only">{t("meetings.moreParticipantsLabel", { count })}</span>
    </div>
  );
}

/** Page switcher for a room with more people than tiles; sits in the tile area, not over the header. */
function StagePager({
  page,
  pages,
  onPage,
}: {
  page: number;
  pages: number;
  onPage: (page: number) => void;
}) {
  const { t } = useTranslation();
  return (
    <nav
      aria-label={t("meetings.pageOf", { page: page + 1, pages })}
      className="flex shrink-0 items-center justify-center"
    >
      <div className="flex items-center gap-1 rounded-full bg-meeting-bar-bg p-1 text-meeting-bar-foreground ring-1 ring-meeting-bar-border">
        <Button
          type="button"
          size="icon"
          variant="meetingChip"
          className="size-7 rounded-full border-transparent"
          aria-label={t("meetings.prevPage")}
          disabled={page === 0}
          onClick={() => onPage(page - 1)}
        >
          <ChevronLeft aria-hidden className="size-4" />
        </Button>
        <span aria-hidden className="px-1 text-caption tabular-nums">
          {page + 1}/{pages}
        </span>
        <Button
          type="button"
          size="icon"
          variant="meetingChip"
          className="size-7 rounded-full border-transparent"
          aria-label={t("meetings.nextPage")}
          disabled={page >= pages - 1}
          onClick={() => onPage(page + 1)}
        >
          <ChevronRight aria-hidden className="size-4" />
        </Button>
      </div>
    </nav>
  );
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
      <ConferenceStage {...props} guests={guests} />
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
  const [sidebarPinned, setSidebarPinned] = useState(true);
  const [sidebarTab, setSidebarTab] = useState<MeetingSidebarTab>(guestMode ? "chat" : "copilot");
  const [page, setPage] = useState(0);
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
  const speaking = useSpeakingParticipants();
  const viewLayout = useMeetingRoomPreferencesStore((s) => s.viewLayout);
  const maxTiles = useMeetingRoomPreferencesStore((s) => s.maxTiles);
  const hideTilesWithoutVideo = useMeetingRoomPreferencesStore((s) => s.hideTilesWithoutVideo);
  const pinnedIdentity = useMeetingViewSessionStore((s) => s.pinnedIdentity);
  const hiddenIdentities = useMeetingViewSessionStore((s) => s.hiddenIdentities);
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: true },
  );
  const stage = resolveConferenceStage(tracks, {
    layout: viewLayout,
    maxTiles,
    page,
    pinnedIdentity,
    hiddenIdentities,
    hideWithoutVideo: hideTilesWithoutVideo,
    speakingIdentities: speaking.map((p) => p.identity),
  });
  // A page that no longer exists (people left) clamps to the last one.
  if (stage.page !== page) setPage(stage.page);

  const openSidebarTab = (tab: MeetingSidebarTab) => {
    setSidebarTab(tab);
    if (compact) setSidebarSheetOpen(true);
    else setSidebarPinned(true);
  };
  const panelShown = compact ? sidebarSheetOpen : sidebarPinned;
  const copilotActive = copilotPanelShown({
    tab: sidebarTab,
    compact,
    sheetOpen: sidebarSheetOpen,
    pinned: sidebarPinned,
  });
  const toggleCopilot = () => {
    if (!copilotActive) {
      openSidebarTab("copilot");
      return;
    }
    if (compact) setSidebarSheetOpen(false);
    else setSidebarPinned(false);
  };
  const chatVisible = sidebarTab === "chat" && panelShown;
  const chatUnread = useMeetingChatUnread(resolvedMeetingId || undefined, chatVisible);

  const tile = (track: TrackReferenceOrPlaceholder, opts: { compact?: boolean; expanded?: boolean }) => {
    const publication = isTrackReference(track) ? track.publication : undefined;
    return (
      <MeetingParticipantTile
        key={trackTileKey(track)}
        participant={track.participant}
        track={track}
        videoTrack={publication?.track}
        videoOn={Boolean(publication?.track) && !publication?.isMuted}
        compact={opts.compact}
        expanded={opts.expanded}
        canHost={canHost.allowed}
        roleChip={participantRole(track.participant, guests)}
      />
    );
  };

  const sidebar = (
    <MeetingRoomSidebar
      meetingId={resolvedMeetingId || undefined}
      meeting={meeting}
      workspaceId={workspaceId}
      canHost={canHost.allowed}
      guestMode={guestMode}
      tab={sidebarTab}
      onTabChange={setSidebarTab}
      chatUnread={chatUnread.unread}
      className="h-full w-full"
    />
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
              onToggleSidebar={compact ? undefined : () => setSidebarPinned((v) => !v)}
              onOpenSidebar={compact ? () => setSidebarSheetOpen(true) : undefined}
              onOpenPeople={() => openSidebarTab("participants")}
            />
            <div
              ref={stageContentRef}
              className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden px-3 pt-3 pb-2 sm:px-4 sm:pb-2"
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
              <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 overflow-hidden">
                {stage.layoutMode === "sidebar" ? (
                  <div className="flex min-h-0 min-w-0 flex-1 gap-2 sm:gap-3">
                    <div className="min-h-0 min-w-0 flex-1" data-lk-theme="default">
                      {stage.primary.map((track) => tile(track, { expanded: true }))}
                    </div>
                    {stage.thumbnails.length > 0 || stage.overflow > 0 ? (
                      <div className="flex w-24 shrink-0 flex-col gap-2 overflow-y-auto sm:w-28">
                        {stage.thumbnails.map((track) => (
                          <div key={trackTileKey(track)} className="aspect-[4/3] shrink-0">
                            {tile(track, { compact: true })}
                          </div>
                        ))}
                        {stage.overflow > 0 ? <OverflowTile count={stage.overflow} /> : null}
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <>
                    <div
                      className={cn("grid min-h-0 min-w-0 flex-1 auto-rows-fr gap-2 sm:gap-3", stage.gridClass)}
                      data-lk-theme="default"
                      data-testid="meeting-grid"
                    >
                      {stage.primary.map((track) =>
                        tile(track, {
                          expanded: stage.layoutMode === "spotlight" || stage.primary.length === 1,
                        }),
                      )}
                    </div>

                    {stage.thumbnails.length > 0 || stage.overflow > 0 ? (
                      <div className="flex shrink-0 items-center gap-2 overflow-x-auto pb-1">
                        {stage.thumbnails.map((track) => (
                          <div key={trackTileKey(track)} className="w-24 shrink-0 sm:w-28">
                            {tile(track, { compact: true })}
                          </div>
                        ))}
                        {stage.overflow > 0 ? <OverflowTile count={stage.overflow} className="w-24 sm:w-28" /> : null}
                      </div>
                    ) : null}
                  </>
                )}
                {stage.pages > 1 ? <StagePager page={stage.page} pages={stage.pages} onPage={setPage} /> : null}
              </div>
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
              className="absolute left-1/2 z-10 -translate-x-1/2 cursor-pointer rounded-lg bg-brand px-3 py-2 text-body text-brand-foreground"
              style={{ bottom: footerReserve + 16 }}
            />
          </div>

          <MeetingStageFooter
            stageContentRef={stageContentRef}
            captionsOn={captionsOn}
            captions={
              <MeetingLiveCaptions
                meetingId={resolvedMeetingId}
                enabled={captionsOn && !!resolvedMeetingId && caps?.server_stt !== true}
                onError={handleCaptionsError}
              />
            }
            onReserveHeightChange={handleFooterReserveChange}
            controlBar={
              <MeetingControlBar
                onLeave={onLeave}
                meetingId={resolvedMeetingId || undefined}
                canHost={canHost.allowed}
                recordingEnabled={caps?.recording === true}
                recording={recording}
                captionsAvailable={caps?.server_stt !== true && captionsSupported()}
                captionsOn={captionsOn}
                onToggleCaptions={() => {
                  setCaptionsError(null);
                  setCaptionsOn((v) => !v);
                }}
                onToggleCopilot={toggleCopilot}
                copilotActive={copilotActive}
              />
            }
          />
        </div>

        {!compact ? (
          <MeetingSidebarDock
            open={sidebarPinned}
            className="min-h-0 w-[22rem] shrink-0 overflow-hidden rounded-2xl bg-surface ring-1 ring-surface-border xl:w-[24rem]"
          >
            {sidebar}
          </MeetingSidebarDock>
        ) : null}
      </div>

      <MeetingCameraBackgroundSync />

      {compact ? (
        <Sheet open={sidebarSheetOpen} onOpenChange={setSidebarSheetOpen}>
          <SheetContent side="right" className="w-[min(100%,22rem)] p-0" showCloseButton>
            <SheetHeader className="sr-only">
              <SheetTitle>{t("meetings.roomPanel")}</SheetTitle>
            </SheetHeader>
            {sidebarSheetOpen ? sidebar : null}
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
