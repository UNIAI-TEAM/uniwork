import { describe, expect, it } from "vitest";
import { PPTX_FALLBACK_FIT_WIDTH, PPTX_ZOOM_MAX, PPTX_ZOOM_MIN, clampZoom, resolveFitWidth, slideDisplaySize, stepZoom, zoomPercent } from "./zoom";

describe("zoom math", () => {
  it("clamps to the supported range and treats non-finite input as fit", () => {
    expect(clampZoom(0.01)).toBe(PPTX_ZOOM_MIN);
    expect(clampZoom(12)).toBe(PPTX_ZOOM_MAX);
    expect(clampZoom(Number.NaN)).toBe(1);
    expect(clampZoom(1.5)).toBe(1.5);
  });

  it("steps through the stops without skipping or overflowing", () => {
    expect(stepZoom(1, 1)).toBe(1.25);
    expect(stepZoom(1, -1)).toBe(0.75);
    expect(stepZoom(0.25, -1)).toBe(PPTX_ZOOM_MIN);
    expect(stepZoom(4, 1)).toBe(PPTX_ZOOM_MAX);
    expect(stepZoom(1.1, 1)).toBe(1.25);
    expect(stepZoom(1.1, -1)).toBe(1);
  });

  it("reports a rounded percentage of fit width", () => {
    expect(zoomPercent(0.5)).toBe(50);
    expect(zoomPercent(1)).toBe(100);
    expect(zoomPercent(9)).toBe(400);
  });

  it("falls back when the container has no measured width", () => {
    expect(resolveFitWidth(0)).toBe(PPTX_FALLBACK_FIT_WIDTH);
    expect(resolveFitWidth(-40)).toBe(PPTX_FALLBACK_FIT_WIDTH);
    expect(resolveFitWidth(Number.NaN)).toBe(PPTX_FALLBACK_FIT_WIDTH);
    expect(resolveFitWidth(812.6)).toBe(813);
    expect(resolveFitWidth(0, 640)).toBe(640);
  });

  it("scales the on-screen size from the fit width and slide aspect", () => {
    expect(slideDisplaySize(800, 1, 9 / 16)).toEqual({ widthPx: 800, heightPx: 450 });
    expect(slideDisplaySize(800, 2, 9 / 16)).toEqual({ widthPx: 1600, heightPx: 900 });
    expect(slideDisplaySize(800, 0.5, 0.75)).toEqual({ widthPx: 400, heightPx: 300 });
    expect(slideDisplaySize(800, 1, 0).heightPx).toBe(450);
  });
});
