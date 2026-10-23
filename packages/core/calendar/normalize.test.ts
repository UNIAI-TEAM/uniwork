import { describe, expect, it } from "vitest";
import { meetingToCalendarEvent, taskToCalendarEvent } from "./normalize";

describe("taskToCalendarEvent", () => {
  it("returns null without due_date", () => {
    expect(taskToCalendarEvent({ id: "t1", title: "A" })).toBeNull();
  });

  it("maps due-only as all-day single day", () => {
    expect(taskToCalendarEvent({ id: "t1", title: "A", due_date: "2026-09-10" })).toEqual({
      id: "task:t1",
      kind: "task",
      entityId: "t1",
      title: "A",
      start: "2026-09-10",
      end: "2026-09-11", // FullCalendar exclusive end for all-day
      allDay: true,
      status: undefined,
      priority: undefined,
      projectId: undefined,
    });
  });

  it("maps start+due as all-day span with exclusive end", () => {
    const ev = taskToCalendarEvent({
      id: "t1",
      title: "A",
      start_date: "2026-09-08",
      due_date: "2026-09-10",
      priority: "high",
    });
    expect(ev?.start).toBe("2026-09-08");
    expect(ev?.end).toBe("2026-09-11");
    expect(ev?.allDay).toBe(true);
    expect(ev?.priority).toBe("high");
  });

  it("maps a task with an exact range as a timed event", () => {
    expect(
      taskToCalendarEvent({
        id: "t1",
        title: "Focus",
        start_date: "2026-09-10",
        due_date: "2026-09-10",
        start_at: "2026-09-10T07:30:00Z",
        due_at: "2026-09-10T08:30:00Z",
      }),
    ).toMatchObject({
      start: "2026-09-10T07:30:00Z",
      end: "2026-09-10T08:30:00Z",
      allDay: false,
    });
  });
});

describe("meetingToCalendarEvent", () => {
  it("returns null when canceled", () => {
    expect(
      meetingToCalendarEvent({
        id: "m1",
        title: "Sync",
        starts_at: "2026-09-10T03:00:00Z",
        ends_at: "2026-09-10T04:00:00Z",
        status: "CANCELED",
      }),
    ).toBeNull();
  });

  it("maps timed meeting", () => {
    const ev = meetingToCalendarEvent({
      id: "m1",
      title: "Sync",
      starts_at: "2026-09-10T03:00:00Z",
      ends_at: "2026-09-10T04:00:00Z",
      status: "SCHEDULED",
    });
    expect(ev).toMatchObject({
      id: "meeting:m1",
      kind: "meeting",
      entityId: "m1",
      allDay: false,
      start: "2026-09-10T03:00:00Z",
      end: "2026-09-10T04:00:00Z",
    });
  });
});
