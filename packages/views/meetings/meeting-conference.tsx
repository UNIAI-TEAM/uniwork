"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  RoomAudioRenderer,
  StartMediaButton,
  useConnectionState,
  useSpeakingParticipants,
  useTracks,
} from "@livekit/components-react";
import { ConnectionState, Track } from "livekit-client";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Meeting } from "@uniwork/core/types";
import { useMeetingCapabilities, useRecordings } from "@uniwork/core/meetings";
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
import {
  resolveConferenceStage,
  trackTileKey,
} from "./conference-layout";
import {
  captionsSupported,
  useLiveCaptions,
} from "./meeting-captions";
import { MeetingControlBar } from "./meeting-control-bar";
import { MeetingStageFooter } from "./meeting-stage-footer";
import { MeetingCameraBackgroundSync } from "./meeting-camera-background-sync";
import { MeetingParticipantTile } from "./meeting-participant-tile";
import { MeetingStageHeader } from "./meeting-stage-header";
import { MeetingRoomSidebar, type MeetingSidebarTab } from "./meeting-room-sidebar";
import { MeetingScheduleBanner } from "./meeting-schedule-banner";
import { MeetingSignalsProvider } from "./use-meeting-signals";

export { tileGridClass, primaryGridClass } from "./conference-layout";

const CONNECTION_TOAST_ID = "meeting-connection";

