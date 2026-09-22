import { describe, expect, it } from "vitest";
import { fcHiddenDays, fcViewForMode, rangeForMode, shiftAnchor } from "./calendar-view-mode";

describe("calendar-view-mode", () => {
  it("maps modes to FC views", () => {
    expect(fcViewForMode("day")).toBe("timeGridDay");
    expect(fcViewForMode("work_week")).toBe("timeGridWeek");
    expect(fcViewForMode("week")).toBe("timeGridWeek");
    expect(fcViewForMode("month")).toBe("dayGridMonth");
  });
  it("hides weekends only for work_week", () => {
    expect(fcHiddenDays("work_week")).toEqual([0, 6]);
    expect(fcHiddenDays("week")).toEqual([]);
  });
  it("shifts anchor by period", () => {
    const d = new Date("2026-09-15T12:00:00Z");
    expect(shiftAnchor("day", d, 1).toISOString().slice(0, 10)).toBe("2026-09-16");
  });

  it("builds feed range for each view mode", () => {
    const d = new Date("2026-09-15T12:00:00Z");
    expect(rangeForMode("day", d)).toEqual({ from: "2026-09-15", to: "2026-09-15" });
    expect(rangeForMode("week", d)).toEqual({ from: "2026-09-13", to: "2026-09-19" });
    expect(rangeForMode("work_week", d)).toEqual({ from: "2026-09-13", to: "2026-09-19" });
    expect(rangeForMode("month", d)).toEqual({ from: "2026-09-01", to: "2026-09-30" });
  });
});
