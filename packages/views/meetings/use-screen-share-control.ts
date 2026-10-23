"use client";
import { useEffect, useRef, useState } from "react";
import { useLocalParticipant, useRoomContext, useTrackToggle } from "@livekit/components-react";
import { ConnectionState, Track, type ScreenShareCaptureOptions } from "livekit-client";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { shareAudioAllowedNow, useOwnShareLock, usePublishPermission } from "./meeting-moderation";
import {
  markScreenShareStopByUser,
  screenShareErrorKey,
  screenShareStopsByUser,
  screenShareSupported,
} from "./screen-share";

// A share that ended this recently was ended by the lock that follows it.
const LOCK_STOP_WINDOW_MS = 3000;

/**
 * What the browser's picker asks for. The meeting's own tab is left out:
 * shared, it would show itself, and a shared tab is what the presenter gets
 * to preview. Audio is asked for (LiveKit asks for none by default) so
 * Chrome offers "Also share tab audio", and for a whole screen "Also share
 * system audio" (Windows, ChromeOS) — unless the host's mic lock has taken
 * shared audio away, as LiveKit would then refuse the share as a whole.
 * System audio carries the meeting's own playback too: restrictOwnAudio
 * takes it out where the browser knows how (Chromium); elsewhere the room
 * may hear itself back while a presenter shares their system's sound.
 */
export function screenShareCaptureOptions(audio: boolean): ScreenShareCaptureOptions {
  return audio
    ? { selfBrowserSurface: "exclude", audio: { restrictOwnAudio: true }, systemAudio: "include" }
    : { selfBrowserSurface: "exclude", audio: false };
}

/**
 * The screen-share toggle with what the plain LiveKit toggle leaves out: it
 * says why a start failed (a closed picker is not a failure), names the next
 * action, marks a stop as the viewer's own so it is not announced, and
 * explains a share the host locked instead of opening the picker.
 */
export function useScreenShareControl() {
  const { t } = useTranslation();
  const room = useRoomContext();
  const { localParticipant } = useLocalParticipant();
  const [supported] = useState(screenShareSupported);
  const audio = usePublishPermission(localParticipant, shareAudioAllowedNow);
  const screen = useTrackToggle({
    source: Track.Source.ScreenShare,
    captureOptions: screenShareCaptureOptions(audio),
    onDeviceError: (error) => {
      const key = screenShareErrorKey(error);
      if (key) toast.error(t(key));
    },
  });
  // 0 while sharing, else when the last share ended (-Infinity: never shared).
  const lastShareEnd = useRef(screen.enabled ? 0 : -Infinity);
  // The room's stop count when the share started: any stop asked for since —
  // from this bar, the presenting card or a takeover — was the viewer's own,
  // so a lock that lands next did not end it.
  const stopsAtStart = useRef(screenShareStopsByUser(room));
  useEffect(() => {
    if (screen.enabled) {
      lastShareEnd.current = 0;
      stopsAtStart.current = screenShareStopsByUser(room);
    } else if (lastShareEnd.current === 0) lastShareEnd.current = Date.now();
  }, [screen.enabled, room]);
  const lock = useOwnShareLock({
    // A full reconnect re-applies the join grants before the room is back:
    // that is no change the host made, so it is not announced.
    announce: supported && room.state === ConnectionState.Connected,
    wasSharing: () =>
      screenShareStopsByUser(room) === stopsAtStart.current &&
      (lastShareEnd.current === 0 || Date.now() - lastShareEnd.current < LOCK_STOP_WINDOW_MS),
  });
  const locked = lock.locked && !screen.enabled;
  return {
    supported,
    enabled: screen.enabled,
    pending: screen.pending,
    locked,
    // The lock is part of the name, as on the mic: a passing toast never
    // reaches a screen reader that lands on the button later.
    label: screen.enabled ? t("meetings.stopShare") : locked ? t("meetings.shareLockedControl") : t("meetings.share"),
    toggle: () => {
      // Locked: say why instead of a picker whose share LiveKit refuses.
      if (locked) return lock.explain();
      if (screen.enabled) markScreenShareStopByUser(room);
      void screen.toggle();
    },
  };
}
