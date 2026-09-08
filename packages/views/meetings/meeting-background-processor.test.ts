import { describe, expect, it, vi } from "vitest";
import type { LocalVideoTrack } from "livekit-client";

vi.mock("@livekit/track-processors", () => ({
  BackgroundBlur: vi.fn((radius: number) => ({ kind: "blur", radius })),
  VirtualBackground: vi.fn((imagePath: string) => ({ kind: "virtual", imagePath })),
  supportsBackgroundProcessors: vi.fn(() => true),
}));

import {
  applyMeetingBackgroundProcessor,
  createMeetingBackgroundProcessor,
  meetingBackgroundActive,
} from "./meeting-background-processor";

describe("createMeetingBackgroundProcessor", () => {
  it("returns blur processor for blur preset", async () => {
    await expect(createMeetingBackgroundProcessor("blur", null)).resolves.toEqual({
      kind: "blur",
      radius: 12,
    });
  });

  it("returns virtual background for preset and custom images", async () => {
    await expect(createMeetingBackgroundProcessor("classroom", null)).resolves.toEqual({
      kind: "virtual",
      imagePath: "/meetings/backgrounds/classroom.svg",
    });
    await expect(createMeetingBackgroundProcessor("nature", null)).resolves.toEqual({
      kind: "virtual",
      imagePath: "/meetings/backgrounds/nature.svg",
    });
    await expect(
      createMeetingBackgroundProcessor("custom", "data:image/png;base64,abc"),
    ).resolves.toEqual({
      kind: "virtual",
      imagePath: "data:image/png;base64,abc",
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

    expect(track.setProcessor).toHaveBeenCalledWith({
      kind: "virtual",
      imagePath: "data:image/png;base64,abc",
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
