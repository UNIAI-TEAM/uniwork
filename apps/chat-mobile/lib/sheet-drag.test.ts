import { describe, expect, it } from "vitest";
import { SHEET_CLOSE_DISTANCE, SHEET_CLOSE_VELOCITY, sheetOffset, shouldCloseSheet } from "./sheet-drag";

describe("sheet drag", () => {
  it("follows the finger down and never lifts the sheet above where it rests", () => {
    expect(sheetOffset(42)).toBe(42);
    expect(sheetOffset(-30)).toBe(0);
  });

  it("closes past 40 % of a short sheet, or past the fixed distance of a tall one", () => {
    expect(shouldCloseSheet(90, 0, 200)).toBe(true);
    expect(shouldCloseSheet(70, 0, 200)).toBe(false);
    expect(shouldCloseSheet(SHEET_CLOSE_DISTANCE + 1, 0, 800)).toBe(true);
    expect(shouldCloseSheet(SHEET_CLOSE_DISTANCE - 1, 0, 800)).toBe(false);
    // Not measured yet: the fixed distance.
    expect(shouldCloseSheet(SHEET_CLOSE_DISTANCE + 1, 0, 0)).toBe(true);
  });

  it("closes on a downward flick from any distance, never on an upward drag", () => {
    expect(shouldCloseSheet(10, SHEET_CLOSE_VELOCITY + 1, 600)).toBe(true);
    expect(shouldCloseSheet(10, SHEET_CLOSE_VELOCITY - 1, 600)).toBe(false);
    expect(shouldCloseSheet(0, 5000, 600)).toBe(false);
    expect(shouldCloseSheet(-50, 5000, 600)).toBe(false);
  });
});
