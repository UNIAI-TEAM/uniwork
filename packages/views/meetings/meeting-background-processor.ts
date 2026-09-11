import type { LocalVideoTrack } from "livekit-client";
import type { MeetingBackgroundPreset } from "@uniwork/core/meetings/room-preferences";
import {
  MEETING_BACKGROUND_BLUR_RADIUS,
  resolveMeetingBackgroundImagePath,
} from "./meeting-background";

type Processors = typeof import("@livekit/track-processors");
type BackgroundProcessorPipeline = ReturnType<Processors["BackgroundBlur"]>;

// `@livekit/track-processors` carries the MediaPipe segmenter (~47 KB gzip).
// Only a viewer who turns a background on pays for it; the room route itself
// stays free of it (scripts/bundle-budget.mjs holds the ceiling).
let processorsPromise: Promise<Processors> | null = null;
function loadProcessors(): Promise<Processors> {
  processorsPromise ??= import("@livekit/track-processors");
  return processorsPromise;
}

/** Whether this browser can run background effects at all. Loads the library. */
export async function supportsBackgroundProcessors(): Promise<boolean> {
  const lib = await loadProcessors();
  return lib.supportsBackgroundProcessors();
}

export async function createMeetingBackgroundProcessor(
  background: MeetingBackgroundPreset,
  customBackgroundDataUrl: string | null,
): Promise<BackgroundProcessorPipeline | null> {
  if (background === "blur") {
    const { BackgroundBlur } = await loadProcessors();
    return BackgroundBlur(MEETING_BACKGROUND_BLUR_RADIUS);
  }
  const imagePath = resolveMeetingBackgroundImagePath(background, customBackgroundDataUrl);
  if (imagePath) {
    const { VirtualBackground } = await loadProcessors();
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
  const next = await createMeetingBackgroundProcessor(background, customBackgroundDataUrl);
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
