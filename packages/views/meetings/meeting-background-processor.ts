import type { LocalVideoTrack } from "livekit-client";
import type { MeetingBackgroundPreset } from "@uniwork/core/meetings/room-preferences";
import {
  MEETING_BACKGROUND_BLUR_RADIUS,
  resolveMeetingBackgroundImagePath,
} from "./meeting-background";
import { MainSubjectMask } from "./meeting-background-subject";

type Processors = typeof import("@livekit/track-processors");
type BackgroundProcessorPipeline = ReturnType<Processors["BackgroundBlur"]>;
type BackgroundTransformer = InstanceType<Processors["BackgroundTransformer"]>;
type BackgroundOptions = ConstructorParameters<Processors["BackgroundTransformer"]>[0];

// The MediaPipe MPMask that BackgroundTransformer hands to its private
// `updateMask` once per frame; only the part read here is typed.
type SegmentationMask = { width: number; height: number; getAsUint8Array(): Uint8Array };

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
    return speakerOnlyProcessor(
      await loadProcessors(),
      { blurRadius: MEETING_BACKGROUND_BLUR_RADIUS },
      "background-blur",
    );
  }
  const imagePath = resolveMeetingBackgroundImagePath(background, customBackgroundDataUrl);
  if (imagePath) {
    return speakerOnlyProcessor(await loadProcessors(), { imagePath }, "virtual-background");
  }
  return null;
}

// Same pipeline as the library's BackgroundBlur / VirtualBackground factories,
// with the segmentation mask narrowed to the speaker before it is composited.
function speakerOnlyProcessor(
  lib: Processors,
  options: BackgroundOptions,
  name: string,
): BackgroundProcessorPipeline {
  const transformer = new lib.BackgroundTransformer(options);
  keepSpeakerOnly(transformer);
  return new lib.ProcessorWrapper(transformer, name);
}

/**
 * The selfie segmenter marks everyone in view as a person, so people sitting
 * behind the speaker showed through the background (UNI-842). Replaces the
 * transformer's `updateMask` hook: the mask is read back, filtered by
 * MainSubjectMask and uploaded as the texture the compositor blurs and blends.
 * `updateMask` is private in @livekit/track-processors, so
 * meeting-background-processor.test.ts pins that the hook still exists.
 */
export function keepSpeakerOnly(transformer: BackgroundTransformer) {
  const hooks = transformer as unknown as {
    updateMask?: (mask: SegmentationMask | undefined) => void;
  };
  if (typeof hooks.updateMask !== "function") return;

  const subject = new MainSubjectMask();
  let texture: WebGLTexture | null = null;
  let textureContext: WebGL2RenderingContext | null = null;

  hooks.updateMask = (mask) => {
    const pipeline = transformer.gl;
    const canvas = transformer.canvas as HTMLCanvasElement | OffscreenCanvas | undefined;
    if (!mask || !pipeline || !canvas) return;
    // Returns the context the pipeline and MediaPipe already share.
    const gl = canvas.getContext("webgl2") as WebGL2RenderingContext | null;
    if (!gl) return;

    const filtered = subject.filter(mask.getAsUint8Array(), mask.width, mask.height);
    if (textureContext !== gl) {
      texture = gl.createTexture();
      textureContext = gl;
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    }
    if (!texture) return;

    const alignment = gl.getParameter(gl.UNPACK_ALIGNMENT) as number;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.R8,
      mask.width,
      mask.height,
      0,
      gl.RED,
      gl.UNSIGNED_BYTE,
      filtered,
    );
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, alignment);
    pipeline.updateMask(texture);
  };

  const destroy = transformer.destroy.bind(transformer);
  transformer.destroy = async () => {
    textureContext?.deleteTexture(texture);
    texture = null;
    textureContext = null;
    await destroy();
  };
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
