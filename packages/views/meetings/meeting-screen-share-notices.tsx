"use client";
import { useEffect } from "react";
import { useLocalParticipant, useRoomContext } from "@livekit/components-react";
import { ConnectionState, RoomEvent, Track, type TrackPublication } from "livekit-client";
import { Eye, EyeOff, MonitorUp } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { SHARE_NOTICE_TOAST, shareLockedNow } from "./meeting-moderation";
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
      // The host's share lock says so itself (useOwnShareLock).
      if (shareLockedNow(room.localParticipant)) return;
      // Leaving (or being ended by the host) unpublishes every track while the
      // room still reads Connected, and only then turns Disconnected — so the
      // cause is read once that synchronous teardown has run.
      clearTimeout(pending);
      pending = setTimeout(() => {
        // The lock may land after the stop: checked again, and sharing the
        // lock notice's id, so a later lock notice replaces this one.
        if (shareLockedNow(room.localParticipant)) return;
        if (room.state === ConnectionState.Connected) toast.info(t("meetings.shareStopped"), { id: SHARE_NOTICE_TOAST });
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

/** Ends the presenter's own share, marked as theirs so it is not announced. */
function useStopPresenting() {
  const { t } = useTranslation();
  const room = useRoomContext();
  const { localParticipant } = useLocalParticipant();
  return () => {
    markScreenShareStopByUser(room);
    localParticipant.setScreenShareEnabled(false).catch(() => {
      takeScreenShareStopByUser(room);
      toast.error(t("common.error"));
    });
  };
}

/**
 * Stands in for the presenter's own share of a whole screen. Drawing it would
 * show the screen inside itself (and decode the stream just sent); the room
 * sees the real share, the presenter sees what is going on and how to end it.
 * A shared tab or window is drawn instead, under MeetingPresentingBar, unless
 * the presenter put that preview away (`onShowPreview` brings it back). A
 * window starts here, warned that it may hold the meeting (see ownSharePreview).
 */
export function MeetingPresentingCard({
  compact = false,
  onShowPreview,
  windowShare = false,
}: {
  compact?: boolean;
  onShowPreview?: () => void;
  windowShare?: boolean;
}) {
  const { t } = useTranslation();
  const stop = useStopPresenting();

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
        <p className="text-pretty text-body text-meeting-bar-muted-foreground">
          {windowShare
            ? t("meetings.presentingWindowHint")
            : onShowPreview
              ? t("meetings.presentingPreviewHiddenHint")
              : t("meetings.presentingHint")}
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        {onShowPreview ? (
          <Button type="button" variant="meetingChip" onClick={onShowPreview}>
            <Eye aria-hidden />
            {t("meetings.presentingShowPreview")}
          </Button>
        ) : null}
        <Button type="button" variant="destructiveSolid" onClick={stop}>
          {t("meetings.presentingStop")}
        </Button>
      </div>
    </div>
  );
}

/**
 * Sits on the presenter's preview of a shared tab or window, in the corner the
 * name chip would take: the picture says what the room sees, the bar says it
 * is live and how to end it, and it leaves the top of the shared page — where
 * titles live — uncovered.
 */
export function MeetingPresentingBar({
  compact = false,
  onHidePreview,
}: {
  compact?: boolean;
  onHidePreview: () => void;
}) {
  const { t } = useTranslation();
  const stop = useStopPresenting();
  return (
    <div
      className={cn(
        "absolute z-10 flex items-center gap-1.5 rounded-full bg-meeting-bar-bg text-meeting-bar-foreground ring-1 ring-meeting-bar-border",
        compact
          ? "bottom-1.5 left-1.5 max-w-[calc(100%-0.75rem)] px-2 py-0.5"
          : "bottom-2 left-2 max-w-[calc(100%-1rem)] py-1 pr-1 pl-3 sm:bottom-3 sm:left-3",
      )}
      data-testid="meeting-presenting-bar"
    >
      <MonitorUp aria-hidden className={cn("shrink-0 text-brand", compact ? "size-3.5" : "size-4")} />
      <span className={cn("min-w-0 truncate", compact ? "text-caption" : "text-label")}>
        {t("meetings.presentingShort")}
      </span>
      {compact ? null : (
        <>
          <Button
            type="button"
            size="icon-sm"
            variant="meetingChip"
            className="size-8 shrink-0 rounded-full border-transparent"
            aria-label={t("meetings.presentingHidePreview")}
            title={t("meetings.presentingHidePreview")}
            onClick={onHidePreview}
          >
            <EyeOff aria-hidden />
          </Button>
          <Button type="button" size="sm" variant="destructiveSolid" className="shrink-0 rounded-full" onClick={stop}>
            {t("meetings.presentingStop")}
          </Button>
        </>
      )}
    </div>
  );
}
