"use client";
import { useEffect } from "react";
import { useLocalParticipant, useRoomContext } from "@livekit/components-react";
import { ConnectionState, RoomEvent, Track, type TrackPublication } from "livekit-client";
import { MonitorUp } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@uniwork/ui/components/ui/button";
import { markScreenShareStopByUser, takeScreenShareStopByUser } from "./screen-share";

/**
 * Announces a screen share that ended without the viewer asking: the
 * browser's own "Stop sharing" bar, the OS taking the capture away, or a
 * dropped connection. A share lost with the connection is only announced once
 * the room is back, so leaving the call says nothing.
 */
export function MeetingScreenShareWatcher() {
  const { t } = useTranslation();
  const room = useRoomContext();

  useEffect(() => {
    let lostWithConnection = false;
    let pending: ReturnType<typeof setTimeout> | undefined;
    const onUnpublished = (publication: TrackPublication) => {
      if (publication.source !== Track.Source.ScreenShare) return;
      if (takeScreenShareStopByUser(room)) return;
      // Leaving (or being ended by the host) unpublishes every track while the
      // room still reads Connected, and only then turns Disconnected — so the
      // cause is read once that synchronous teardown has run.
      clearTimeout(pending);
      pending = setTimeout(() => {
        if (room.state === ConnectionState.Connected) toast.info(t("meetings.shareStopped"));
        else lostWithConnection = true;
      }, 0);
    };
    const onConnected = () => {
      if (!lostWithConnection) return;
      lostWithConnection = false;
      toast.warning(t("meetings.shareStoppedByConnection"));
    };
    // LiveKit's own reconnect republishes the share: nothing was lost.
    const onReconnected = () => {
      lostWithConnection = false;
    };
    room.on(RoomEvent.LocalTrackUnpublished, onUnpublished);
    room.on(RoomEvent.Connected, onConnected);
    room.on(RoomEvent.Reconnected, onReconnected);
    return () => {
      clearTimeout(pending);
      room.off(RoomEvent.LocalTrackUnpublished, onUnpublished);
      room.off(RoomEvent.Connected, onConnected);
      room.off(RoomEvent.Reconnected, onReconnected);
    };
  }, [room, t]);

  return null;
}

/**
 * Stands in for the presenter's own screen share. Drawing it would show the
 * screen inside itself (and decode the stream just sent); the room sees the
 * real share, the presenter sees what is going on and how to end it.
 */
export function MeetingPresentingCard({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation();
  const room = useRoomContext();
  const { localParticipant } = useLocalParticipant();
  const stop = () => {
    markScreenShareStopByUser(room);
    localParticipant.setScreenShareEnabled(false).catch(() => {
      takeScreenShareStopByUser(room);
      toast.error(t("common.error"));
    });
  };

  if (compact) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1 bg-meeting-video-bg p-2 text-center">
        <MonitorUp aria-hidden className="size-5 text-brand" />
        <span className="text-caption text-meeting-bar-foreground">{t("meetings.presentingShort")}</span>
      </div>
    );
  }

  return (
    <div
      className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 bg-meeting-video-bg p-6 text-center"
      data-testid="meeting-presenting-card"
    >
      <span className="flex size-12 items-center justify-center rounded-2xl bg-brand-subtle text-brand-subtle-foreground">
        <MonitorUp aria-hidden className="size-6" />
      </span>
      <div className="max-w-sm space-y-1">
        <p className="text-title-sm font-semibold text-meeting-bar-foreground">{t("meetings.presentingTitle")}</p>
        <p className="text-body text-meeting-bar-muted-foreground">{t("meetings.presentingHint")}</p>
      </div>
      <Button type="button" variant="destructiveSolid" onClick={stop}>
        {t("meetings.presentingStop")}
      </Button>
    </div>
  );
}
