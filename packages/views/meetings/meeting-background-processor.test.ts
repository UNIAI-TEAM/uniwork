import { describe, expect, it, vi } from "vitest";
import type { LocalVideoTrack } from "livekit-client";

vi.mock("@livekit/track-processors", () => {
  class BackgroundTransformer {
    constructor(public options: Record<string, unknown>) {}
    destroy() {
      return Promise.resolve();
    }
    updateMask() {}
  }
  class ProcessorWrapper {
    constructor(
      public transformer: BackgroundTransformer,
      public name: string,
    ) {}
  }
  return {
    BackgroundTransformer,
    ProcessorWrapper,
    supportsBackgroundProcessors: vi.fn(() => true),
  };
});

import {
  applyMeetingBackgroundProcessor,
  createMeetingBackgroundProcessor,
  keepSpeakerOnly,
  meetingBackgroundActive,
} from "./meeting-background-processor";
import { MASK_BACKGROUND, MASK_PERSON } from "./meeting-background-subject";

type CreatedProcessor = { name: string; transformer: { options: Record<string, unknown> } };

function describeProcessor(processor: unknown) {
  const { name, transformer } = processor as CreatedProcessor;
  return { name, options: transformer.options };
}

describe("createMeetingBackgroundProcessor", () => {
  it("returns blur processor for blur preset", async () => {
    expect(describeProcessor(await createMeetingBackgroundProcessor("blur", null))).toEqual({
      name: "background-blur",
      options: { blurRadius: 12 },
    });
  });

  it("returns virtual background for preset and custom images", async () => {
    expect(describeProcessor(await createMeetingBackgroundProcessor("classroom", null))).toEqual(
      { name: "virtual-background", options: { imagePath: "/meetings/backgrounds/classroom.svg" } },
    );
    expect(describeProcessor(await createMeetingBackgroundProcessor("nature", null))).toEqual({
      name: "virtual-background",
      options: { imagePath: "/meetings/backgrounds/nature.svg" },
    });
    expect(
      describeProcessor(
        await createMeetingBackgroundProcessor("custom", "data:image/png;base64,abc"),
      ),
    ).toEqual({
      name: "virtual-background",
      options: { imagePath: "data:image/png;base64,abc" },
    });
  });

  it("returns null when no background should be applied", async () => {
    await expect(createMeetingBackgroundProcessor("none", null)).resolves.toBeNull();
    await expect(createMeetingBackgroundProcessor("custom", null)).resolves.toBeNull();
  });
});

describe("applyMeetingBackgroundProcessor", () => {
  it("stops processor when background is none", async () => {
    const track = {
      stopProcessor: vi.fn().mockResolvedValue(undefined),
      setProcessor: vi.fn(),
    } as unknown as LocalVideoTrack;
    const processorRef = { current: { kind: "blur", radius: 12 } as never };

    await applyMeetingBackgroundProcessor(track, processorRef, "none", null);

    expect(track.stopProcessor).toHaveBeenCalledOnce();
    expect(track.setProcessor).not.toHaveBeenCalled();
    expect(processorRef.current).toBeNull();
  });

  it("applies a new processor for custom uploads", async () => {
    const track = {
      stopProcessor: vi.fn().mockResolvedValue(undefined),
      setProcessor: vi.fn().mockResolvedValue(undefined),
    } as unknown as LocalVideoTrack;
    const processorRef = { current: null as never };

    await applyMeetingBackgroundProcessor(
      track,
      processorRef,
      "custom",
      "data:image/png;base64,abc",
    );

    const [processor] = vi.mocked(track.setProcessor).mock.calls[0]!;
    expect(describeProcessor(processor)).toEqual({
      name: "virtual-background",
      options: { imagePath: "data:image/png;base64,abc" },
    });
  });

  it("replaces an existing processor", async () => {
    const track = {
      stopProcessor: vi.fn().mockResolvedValue(undefined),
      setProcessor: vi.fn().mockResolvedValue(undefined),
    } as unknown as LocalVideoTrack;
    const processorRef = { current: { kind: "blur", radius: 12 } as never };

    await applyMeetingBackgroundProcessor(track, processorRef, "blur", null);

    expect(track.stopProcessor).toHaveBeenCalledOnce();
    expect(track.setProcessor).toHaveBeenCalledOnce();
  });
});

describe("meetingBackgroundActive", () => {
  it("treats only none as inactive", () => {
    expect(meetingBackgroundActive("none")).toBe(false);
    expect(meetingBackgroundActive("blur")).toBe(true);
    expect(meetingBackgroundActive("custom")).toBe(true);
  });
});

describe("keepSpeakerOnly", () => {
  function fakeGl() {
    const uploads: Uint8Array[] = [];
    const gl = {
      TEXTURE_2D: 1,
      UNPACK_ALIGNMENT: 2,
      createTexture: vi.fn(() => ({ id: "speaker-mask" })),
      deleteTexture: vi.fn(),
      bindTexture: vi.fn(),
      activeTexture: vi.fn(),
      texParameteri: vi.fn(),
      getParameter: vi.fn(() => 4),
      pixelStorei: vi.fn(),
      texImage2D: vi.fn((...args: unknown[]) => uploads.push(args.at(-1) as Uint8Array)),
    };
    return { gl, uploads };
  }

  it("uploads a mask with only the speaker and hands it to the compositor", async () => {
    const { BackgroundTransformer } = await import("@livekit/track-processors");
    const transformer = new BackgroundTransformer({});
    const { gl, uploads } = fakeGl();
    const pipeline = { updateMask: vi.fn() };
    Object.assign(transformer, { gl: pipeline, canvas: { getContext: () => gl } });
    keepSpeakerOnly(transformer);

    // 4x1 frame: the speaker on the left, a colleague alone on the right.
    const mask = new Uint8Array([MASK_PERSON, MASK_PERSON, MASK_BACKGROUND, MASK_PERSON]);
    const hook = (transformer as unknown as { updateMask: (m: unknown) => void }).updateMask;
    hook({ width: 4, height: 1, getAsUint8Array: () => mask });

    expect(Array.from(uploads[0]!)).toEqual([
      MASK_PERSON,
      MASK_PERSON,
      MASK_BACKGROUND,
      MASK_BACKGROUND,
    ]);
    expect(pipeline.updateMask).toHaveBeenCalledWith({ id: "speaker-mask" });

    await transformer.destroy();
    expect(gl.deleteTexture).toHaveBeenCalledWith({ id: "speaker-mask" });
  });

  it("still finds the private updateMask hook in the installed library", async () => {
    const actual = await vi.importActual<typeof import("@livekit/track-processors")>(
      "@livekit/track-processors",
    );
    expect(typeof Reflect.get(actual.BackgroundTransformer.prototype, "updateMask")).toBe(
      "function",
    );
  });
});
