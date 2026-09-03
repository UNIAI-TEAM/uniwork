"use client";
import { useState } from "react";
import {
  ConnectionStateToast,
  RoomAudioRenderer,
  StartMediaButton,
  useTracks,
  type TrackReferenceOrPlaceholder,
} from "@livekit/components-react";
import { Track } from "livekit-client";
import { useTranslation } from "react-i18next";
import type { Meeting } from "@uniwork/core/types";
import { useMeetingPermissions } from "@uniwork/core/permissions";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@uniwork/ui/components/ui/sheet";
import { useIsCompact } from "@uniwork/ui/hooks/use-mobile";
import { cn } from "@uniwork/ui/lib/utils";
import { MeetingControlBar } from "./meeting-control-bar";
import { MeetingCameraBackgroundSync } from "./meeting-camera-background-sync";
import { MeetingParticipantTile } from "./meeting-participant-tile";
import { MeetingRoomHeader } from "./meeting-room-header";
import { MeetingRoomSidebar } from "./meeting-room-sidebar";

/** CSS grid columns for the conference stage. Keep tiles inside the shell. */
export function tileGridClass(count: number): string {
  if (count <= 1) return "grid-cols-1";
  if (count === 2) return "grid-cols-1 sm:grid-cols-2";
  if (count <= 4) return "grid-cols-2";
  return "grid-cols-2 lg:grid-cols-3";
}

function trackTileKey(track: TrackReferenceOrPlaceholder): string {
  return `${track.participant.identity}:${String(track.source)}`;
}

/**
 * Conference stage that does not use LiveKit GridLayout/CarouselLayout.
 * Those layouts call `updatePages`, which throws when a camera placeholder is
 * replaced by a published track (known LiveKit bug).
 */
export function MeetingConference({
  meeting,
  meetingTitle,
  workspaceId,
  onLeave,
}: {
  meeting?: Meeting;
  meetingTitle?: string;
  workspaceId?: string;
  onLeave: () => void;
}) {
  const { t } = useTranslation();
  const compact = useIsCompact();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { canHost } = useMeetingPermissions(meeting ?? null, workspaceId ?? "");
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: true },
  );

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-app-shell">
      <MeetingRoomHeader
        meeting={meeting}
        meetingTitle={meetingTitle}
        workspaceId={workspaceId}
        onLeave={onLeave}
        onOpenSidebar={compact ? () => setSidebarOpen(true) : undefined}
      />
      <div className="flex min-h-0 min-w-0 flex-1 gap-3 px-3 pb-3">
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-2xl bg-rail ring-1 ring-surface-border">
          <div
            className={cn(
              "grid min-h-0 min-w-0 flex-1 auto-rows-fr gap-3 overflow-hidden p-3 sm:p-4",
              tileGridClass(tracks.length),
            )}
            data-lk-theme="default"
          >
            {tracks.map((track) => (
              <MeetingParticipantTile
                key={trackTileKey(track)}
                participant={track.participant}
                track={track}
                expanded={tracks.length === 1}
              />
            ))}
          </div>
          <StartMediaButton
            label={t("meetings.allowMedia")}
            className="absolute bottom-4 left-1/2 z-10 -translate-x-1/2 cursor-pointer rounded-lg bg-brand px-3 py-2 text-body text-brand-foreground"
          />
        </div>
        {!compact ? (
          <div className="hidden min-h-0 w-[20rem] shrink-0 overflow-hidden rounded-2xl bg-surface ring-1 ring-surface-border lg:flex">
            <MeetingRoomSidebar meetingId={meeting?.id} canHost={canHost.allowed} className="h-full w-full" />
          </div>
        ) : null}
      </div>
      <MeetingControlBar onLeave={onLeave} />
      <MeetingCameraBackgroundSync />
      {compact ? (
        <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
          <SheetContent side="right" className="w-[min(100%,20rem)] p-0" showCloseButton>
            <SheetHeader className="sr-only">
              <SheetTitle>{t("meetings.participants")}</SheetTitle>
            </SheetHeader>
            {sidebarOpen ? (
              <MeetingRoomSidebar meetingId={meeting?.id} canHost={canHost.allowed} className="h-full w-full" />
            ) : null}
          </SheetContent>
        </Sheet>
      ) : null}
      <RoomAudioRenderer />
      <ConnectionStateToast />
    </div>
  );
}
