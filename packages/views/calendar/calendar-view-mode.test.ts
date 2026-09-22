import { describe, expect, it } from "vitest";
import { fcHiddenDays, fcViewForMode, shiftAnchor } from "./calendar-view-mode";

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
});
