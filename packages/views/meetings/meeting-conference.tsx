"use client";
import { useEffect, useState } from "react";
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
  orderTracks,
  paginate,
  tileGridClass,
  trackTileKey,
} from "./conference-layout";
import {
  captionsSupported,
  MeetingCaptionsOverlay,
  useLiveCaptions,
} from "./meeting-captions";
import { MeetingControlBar } from "./meeting-control-bar";
import { MeetingCameraBackgroundSync } from "./meeting-camera-background-sync";
import { MeetingParticipantTile } from "./meeting-participant-tile";
import { MeetingRoomHeader } from "./meeting-room-header";
import { MeetingRoomSidebar } from "./meeting-room-sidebar";
import { MeetingSignalsProvider } from "./use-meeting-signals";

export { tileGridClass } from "./conference-layout";

const CONNECTION_TOAST_ID = "meeting-connection";

/** Reconnect notice through the app's own toaster, in the app's own language. */
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

/**
 * Conference stage that does not use LiveKit GridLayout/CarouselLayout.
 * Those layouts call `updatePages`, which throws when a camera placeholder is
 * replaced by a published track (known LiveKit bug).
 */
export function MeetingConference(props: {
  meeting?: Meeting;
  workspaceId?: string;
  onLeave: () => void;
}) {
  return (
    <MeetingSignalsProvider>
      <ConferenceStage {...props} />
    </MeetingSignalsProvider>
  );
}

function ConferenceStage({
  meeting,
  workspaceId,
  onLeave,
}: {
  meeting?: Meeting;
  workspaceId?: string;
  onLeave: () => void;
}) {
  const { t } = useTranslation();
  const compact = useIsCompact();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [page, setPage] = useState(0);
  const [captionsOn, setCaptionsOn] = useState(false);
  const { canHost } = useMeetingPermissions(meeting ?? null, workspaceId ?? "");
  const { data: caps } = useMeetingCapabilities(workspaceId ?? "");
  const { data: recordings } = useRecordings(meeting?.id ?? "");
  const recording = (recordings ?? []).some((r) => r.status === "ACTIVE");
  const captions = useLiveCaptions(
    meeting?.id ?? "",
    captionsOn && !!meeting?.id,
  );
  const speaking = useSpeakingParticipants();
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false },
  );
  const ordered = orderTracks(
    tracks,
    speaking.map((p) => p.identity),
  );
  const view = paginate(ordered, page);

  useEffect(() => {
    if (view.page !== page) setPage(view.page);
  }, [view.page, page]);

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-app-shell">
      <MeetingRoomHeader
        meeting={meeting}
        workspaceId={workspaceId}
        onLeave={onLeave}
        onOpenSidebar={compact ? () => setSidebarOpen(true) : undefined}
        recording={recording}
      />
      <div className="flex min-h-0 min-w-0 flex-1 gap-3 px-3 pb-3">
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-2xl bg-rail ring-1 ring-surface-border">
          <div
            className={cn(
              "grid min-h-0 min-w-0 flex-1 auto-rows-fr gap-3 overflow-hidden p-3 sm:p-4",
              tileGridClass(view.items.length),
            )}
            data-lk-theme="default"
            data-testid="meeting-grid"
          >
            {view.items.map((track) => (
              <MeetingParticipantTile
                key={trackTileKey(track)}
                participant={track.participant}
                track={track}
                expanded={view.items.length === 1}
              />
            ))}
          </div>
          {view.pages > 1 ? (
            <div className="absolute top-3 right-3 z-10 flex items-center gap-1 rounded-full bg-background/80 p-1 ring-1 ring-border">
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="size-7 rounded-full"
                aria-label={t("meetings.prevPage")}
                disabled={view.page === 0}
                onClick={() => setPage((p) => p - 1)}
              >
                <ChevronLeft aria-hidden className="size-4" />
              </Button>
              <span className="px-1 text-caption tabular-nums text-foreground">
                {view.page + 1}/{view.pages}
              </span>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="size-7 rounded-full"
                aria-label={t("meetings.nextPage")}
                disabled={view.page >= view.pages - 1}
                onClick={() => setPage((p) => p + 1)}
              >
                <ChevronRight aria-hidden className="size-4" />
              </Button>
            </div>
          ) : null}
          {captionsOn ? (
            <MeetingCaptionsOverlay
              interim={captions.interim}
              lastFinal={captions.lastFinal}
            />
          ) : null}
          <StartMediaButton
            label={t("meetings.allowMedia")}
            className="absolute bottom-4 left-1/2 z-10 -translate-x-1/2 rounded-lg bg-brand px-3 py-2 text-body text-brand-foreground"
          />
        </div>
        {!compact ? (
          <div className="hidden min-h-0 w-[20rem] shrink-0 overflow-hidden rounded-2xl bg-surface ring-1 ring-surface-border lg:flex">
            <MeetingRoomSidebar
              meetingId={meeting?.id}
              canHost={canHost.allowed}
              className="h-full w-full"
            />
          </div>
        ) : null}
      </div>
      <MeetingControlBar
        onLeave={onLeave}
        meetingId={meeting?.id}
        canHost={canHost.allowed}
        recordingEnabled={caps?.recording === true}
        recording={recording}
        captionsAvailable={captionsSupported()}
        captionsOn={captionsOn}
        onToggleCaptions={() => setCaptionsOn((v) => !v)}
      />
      <MeetingCameraBackgroundSync />
      {compact ? (
        <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
          <SheetContent
            side="right"
            className="w-[min(100%,20rem)] p-0"
            showCloseButton
          >
            <SheetHeader className="sr-only">
              <SheetTitle>{t("meetings.openSidebar")}</SheetTitle>
            </SheetHeader>
            {sidebarOpen ? (
              <MeetingRoomSidebar
                meetingId={meeting?.id}
                canHost={canHost.allowed}
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
