"use client";

import { useEffect, useRef } from "react";
import { useRoomContext } from "@livekit/components-react";
import { RoomEvent, Track } from "livekit-client";
import { useMeetingRoomPreferencesStore } from "@uniwork/core/meetings/room-preferences";
import {
  applyMeetingBackgroundProcessor,
  meetingBackgroundActive,
  supportsBackgroundProcessors,
} from "./meeting-background-processor";

/** Keeps the local camera track background effect in sync with room preferences. */
export function MeetingCameraBackgroundSync() {
  const room = useRoomContext();
  const background = useMeetingRoomPreferencesStore((s) => s.background);
  const customBackgroundDataUrl = useMeetingRoomPreferencesStore((s) => s.customBackgroundDataUrl);
  const processorRef = useRef<ReturnType<typeof import("@livekit/track-processors").BackgroundBlur> | null>(
    null,
  );

  useEffect(() => {
    const applyToCamera = async () => {
      // The library (and its support check) is only fetched once a background
      // is wanted; "none" just stops whatever processor may be running.
      if (meetingBackgroundActive(background) && !(await supportsBackgroundProcessors())) return;
      const pub = room.localParticipant.getTrackPublication(Track.Source.Camera);
      const track = pub?.videoTrack;
      if (!track) return;
      await applyMeetingBackgroundProcessor(
        track,
        processorRef,
        background,
        customBackgroundDataUrl,
      );
    };

    const onTrackChange = () => void applyToCamera().catch(() => undefined);
    void onTrackChange();
    room.on(RoomEvent.LocalTrackPublished, onTrackChange);
    room.on(RoomEvent.LocalTrackUnpublished, onTrackChange);

    return () => {
      room.off(RoomEvent.LocalTrackPublished, onTrackChange);
      room.off(RoomEvent.LocalTrackUnpublished, onTrackChange);
    };
  }, [room, background, customBackgroundDataUrl]);

  return null;
}
