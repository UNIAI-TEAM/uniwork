import { describe, expect, it } from "vitest";
import { Calendar, CalendarDays } from "lucide-react";
import { MODULE_ICONS } from "./module-icons";
import { MODULE_TONES } from "./module-tones";

describe("module icons", () => {
  it("gives every module with a tint a glyph", () => {
    expect(Object.keys(MODULE_ICONS).sort()).toEqual(Object.keys(MODULE_TONES).sort());
  });

  it("draws each module with its own glyph", () => {
    // Two modules on one shape read as one place; the sidebar rail shows
    // nothing but the shape.
    const glyphs = Object.values(MODULE_ICONS);
    expect(new Set(glyphs).size).toBe(glyphs.length);
  });

  it("keeps meetings off the calendar glyphs", () => {
    // Calendar sits one row above Meetings in the sidebar; Calendar and
    // CalendarDays side by side were the same shape at 16px.
    expect([Calendar, CalendarDays]).not.toContain(MODULE_ICONS.meetings);
  });
});
