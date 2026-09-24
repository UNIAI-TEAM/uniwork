import { describe, expect, it } from "vitest";
import type { CalendarEvent } from "@uniwork/core/calendar/types";
import { assignDueDate, dropToPatch } from "./calendar-drop-patch";

/** Local calendar midnight (all-day FC dates). */
function localMidnight(y: number, m: number, d: number): Date {
  return new Date(y, m - 1, d);
}

describe("dropToPatch", () => {
  it("maps task due-only move one day forward", () => {
    const event: CalendarEvent = {
      id: "task:t1",
      kind: "task",
      entityId: "t1",
      title: "Due only",
      start: "2026-09-10",
      end: "2026-09-11",
      allDay: true,
    };
    expect(
      dropToPatch({
        event,
        start: localMidnight(2026, 9, 11),
        end: localMidnight(2026, 9, 12),
        allDay: true,
      }),
    ).toEqual({
      kind: "task",
      entityId: "t1",
      patch: { due_date: "2026-09-11" },
    });
  });

  it("maps due-only task resized to multi-day span with start_date and due_date", () => {
    const event: CalendarEvent = {
      id: "task:t1b",
      kind: "task",
      entityId: "t1b",
      title: "Due only",
      start: "2026-09-10",
      end: "2026-09-11",
      allDay: true,
    };
    expect(
      dropToPatch({
        event,
        start: localMidnight(2026, 9, 10),
        end: localMidnight(2026, 9, 13),
        allDay: true,
      }),
    ).toEqual({
      kind: "task",
      entityId: "t1b",
      patch: { start_date: "2026-09-10", due_date: "2026-09-12" },
    });
  });

  it("maps task span move preserving inclusive length", () => {
    const event: CalendarEvent = {
      id: "task:t2",
      kind: "task",
      entityId: "t2",
      title: "Span",
      start: "2026-09-08",
      end: "2026-09-11",
      allDay: true,
    };
    expect(
      dropToPatch({
        event,
        start: localMidnight(2026, 9, 15),
        end: localMidnight(2026, 9, 18),
        allDay: true,
      }),
    ).toEqual({
      kind: "task",
      entityId: "t2",
      patch: { start_date: "2026-09-15", due_date: "2026-09-17" },
    });
  });

  it("maps task span resize from new start and exclusive end", () => {
    const event: CalendarEvent = {
      id: "task:t3",
      kind: "task",
      entityId: "t3",
      title: "Resize",
      start: "2026-09-08",
      end: "2026-09-11",
      allDay: true,
    };
    expect(
      dropToPatch({
        event,
        start: localMidnight(2026, 9, 8),
        end: localMidnight(2026, 9, 13),
        allDay: true,
      }),
    ).toEqual({
      kind: "task",
      entityId: "t3",
      patch: { start_date: "2026-09-08", due_date: "2026-09-12" },
    });
  });

  it("maps meeting timed move to ISO starts_at and ends_at", () => {
    const event: CalendarEvent = {
      id: "meeting:m1",
      kind: "meeting",
      entityId: "m1",
      title: "Standup",
      start: "2026-09-10T09:00:00.000Z",
      end: "2026-09-10T10:00:00.000Z",
      allDay: false,
    };
    const newStart = new Date("2026-09-10T14:00:00.000Z");
    const newEnd = new Date("2026-09-10T15:00:00.000Z");
    expect(
      dropToPatch({
        event,
        start: newStart,
        end: newEnd,
        allDay: false,
      }),
    ).toEqual({
      kind: "meeting",
      entityId: "m1",
      body: { starts_at: newStart.toISOString(), ends_at: newEnd.toISOString() },
    });
  });

  it("maps a timed task move or resize to dates and exact instants", () => {
    const event: CalendarEvent = {
      id: "task:t4",
      kind: "task",
      entityId: "t4",
      title: "Focus",
      start: "2026-09-10T07:00:00.000Z",
      end: "2026-09-10T08:00:00.000Z",
      allDay: false,
    };
    const newStart = new Date("2026-09-11T07:30:00.000Z");
    const newEnd = new Date("2026-09-11T09:00:00.000Z");

    expect(dropToPatch({ event, start: newStart, end: newEnd, allDay: false })).toEqual({
      kind: "task",
      entityId: "t4",
      patch: {
        start_date: "2026-09-11",
        due_date: "2026-09-11",
        start_at: newStart.toISOString(),
        due_at: newEnd.toISOString(),
      },
    });
  });

  it("returns null for unmappable meeting forced all-day", () => {
    const event: CalendarEvent = {
      id: "meeting:m2",
      kind: "meeting",
      entityId: "m2",
      title: "Weird",
      start: "2026-09-10T09:00:00.000Z",
      end: "2026-09-10T10:00:00.000Z",
      allDay: false,
    };
    expect(
      dropToPatch({
        event,
        start: new Date("2026-09-10T00:00:00.000Z"),
        end: new Date("2026-09-11T00:00:00.000Z"),
        allDay: true,
      }),
    ).toBeNull();
  });

  it("assignDueDate sets due only when task is not on the feed", () => {
    expect(
      assignDueDate({ taskId: "t-new", dueYmd: "2026-09-15" }),
    ).toEqual({
      kind: "task",
      entityId: "t-new",
      patch: { due_date: "2026-09-15" },
    });
  });

  it("assignDueDate preserves span length when task is on the feed", () => {
    const event: CalendarEvent = {
      id: "task:t2",
      kind: "task",
      entityId: "t2",
      title: "Span",
      start: "2026-09-08",
      end: "2026-09-11",
      allDay: true,
    };
    expect(assignDueDate({ taskId: "t2", dueYmd: "2026-09-17", calendarEvent: event })).toEqual({
      kind: "task",
      entityId: "t2",
      patch: { start_date: "2026-09-15", due_date: "2026-09-17" },
    });
  });

  it("returns null for unknown event kind", () => {
    const event = {
      id: "x:1",
      kind: "unknown",
      entityId: "1",
      title: "X",
      start: "2026-09-10",
      allDay: true,
    } as unknown as CalendarEvent;
    expect(
      dropToPatch({
        event,
        start: localMidnight(2026, 9, 11),
        end: localMidnight(2026, 9, 12),
        allDay: true,
      }),
    ).toBeNull();
  });
});
