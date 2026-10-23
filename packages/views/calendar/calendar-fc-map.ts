import type { CalendarEvent } from "@uniwork/core/calendar/types";

export function toFcEvent(ev: CalendarEvent) {
  return {
    id: ev.id,
    title: ev.title,
    start: ev.start,
    ...(ev.end !== undefined ? { end: ev.end } : {}),
    allDay: ev.allDay,
    editable: ev.kind !== "external",
    classNames: ev.kind === "external" ? ["calendar-external-event"] : [],
    extendedProps: { kind: ev.kind, entityId: ev.entityId },
  };
}
