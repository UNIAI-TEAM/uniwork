// The phone's touch feedback (audit P2 UX): which feel each moment gets on
// each platform, and that a phone without haptics never throws into a tap.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("expo-haptics", () => ({
  impactAsync: vi.fn(async () => undefined),
  notificationAsync: vi.fn(async () => undefined),
  selectionAsync: vi.fn(async () => undefined),
  performAndroidHapticsAsync: vi.fn(async () => undefined),
  ImpactFeedbackStyle: { Light: "light", Medium: "medium", Heavy: "heavy" },
  NotificationFeedbackType: { Success: "success", Warning: "warning", Error: "error" },
  AndroidHaptics: { Confirm: "confirm", Reject: "reject", Long_Press: "long-press", Context_Click: "context-click", Segment_Tick: "segment-tick", Toggle_On: "toggle-on" },
}));

import * as Haptics from "expo-haptics";
import { createHaptics, type HapticMoment } from "./haptics";

beforeEach(() => vi.clearAllMocks());

const MOMENTS: HapticMoment[] = ["send", "longPress", "reaction", "callAccept", "callEnd", "threshold", "recordStart", "failure"];

describe("createHaptics", () => {
  it("gives iOS its impact, selection and notification feels", () => {
    const haptics = createHaptics("ios");
    MOMENTS.forEach((moment) => haptics[moment]());
    expect(vi.mocked(Haptics.impactAsync).mock.calls).toEqual([["light"], ["medium"], ["medium"]]);
    expect(Haptics.selectionAsync).toHaveBeenCalledTimes(2);
    expect(vi.mocked(Haptics.notificationAsync).mock.calls).toEqual([["success"], ["warning"], ["error"]]);
    expect(Haptics.performAndroidHapticsAsync).not.toHaveBeenCalled();
  });

  it("gives Android the system's own feedback constants, which follow its touch-feedback setting", () => {
    const haptics = createHaptics("android");
    MOMENTS.forEach((moment) => haptics[moment]());
    expect(vi.mocked(Haptics.performAndroidHapticsAsync).mock.calls).toEqual([
      ["confirm"],
      ["long-press"],
      ["context-click"],
      ["confirm"],
      ["reject"],
      ["segment-tick"],
      ["toggle-on"],
      ["reject"],
    ]);
    expect(Haptics.impactAsync).not.toHaveBeenCalled();
  });

  it("does nothing elsewhere", () => {
    const haptics = createHaptics("web");
    MOMENTS.forEach((moment) => haptics[moment]());
    expect(Haptics.impactAsync).not.toHaveBeenCalled();
    expect(Haptics.performAndroidHapticsAsync).not.toHaveBeenCalled();
  });

  it("swallows a failure, thrown or rejected: feedback is never worth a broken tap", async () => {
    vi.mocked(Haptics.impactAsync).mockRejectedValueOnce(new Error("no engine"));
    vi.mocked(Haptics.selectionAsync).mockImplementationOnce(() => {
      throw new Error("no module");
    });
    const haptics = createHaptics("ios");
    expect(() => haptics.send()).not.toThrow();
    expect(() => haptics.reaction()).not.toThrow();
    await Promise.resolve();
  });
});
