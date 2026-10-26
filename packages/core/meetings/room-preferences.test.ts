import { describe, expect, it } from "vitest";
import {
  CROWDED_MEETING_SIZE,
  MAX_CAPTION_LINES,
  MIN_CAPTION_LINES,
  prejoinMicOn,
  resolveMeetingBackgroundImagePath,
  useMeetingRoomPreferencesStore,
} from "./room-preferences";

describe("resolveMeetingBackgroundImagePath", () => {
  it("returns preset paths for classroom and nature", () => {
    expect(resolveMeetingBackgroundImagePath("classroom", null)).toBe(
      "/meetings/backgrounds/classroom.svg",
    );
    expect(resolveMeetingBackgroundImagePath("nature", null)).toBe(
      "/meetings/backgrounds/nature.svg",
    );
  });

  it("returns custom data url only for custom preset", () => {
    const dataUrl = "data:image/png;base64,abc";
    expect(resolveMeetingBackgroundImagePath("custom", dataUrl)).toBe(dataUrl);
    expect(resolveMeetingBackgroundImagePath("blur", dataUrl)).toBeNull();
    expect(resolveMeetingBackgroundImagePath("none", dataUrl)).toBeNull();
  });
});

describe("prejoinMicOn", () => {
  it("starts the mic off once the meeting is crowded", () => {
    expect(prejoinMicOn(null, undefined)).toBe(true);
    expect(prejoinMicOn(null, CROWDED_MEETING_SIZE)).toBe(true);
    expect(prejoinMicOn(null, CROWDED_MEETING_SIZE + 1)).toBe(false);
  });

  it("lets the person's remembered choice win either way", () => {
    expect(prejoinMicOn(true, 500)).toBe(true);
    expect(prejoinMicOn(false, 2)).toBe(false);
  });
});

describe("caption placement", () => {
  it("docks the captions two lines tall until the viewer chooses otherwise, and keeps lines in range", () => {
    const store = useMeetingRoomPreferencesStore;
    expect(store.getState().captionPlacement).toBe("docked");
    expect(store.getState().captionLines).toBe(MIN_CAPTION_LINES);
    expect(store.getState().captionFloat).toBeNull();
    store.getState().setCaptionLines(9);
    expect(store.getState().captionLines).toBe(MAX_CAPTION_LINES);
    store.getState().setCaptionLines(0);
    expect(store.getState().captionLines).toBe(MIN_CAPTION_LINES);
    store.getState().setCaptionLines(3.6);
    expect(store.getState().captionLines).toBe(4);
    store.getState().setCaptionFloat({ x: 10, y: 20, width: 400, height: 160 });
    store.getState().setCaptionPlacement("floating");
    expect(store.getState()).toMatchObject({ captionPlacement: "floating", captionFloat: { x: 10, width: 400 } });
  });
});
