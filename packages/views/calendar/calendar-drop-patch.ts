import type { CalendarEvent } from "@uniwork/core/calendar/types";
import { differenceInCalendarDays, format, parseISO, subDays } from "date-fns";

export type CalendarDropPatch =
  | {
      kind: "task";
      entityId: string;
      patch: {
        due_date?: string | null;
        start_date?: string | null;
        due_at?: string | null;
        start_at?: string | null;
      };
    }
  | { kind: "meeting"; entityId: string; body: { starts_at: string; ends_at: string } };

function ymdFromDate(d: Date): string {
  return format(d, "yyyy-MM-dd");
}

/** FC all-day `end` is exclusive; task due_date is the last inclusive day. */
function inclusiveEndFromExclusiveEnd(end: Date): string {
  return format(subDays(end, 1), "yyyy-MM-dd");
}

function inclusiveDueFromEvent(event: CalendarEvent): string {
  if (event.end) {
    const exclusiveEndYmd = event.end.slice(0, 10);
    const parts = exclusiveEndYmd.split("-").map(Number);
    const y = parts[0] ?? 0;
    const m = parts[1] ?? 1;
    const day = parts[2] ?? 1;
    return format(subDays(new Date(y, m - 1, day), 1), "yyyy-MM-dd");
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
  const clearTimedSchedule = event.allDay ? {} : { start_at: null, due_at: null };

  if (isDueOnlyTask(event)) {
    if (startDate !== dueDate) {
      return {
        kind: "task",
        entityId: event.entityId,
        patch: { start_date: startDate, due_date: dueDate, ...clearTimedSchedule },
      };
    }
    return {
      kind: "task",
      entityId: event.entityId,
      patch: { due_date: dueDate, ...clearTimedSchedule },
    };
  }

  return {
    kind: "task",
    entityId: event.entityId,
    patch: { start_date: startDate, due_date: dueDate, ...clearTimedSchedule },
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

function mapTaskTimed(
  event: CalendarEvent,
  start: Date,
  end: Date | null,
): CalendarDropPatch | null {
  if (!end) {
    return null;
  }

  return {
    kind: "task",
    entityId: event.entityId,
    patch: {
      start_date: ymdFromDate(start),
      due_date: ymdFromDate(end),
      start_at: start.toISOString(),
      due_at: end.toISOString(),
    },
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
    return allDay ? mapTaskAllDay(event, start, end) : mapTaskTimed(event, start, end);
  }

  if (event.kind === "meeting") {
    if (allDay) {
      return null;
    }
    return mapMeetingTimed(event, start, end);
  }

  return null;
}

/** Sidebar → grid drop: set due_date; shift start_date when task already spans days. */
export function assignDueDate(input: {
  taskId: string;
  dueYmd: string;
  calendarEvent?: CalendarEvent;
}): Extract<CalendarDropPatch, { kind: "task" }> {
  const { taskId, dueYmd, calendarEvent } = input;

  if (!calendarEvent || calendarEvent.kind !== "task") {
    return { kind: "task", entityId: taskId, patch: { due_date: dueYmd } };
  }

  if (isDueOnlyTask(calendarEvent)) {
    return { kind: "task", entityId: taskId, patch: { due_date: dueYmd } };
  }

  const oldStart = calendarEvent.start.slice(0, 10);
  const oldDue = inclusiveDueFromEvent(calendarEvent);
  const offsetDays = differenceInCalendarDays(parseISO(oldDue), parseISO(oldStart));
  const startDate = format(subDays(parseISO(dueYmd), offsetDays), "yyyy-MM-dd");

  return {
    kind: "task",
    entityId: taskId,
    patch: { start_date: startDate, due_date: dueYmd },
  };
}
