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

  it("timed slot keeps its local day and exact time range", () => {
    const start = new Date("2026-09-10T14:30:00");
    const end = new Date("2026-09-10T15:30:00");
    expect(
      taskDefaultsFromSlot({
        start,
        end,
        allDay: false,
      }),
    ).toEqual({
      start_date: "2026-09-10",
      due_date: "2026-09-10",
      start_at: start.toISOString(),
      due_at: end.toISOString(),
    });
  });
});

describe("meetingScheduleFromSlot", () => {
  const now = new Date("2026-09-10T09:55:00").getTime();

  it("uses a one-hour morning block for a future all-day slot", () => {
    expect(
      meetingScheduleFromSlot(
        { start: new Date("2026-09-11T00:00:00"), end: null, allDay: true },
        now,
      ),
    ).toEqual({ date: "2026-09-11", start: "09:00", end: "10:00" });
  });

  it("starts today's all-day slot at the next quarter hour, not a morning that passed", () => {
    expect(
      meetingScheduleFromSlot(
        { start: new Date("2026-09-10T00:00:00"), end: null, allDay: true },
        now,
      ),
    ).toEqual({ date: "2026-09-10", start: "10:00", end: "11:00" });
    expect(
      meetingScheduleFromSlot(
        { start: new Date("2026-09-10T00:00:00"), end: null, allDay: true },
        new Date("2026-09-10T14:05:00").getTime(),
      ),
    ).toEqual({ date: "2026-09-10", start: "14:15", end: "15:15" });
  });

  it("rolls today's all-day slot into tomorrow when the day has run out", () => {
    expect(
      meetingScheduleFromSlot(
        { start: new Date("2026-09-10T00:00:00"), end: null, allDay: true },
        new Date("2026-09-10T23:50:00").getTime(),
      ),
    ).toEqual({ date: "2026-09-11", start: "00:00", end: "01:00" });
  });

  it("refuses an all-day slot on a day that has passed", () => {
    expect(
      meetingScheduleFromSlot(
        { start: new Date("2026-09-09T00:00:00"), end: null, allDay: true },
        now,
      ),
    ).toBeNull();
  });

  it("keeps the local wall-time range for a future timed slot", () => {
    expect(
      meetingScheduleFromSlot(
        {
          start: new Date("2026-09-10T14:00:00"),
          end: new Date("2026-09-10T15:30:00"),
          allDay: false,
        },
        now,
      ),
    ).toEqual({ date: "2026-09-10", start: "14:00", end: "15:30" });
  });

  it("refuses a timed slot that has already ended", () => {
    expect(
      meetingScheduleFromSlot(
        {
          start: new Date("2026-09-10T08:00:00"),
          end: new Date("2026-09-10T09:00:00"),
          allDay: false,
        },
        now,
      ),
    ).toBeNull();
    expect(
      meetingScheduleFromSlot(
        { start: new Date("2026-09-10T08:30:00"), end: null, allDay: false },
        now,
      ),
    ).toBeNull();
  });

  it("moves a running slot's start to the next quarter hour and keeps its length", () => {
    expect(
      meetingScheduleFromSlot(
        {
          start: new Date("2026-09-10T09:30:00"),
          end: new Date("2026-09-10T10:00:00"),
          allDay: false,
        },
        now,
      ),
    ).toEqual({ date: "2026-09-10", start: "10:00", end: "10:30" });
  });
});
