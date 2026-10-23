import { describe, expect, it } from "vitest";
import { backIcon, hitSlopFor, MIN_TOUCH_TARGET, minTouchTarget, withAlpha } from "./platform-ui";

describe("platform conventions", () => {
  it("draws Android's back as an arrow and iOS's as a chevron", () => {
    expect(backIcon("android")).toBe("arrow-back");
    expect(backIcon("ios")).toBe("chevron-back");
  });

  it("asks 48 dp of a touch target on Android and 44 pt elsewhere", () => {
    expect(minTouchTarget("android")).toBe(MIN_TOUCH_TARGET.android);
    expect(minTouchTarget("ios")).toBe(44);
    expect(minTouchTarget("web")).toBe(44);
  });

  it("grows a small control to the minimum with hit slop, and leaves a large one alone", () => {
    expect(hitSlopFor(36, "ios")).toBe(4);
    expect(hitSlopFor(36, "android")).toBe(6);
    expect(hitSlopFor(44, "android")).toBe(2);
    expect(hitSlopFor(43, "ios")).toBe(1);
    expect(hitSlopFor(56, "android")).toBe(0);
  });

  it("writes a token with alpha in the form React Native parses", () => {
    expect(withAlpha("hsl(0 0% 12.5%)", 0.12)).toBe("hsla(0, 0%, 12.5%, 0.12)");
    expect(() => withAlpha("#000", 0.1)).toThrow("not an hsl() token");
  });
});
