import { describe, expect, it } from "vitest";
import {
  clampFontSize,
  stepFontSize,
  XLSX_DEFAULT_FONT_FAMILY,
  XLSX_DEFAULT_FONT_SIZE,
  XLSX_FONT_FAMILIES,
  XLSX_HORIZONTAL_ALIGN,
  XLSX_PALETTE_COLORS,
  XLSX_TEXT_ROTATIONS,
  XLSX_VERTICAL_ALIGN,
  XLSX_WRAP_STRATEGY,
} from "./home-format";

describe("home format model", () => {
  it("offers a unique Excel-style palette of hex colours", () => {
    expect(new Set(XLSX_PALETTE_COLORS).size).toBe(XLSX_PALETTE_COLORS.length);
    expect(XLSX_PALETTE_COLORS.length).toBeGreaterThanOrEqual(15);
    for (const color of XLSX_PALETTE_COLORS) expect(color).toMatch(/^#[0-9A-F]{6}$/i);
  });

  it("keeps the default family in the picker list", () => {
    expect(XLSX_FONT_FAMILIES).toContain(XLSX_DEFAULT_FONT_FAMILY);
  });

  it("clamps typed sizes into the OOXML range", () => {
    expect(clampFontSize(0)).toBe(1);
    expect(clampFontSize(-4)).toBe(1);
    expect(clampFontSize(10.6)).toBe(11);
    expect(clampFontSize(999)).toBe(409);
  });

  it("steps from the current size or the Excel default", () => {
    expect(stepFontSize(14, 1)).toBe(15);
    expect(stepFontSize(14, -1)).toBe(13);
    expect(stepFontSize(null, 1)).toBe(XLSX_DEFAULT_FONT_SIZE + 1);
    expect(stepFontSize(1, -1)).toBe(1);
    expect(stepFontSize(409, 1)).toBe(409);
  });

  it("pins the rotation and alignment values the renderer mirrors", () => {
    expect(XLSX_TEXT_ROTATIONS).toContain(0);
    expect(XLSX_TEXT_ROTATIONS).toContain(90);
    expect(XLSX_TEXT_ROTATIONS).toContain(-45);
    expect(XLSX_HORIZONTAL_ALIGN).toEqual({ left: 1, center: 2, right: 3 });
    expect(XLSX_VERTICAL_ALIGN).toEqual({ top: 1, middle: 2, bottom: 3 });
    expect(XLSX_WRAP_STRATEGY.wrap).toBe(3);
    expect(XLSX_WRAP_STRATEGY.overflow).toBe(1);
  });
});
