import {
  BackgroundBlur,
  VirtualBackground,
  supportsBackgroundProcessors,
} from "@livekit/track-processors";
import type { LocalVideoTrack } from "livekit-client";
import type { MeetingBackgroundPreset } from "@uniwork/core/meetings/room-preferences";
import {
  MEETING_BACKGROUND_BLUR_RADIUS,
  resolveMeetingBackgroundImagePath,
} from "./meeting-background";

export { supportsBackgroundProcessors };

type BackgroundProcessorPipeline = ReturnType<typeof BackgroundBlur>;

export function createMeetingBackgroundProcessor(
  background: MeetingBackgroundPreset,
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

export async function applyMeetingBackgroundProcessor(
  track: LocalVideoTrack,
  processorRef: { current: BackgroundProcessorPipeline | null },
  background: MeetingBackgroundPreset,
  customBackgroundDataUrl: string | null,
) {
  const next = createMeetingBackgroundProcessor(background, customBackgroundDataUrl);
  if (!next) {
    await track.stopProcessor().catch(() => undefined);
    processorRef.current = null;
    return;
  }

  if (processorRef.current) {
    await track.stopProcessor().catch(() => undefined);
  }
  processorRef.current = next;
  await track.setProcessor(next);
}

export function meetingBackgroundActive(
  background: MeetingBackgroundPreset,
): background is Exclude<MeetingBackgroundPreset, "none"> {
  return background !== "none";
}
