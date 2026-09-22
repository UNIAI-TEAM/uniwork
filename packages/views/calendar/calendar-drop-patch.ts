import type { CalendarEvent } from "@uniwork/core/calendar/types";

export type CalendarDropPatch =
  | {
      kind: "task";
      entityId: string;
      patch: { due_date?: string | null; start_date?: string | null };
    }
  | { kind: "meeting"; entityId: string; body: { starts_at: string; ends_at: string } };

function ymdFromDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** FC all-day `end` is exclusive; task due_date is the last inclusive day. */
function inclusiveEndFromExclusiveEnd(end: Date): string {
  const [y, m, day] = ymdFromDate(end).split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, day - 1));
  return dt.toISOString().slice(0, 10);
}

function inclusiveDueFromEvent(event: CalendarEvent): string {
  if (event.end) {
    const [y, m, day] = event.end.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, day - 1));
    return dt.toISOString().slice(0, 10);
  }
  return event.start.slice(0, 10);
}

function isDueOnlyTask(event: CalendarEvent): boolean {
  const startYmd = event.start.slice(0, 10);
  return startYmd === inclusiveDueFromEvent(event);
}

function mapTaskAllDay(
  event: CalendarEvent,
  start: Date,
  end: Date | null,
): CalendarDropPatch | null {
  if (!end) {
    return null;
  }

  const startDate = ymdFromDate(start);
  const dueDate = inclusiveEndFromExclusiveEnd(end);

  if (isDueOnlyTask(event)) {
    return {
      kind: "task",
      entityId: event.entityId,
      patch: { due_date: dueDate },
    };
  }

  return {
    kind: "task",
    entityId: event.entityId,
    patch: { start_date: startDate, due_date: dueDate },
  };
}

function mapMeetingTimed(
  event: CalendarEvent,
  start: Date,
  end: Date | null,
): CalendarDropPatch | null {
  if (!end) {
    return null;
  }

  return {
    kind: "meeting",
    entityId: event.entityId,
    body: { starts_at: start.toISOString(), ends_at: end.toISOString() },
  };
}

/** Input is already decoded from FC (no FC imports in this module). */
export function dropToPatch(input: {
  event: CalendarEvent;
  start: Date;
  end: Date | null;
  allDay: boolean;
}): CalendarDropPatch | null {
  const { event, start, end, allDay } = input;

  if (event.kind === "task") {
    if (!allDay) {
      return null;
    }
    return mapTaskAllDay(event, start, end);
  }

  if (event.kind === "meeting") {
    if (allDay) {
      return null;
    }
    return mapMeetingTimed(event, start, end);
  }

  return null;
}
