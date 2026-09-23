import { describe, expect, it } from "vitest";
import { meetingScheduleFromSlot, taskDefaultsFromSlot } from "./slot-prefill";

describe("taskDefaultsFromSlot", () => {
  it("all-day click sets due_date only", () => {
    expect(
      taskDefaultsFromSlot({
        start: new Date("2026-09-10T00:00:00"),
        end: null,
        allDay: true,
      }),
    ).toEqual({ due_date: "2026-09-10" });
  });

  it("multi-day all-day select sets start and inclusive due", () => {
    expect(
      taskDefaultsFromSlot({
        start: new Date("2026-09-10T00:00:00"),
        end: new Date("2026-09-13T00:00:00"),
        allDay: true,
      }),
    ).toEqual({ start_date: "2026-09-10", due_date: "2026-09-12" });
  });

  it("timed slot sets due_date from local day", () => {
    expect(
      taskDefaultsFromSlot({
        start: new Date("2026-09-10T14:30:00"),
        end: new Date("2026-09-10T15:30:00"),
        allDay: false,
      }),
    ).toEqual({ due_date: "2026-09-10" });
  });
});

describe("meetingScheduleFromSlot", () => {
  it("all-day slot uses a one-hour block on that date", () => {
    expect(
      meetingScheduleFromSlot({
        start: new Date("2026-09-10T00:00:00"),
        end: null,
        allDay: true,
      }),
    ).toEqual({ date: "2026-09-10", start: "09:00", end: "10:00" });
  });

  it("timed slot uses local wall times", () => {
    expect(
      meetingScheduleFromSlot({
        start: new Date("2026-09-10T14:00:00"),
        end: new Date("2026-09-10T15:30:00"),
        allDay: false,
      }),
    ).toEqual({ date: "2026-09-10", start: "14:00", end: "15:30" });
  });
});
