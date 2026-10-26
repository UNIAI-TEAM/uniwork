// The image viewer's gesture maths (components/chat/zoomable-image.tsx): how
// far a pinch may zoom, where a zoomed photo may be dragged, where a pinch
// or a double tap zooms towards, and when a drag down closes the viewer.
import { describe, expect, it } from "vitest";
import { DISMISS_DISTANCE, DISMISS_VELOCITY, DOUBLE_TAP_SCALE, MAX_SCALE, clampScale, clampTranslate, doubleTapTarget, focalTranslate, shouldDismiss } from "./zoom";

describe("zoom maths", () => {
  it("keeps the scale between the fitted photo and MAX_SCALE", () => {
    expect(clampScale(0.4)).toBe(1);
    expect(clampScale(2)).toBe(2);
    expect(clampScale(9)).toBe(MAX_SCALE);
  });

  it("lets a zoomed photo move only as far as its overflow, and not at all at 1x", () => {
    expect(clampTranslate(500, 2, 400)).toBe(200);
    expect(clampTranslate(-500, 2, 400)).toBe(-200);
    expect(clampTranslate(50, 2, 400)).toBe(50);
    expect(clampTranslate(80, 1, 400)).toBe(0);
  });

  it("zooms a pinch around its fingers: the point under them stays put", () => {
    // From 1x at rest, fingers 100 pt right of centre, doubling: the photo moves 100 pt left.
    expect(focalTranslate(100, 0, 1, 2)).toBe(-100);
    // Already zoomed and moved: the same rule from where it was.
    expect(focalTranslate(0, 50, 2, 4)).toBe(100);
  });

  it("double-tap zooms in towards the tapped point, or back out", () => {
    expect(doubleTapTarget(1, { x: 300, y: 500 }, { width: 400, height: 800 })).toEqual({ scale: DOUBLE_TAP_SCALE, x: -150, y: -150 });
    expect(doubleTapTarget(2, { x: 300, y: 500 }, { width: 400, height: 800 })).toEqual({ scale: 1, x: 0, y: 0 });
  });

  it("closes on a long or fast drag, either way, and springs back otherwise", () => {
    expect(shouldDismiss(DISMISS_DISTANCE + 1, 0)).toBe(true);
    expect(shouldDismiss(-(DISMISS_DISTANCE + 1), 0)).toBe(true);
    expect(shouldDismiss(20, DISMISS_VELOCITY + 1)).toBe(true);
    expect(shouldDismiss(20, 100)).toBe(false);
  });
});
