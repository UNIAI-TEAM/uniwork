import { describe, expect, it } from "vitest";
import { resolveMeetingBackgroundImagePath } from "./room-preferences";

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
