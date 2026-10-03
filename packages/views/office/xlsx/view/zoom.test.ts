import { describe, expect, it } from "vitest";
import { clampZoom, stepZoom, XLSX_ZOOM_DEFAULT, XLSX_ZOOM_MAX, XLSX_ZOOM_MIN, XLSX_ZOOM_PRESETS, zoomRatioDelta } from "./zoom";

describe("xlsx view zoom logic", () => {
  it("clamps zoom to the renderer's percent range", () => {
    expect(clampZoom(5)).toBe(XLSX_ZOOM_MIN);
    expect(clampZoom(500)).toBe(XLSX_ZOOM_MAX);
    expect(clampZoom(112.6)).toBe(113);
    expect(clampZoom(Number.NaN)).toBe(XLSX_ZOOM_DEFAULT);
  });

  it("steps by ten percent and stays inside the range", () => {
    expect(stepZoom(100, 1)).toBe(110);
    expect(stepZoom(100, -1)).toBe(90);
    expect(stepZoom(XLSX_ZOOM_MIN, -1)).toBe(XLSX_ZOOM_MIN);
    expect(stepZoom(XLSX_ZOOM_MAX, 1)).toBe(XLSX_ZOOM_MAX);
  });

  it("computes the ratio delta that lands the renderer on the target", () => {
    expect(zoomRatioDelta(100, 150)).toBe(0.5);
    expect(zoomRatioDelta(110, 100)).toBeCloseTo(-0.1, 10);
    expect(zoomRatioDelta(125, 100)).toBe(-0.25);
    expect(zoomRatioDelta(100, 100)).toBe(0);
  });

  it("keeps the presets inside the range and includes the default", () => {
    for (const preset of XLSX_ZOOM_PRESETS) {
      expect(clampZoom(preset)).toBe(preset);
    }
    expect(XLSX_ZOOM_PRESETS).toContain(XLSX_ZOOM_DEFAULT);
  });
});
