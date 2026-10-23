import { enUS } from "date-fns/locale";
import { describe, expect, it } from "vitest";
import {
  fcHiddenDays,
  fcViewForMode,
  formatPeriodLabel,
  rangeForMode,
  shiftAnchor,
} from "./calendar-view-mode";

describe("calendar-view-mode", () => {
  it("maps modes to FC views", () => {
    expect(fcViewForMode("day")).toBe("timeGridDay");
    expect(fcViewForMode("work_week")).toBe("timeGridWeek");
    expect(fcViewForMode("week")).toBe("timeGridWeek");
    expect(fcViewForMode("month")).toBe("dayGridMonth");
  });
  it("hides weekends for work-week and configurable multi-day views", () => {
    expect(fcHiddenDays("work_week", true)).toEqual([0, 6]);
    expect(fcHiddenDays("work_week", false)).toEqual([0, 6]);
    expect(fcHiddenDays("week", true)).toEqual([]);
    expect(fcHiddenDays("week", false)).toEqual([0, 6]);
    expect(fcHiddenDays("month", false)).toEqual([0, 6]);
    expect(fcHiddenDays("day", false)).toEqual([]);
  });
  it("shifts anchor by period", () => {
    const d = new Date("2026-09-15T12:00:00Z");
    expect(shiftAnchor("day", d, 1).toISOString().slice(0, 10)).toBe("2026-09-16");
  });

  it("builds feed range for each view mode", () => {
    const d = new Date("2026-09-15T12:00:00Z");
    expect(rangeForMode("day", d)).toEqual({ from: "2026-09-15", to: "2026-09-15" });
    expect(rangeForMode("week", d)).toEqual({ from: "2026-09-14", to: "2026-09-20" });
    expect(rangeForMode("work_week", d)).toEqual({ from: "2026-09-14", to: "2026-09-18" });
    expect(rangeForMode("month", d)).toEqual({ from: "2026-09-01", to: "2026-09-30" });
  });

  it("formats toolbar period label by view mode", () => {
    const anchor = new Date("2026-09-15T12:00:00Z");
    expect(formatPeriodLabel("month", anchor, enUS)).toBe("September 2026");
    expect(formatPeriodLabel("day", anchor, enUS)).toBe("September 15th, 2026");
    expect(formatPeriodLabel("week", anchor, enUS)).toBe("14 – 20 September 2026");
    expect(formatPeriodLabel("work_week", anchor, enUS)).toBe("14 – 18 September 2026");
  });
});
