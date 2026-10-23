import type { WSEventType } from "../types/events";

/** WS events that can change task due/span or meeting slots on the calendar feed. */
const CALENDAR_INVALIDATE_EVENTS = new Set<WSEventType>([
  "task.created",
  "task.updated",
  "task.deleted",
  "meeting.created",
  "meeting.updated",
  "meeting.deleted",
  "meeting.started",
  "meeting.ended",
  "meeting.canceled",
  "host.transferred",
  "participant.invited",
  "participant.removed",
  "invitation.responded",
]);

export function shouldInvalidateCalendar(eventName: WSEventType): boolean {
  return CALENDAR_INVALIDATE_EVENTS.has(eventName);
}