function ConnectionNotice() {
  const { t } = useTranslation();
  const state = useConnectionState();
  useEffect(() => {
    if (state === ConnectionState.Reconnecting) {
      toast.loading(t("meetings.reconnecting"), { id: CONNECTION_TOAST_ID });
    } else {
      toast.dismiss(CONNECTION_TOAST_ID);
    }
  }, [state, t]);
  useEffect(
    () => () => {
      toast.dismiss(CONNECTION_TOAST_ID);
    },
    [],
  );
  return null;
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
}) {
  return (
    <MeetingSignalsProvider>
      <ConferenceStage {...props} />
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
  onLeave,
}: {
  meetingId?: string;
  meeting?: Meeting;
  meetingTitle?: string;
  workspaceId?: string;
  meetingsHref?: string;
  workspaceLabel?: string;
  guestMode?: boolean;
  onLeave: () => void;
}) {
  const { t } = useTranslation();
  const compact = useIsCompact();
  const [sidebarSheetOpen, setSidebarSheetOpen] = useState(false);
  const [sidebarPinned, setSidebarPinned] = useState(true);
  const [sidebarTab, setSidebarTab] = useState<MeetingSidebarTab>(guestMode ? "chat" : "copilot");
  const [page, setPage] = useState(0);
  const [captionsOn, setCaptionsOn] = useState(false);
  const [footerReserve, setFooterReserve] = useState(96);
  const stageContentRef = useRef<HTMLDivElement>(null);
  const handleFooterReserveChange = useCallback((heightPx: number) => {
    setFooterReserve((prev) => (prev === heightPx ? prev : heightPx));
  }, []);
  const resolvedMeetingId = meetingId ?? meeting?.id ?? "";
  const { canHost } = useMeetingPermissions(meeting ?? null, workspaceId ?? "");
  const { data: caps } = useMeetingCapabilities(workspaceId ?? "");
  const { data: recordings } = useRecordings(resolvedMeetingId);
  const recording = (recordings ?? []).some((r) => r.status === "ACTIVE");
  const captions = useLiveCaptions(
    resolvedMeetingId,
    captionsOn && !!resolvedMeetingId && caps?.server_stt !== true,
  );
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

  useEffect(() => {
    if (stage.page !== page) setPage(stage.page);
  }, [stage.page, page]);

  const openJoinRequests = () => {
    setSidebarTab("participants");
    if (compact) {
      setSidebarSheetOpen(true);
    } else {
      setSidebarPinned(true);
    }
  };

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-app-shell">
      <div
        className={cn(
          "flex min-h-0 min-w-0 flex-1 px-3 pb-3 pt-2 motion-safe:transition-[gap] motion-safe:duration-300 motion-safe:ease-out motion-reduce:transition-none",
          !compact && sidebarPinned ? "gap-3" : "gap-0",
        )}
      >
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-2xl bg-rail ring-1 ring-surface-border transition-[flex-grow,width] duration-300 ease-out motion-reduce:transition-none">
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
            onOpenPeople={openJoinRequests}
          />
          <div
            ref={stageContentRef}
            className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden px-3 pt-2 pb-2 sm:px-4 sm:pt-3 sm:pb-2"
            data-testid="meeting-stage-content"
          >
            <MeetingScheduleBanner endsAt={meeting?.ends_at} />
            <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 overflow-hidden">
            {stage.layoutMode === "sidebar" ? (
              <div className="flex min-h-0 min-w-0 flex-1 gap-2 sm:gap-3">
                <div className="min-h-0 min-w-0 flex-1" data-lk-theme="default">
                  {stage.primary.map((track) => (
                    <MeetingParticipantTile
                      key={trackTileKey(track)}
                      participant={track.participant}
                      track={track}
                      expanded
                      canHost={canHost.allowed}
                    />
                  ))}
                </div>
                {stage.thumbnails.length > 0 || stage.overflow > 0 ? (
                  <div className="flex w-24 shrink-0 flex-col gap-2 overflow-y-auto sm:w-28">
                    {stage.thumbnails.map((track) => (
                      <div key={trackTileKey(track)} className="aspect-[4/3] shrink-0">
                        <MeetingParticipantTile
                          participant={track.participant}
                          track={track}
                          compact
                          canHost={canHost.allowed}
                        />
                      </div>
                    ))}
                    {stage.overflow > 0 ? (
                      <div
                        className="flex aspect-[4/3] shrink-0 items-center justify-center rounded-xl bg-muted text-caption font-medium text-muted-foreground ring-1 ring-surface-border"
                        aria-label={t("meetings.moreParticipants", { count: stage.overflow })}
                      >
                        {t("meetings.moreParticipantsShort", { count: stage.overflow })}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : (
              <>
                <div
                  className={cn(
                    "grid min-h-0 min-w-0 flex-1 auto-rows-fr gap-2 motion-safe:transition-[grid-template-columns,gap] motion-safe:duration-300 motion-safe:ease-out motion-reduce:transition-none sm:gap-3",
                    stage.gridClass,
                  )}
                  data-lk-theme="default"
                  data-testid="meeting-grid"
                >
                  {stage.primary.map((track) => (
                    <MeetingParticipantTile
                      key={trackTileKey(track)}
                      participant={track.participant}
                      track={track}
                      expanded={stage.layoutMode === "spotlight" || stage.primary.length === 1}
                      canHost={canHost.allowed}
                    />
                  ))}
                </div>

                {stage.thumbnails.length > 0 || stage.overflow > 0 ? (
                  <div className="flex shrink-0 items-center gap-2 overflow-x-auto pb-1">
                    {stage.thumbnails.map((track) => (
                      <div key={trackTileKey(track)} className="w-24 shrink-0 sm:w-28">
                        <MeetingParticipantTile
                          participant={track.participant}
                          track={track}
                          compact
                          canHost={canHost.allowed}
                        />
                      </div>
                    ))}
                    {stage.overflow > 0 ? (
                      <div
                        className="flex aspect-[4/3] w-24 shrink-0 items-center justify-center rounded-xl bg-muted text-caption font-medium text-muted-foreground ring-1 ring-surface-border sm:w-28"
                        aria-label={t("meetings.moreParticipants", { count: stage.overflow })}
                      >
                        {t("meetings.moreParticipantsShort", { count: stage.overflow })}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </>
            )}
            </div>
            <div
              aria-hidden
              className="shrink-0 motion-safe:transition-[height] motion-safe:duration-[280ms] motion-safe:ease-out motion-reduce:transition-none"
              style={{ height: footerReserve }}
              data-testid="meeting-stage-footer-spacer"
            />
          </div>

          {stage.pages > 1 ? (
            <div className="absolute top-3 right-3 z-10 flex items-center gap-1 rounded-full bg-background/80 p-1 ring-1 ring-border">
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="size-7 rounded-full"
                aria-label={t("meetings.prevPage")}
                disabled={stage.page === 0}
                onClick={() => setPage((p) => p - 1)}
              >
                <ChevronLeft aria-hidden className="size-4" />
              </Button>
              <span className="px-1 text-caption tabular-nums text-foreground">
                {stage.page + 1}/{stage.pages}
              </span>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="size-7 rounded-full"
                aria-label={t("meetings.nextPage")}
                disabled={stage.page >= stage.pages - 1}
                onClick={() => setPage((p) => p + 1)}
              >
                <ChevronRight aria-hidden className="size-4" />
              </Button>
            </div>
          ) : null}


          <StartMediaButton
            label={t("meetings.allowMedia")}
            className="absolute left-1/2 z-10 -translate-x-1/2 cursor-pointer rounded-lg bg-brand px-3 py-2 text-body text-brand-foreground motion-safe:transition-[bottom] motion-safe:duration-[250ms] motion-safe:ease-out motion-reduce:transition-none"
            style={{ bottom: footerReserve + 16 }}
          />
          </div>

          <MeetingStageFooter
            stageContentRef={stageContentRef}
            captionsOn={captionsOn}
            captionsInterim={captions.interim}
            captionsLastFinal={captions.lastFinal}
            onReserveHeightChange={handleFooterReserveChange}
            controlBar={
              <MeetingControlBar
                embedded
                onLeave={onLeave}
                meetingId={resolvedMeetingId || undefined}
                canHost={canHost.allowed}
                recordingEnabled={caps?.recording === true}
                recording={recording}
                captionsAvailable={caps?.server_stt !== true && captionsSupported()}
                captionsOn={captionsOn}
                onToggleCaptions={() => setCaptionsOn((v) => !v)}
                onOpenCopilot={() => {
                  setSidebarTab("copilot");
                  if (compact) setSidebarSheetOpen(true);
                  else setSidebarPinned(true);
                }}
                copilotActive={sidebarTab === "copilot" && (sidebarPinned || sidebarSheetOpen)}
              />
            }
          />
        </div>

        {!compact ? (
          <div
            className={cn(
              "hidden min-h-0 shrink-0 overflow-hidden rounded-2xl bg-surface ring-1 ring-surface-border motion-safe:transition-[width,opacity] motion-safe:duration-300 motion-safe:ease-out motion-reduce:transition-none lg:flex",
              sidebarPinned ? "w-[22rem] opacity-100 xl:w-[24rem]" : "pointer-events-none w-0 opacity-0 ring-transparent",
            )}
            aria-hidden={!sidebarPinned}
          >
            <div className="h-full w-[22rem] shrink-0 xl:w-[24rem]">
              <MeetingRoomSidebar
                meetingId={resolvedMeetingId || undefined}
                meeting={meeting}
                workspaceId={workspaceId}
                canHost={canHost.allowed}
                guestMode={guestMode}
                tab={sidebarTab}
                onTabChange={setSidebarTab}
                className="h-full w-full"
              />
            </div>
          </div>
        ) : null}
      </div>

      <MeetingCameraBackgroundSync />

      {compact ? (
        <Sheet open={sidebarSheetOpen} onOpenChange={setSidebarSheetOpen}>
          <SheetContent side="right" className="w-[min(100%,22rem)] p-0" showCloseButton>
            <SheetHeader className="sr-only">
              <SheetTitle>{t("meetings.openSidebar")}</SheetTitle>
            </SheetHeader>
            {sidebarSheetOpen ? (
              <MeetingRoomSidebar
                meetingId={resolvedMeetingId || undefined}
                meeting={meeting}
                workspaceId={workspaceId}
                canHost={canHost.allowed}
                guestMode={guestMode}
                tab={sidebarTab}
                onTabChange={setSidebarTab}
                className="h-full w-full"
              />
            ) : null}
          </SheetContent>
        </Sheet>
      ) : null}

      <RoomAudioRenderer />
      <ConnectionNotice />
    </div>
  );
}
