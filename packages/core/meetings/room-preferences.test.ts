import { describe, expect, it } from "vitest";
import { CROWDED_MEETING_SIZE, prejoinMicOn, resolveMeetingBackgroundImagePath } from "./room-preferences";

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
