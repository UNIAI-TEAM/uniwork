"use client";

import { useEffect, useRef } from "react";
import { useRoomContext } from "@livekit/components-react";
import {
  BackgroundBlur,
  VirtualBackground,
  supportsBackgroundProcessors,
} from "@livekit/track-processors";
import { RoomEvent, Track, type LocalVideoTrack } from "livekit-client";
import { useMeetingRoomPreferencesStore } from "@uniwork/core/meetings/room-preferences";
import {
  MEETING_BACKGROUND_BLUR_RADIUS,
  resolveMeetingBackgroundImagePath,
} from "./meeting-background";

type BackgroundProcessorPipeline = ReturnType<typeof BackgroundBlur>;

function createBackgroundProcessor(
  background: ReturnType<typeof useMeetingRoomPreferencesStore.getState>["background"],
  customBackgroundDataUrl: string | null,
): BackgroundProcessorPipeline | null {
  if (background === "blur") {
    return BackgroundBlur(MEETING_BACKGROUND_BLUR_RADIUS);
  }
  const imagePath = resolveMeetingBackgroundImagePath(background, customBackgroundDataUrl);
  if (imagePath) {
    return VirtualBackground(imagePath);
  }
  return null;
}

async function syncBackgroundProcessor(
  track: LocalVideoTrack,
  processorRef: { current: BackgroundProcessorPipeline | null },
  background: ReturnType<typeof useMeetingRoomPreferencesStore.getState>["background"],
  customBackgroundDataUrl: string | null,
) {
  const next = createBackgroundProcessor(background, customBackgroundDataUrl);
  if (!next) {
    await track.stopProcessor();
    processorRef.current = null;
    return;
  }

  await track.stopProcessor().catch(() => undefined);
  processorRef.current = next;
  await track.setProcessor(next);
}

/** Keeps the local camera track background effect in sync with room preferences. */
export function MeetingCameraBackgroundSync() {
  const room = useRoomContext();
  const background = useMeetingRoomPreferencesStore((s) => s.background);
  const customBackgroundDataUrl = useMeetingRoomPreferencesStore((s) => s.customBackgroundDataUrl);
  const processorRef = useRef<BackgroundProcessorPipeline | null>(null);

  useEffect(() => {
    if (!supportsBackgroundProcessors()) return;

    const applyToCamera = async () => {
      const pub = room.localParticipant.getTrackPublication(Track.Source.Camera);
      const track = pub?.videoTrack;
      if (!track) return;
      await syncBackgroundProcessor(track, processorRef, background, customBackgroundDataUrl);
    };

    void applyToCamera();
    room.on(RoomEvent.LocalTrackPublished, applyToCamera);
    room.on(RoomEvent.LocalTrackUnpublished, applyToCamera);

    return () => {
      room.off(RoomEvent.LocalTrackPublished, applyToCamera);
      room.off(RoomEvent.LocalTrackUnpublished, applyToCamera);
    };
  }, [room, background, customBackgroundDataUrl]);

  return null;
}
