import { describe, expect, it } from "vitest";
import type { CalendarEvent } from "@uniwork/core/calendar/types";
import { dropToPatch } from "./calendar-drop-patch";

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
        start: new Date("2026-09-11T00:00:00.000Z"),
        end: new Date("2026-09-12T00:00:00.000Z"),
        allDay: true,
      }),
    ).toEqual({
      kind: "task",
      entityId: "t1",
      patch: { due_date: "2026-09-11" },
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
        start: new Date("2026-09-15T00:00:00.000Z"),
        end: new Date("2026-09-18T00:00:00.000Z"),
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
        start: new Date("2026-09-08T00:00:00.000Z"),
        end: new Date("2026-09-13T00:00:00.000Z"),
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
        start: new Date("2026-09-11T00:00:00.000Z"),
        end: new Date("2026-09-12T00:00:00.000Z"),
        allDay: true,
      }),
    ).toBeNull();
  });
});
