import type { CreateTaskBody } from "@uniwork/core/tasks";
import { addHours, format, subDays } from "date-fns";
import type { ScheduleDraft } from "../meetings/meeting-datetime";

export type CalendarSlot = {
  start: Date;
  end: Date | null;
  allDay: boolean;
};

function ymdLocal(d: Date): string {
  return format(d, "yyyy-MM-dd");
}

function hmLocal(d: Date): string {
  return format(d, "HH:mm");
}

/** FC all-day `end` is exclusive; task due_date is the last inclusive day. */
function inclusiveDueFromExclusiveEnd(end: Date): string {
  return format(subDays(end, 1), "yyyy-MM-dd");
}

export function taskDefaultsFromSlot(slot: CalendarSlot): Partial<CreateTaskBody> {
  const startYmd = ymdLocal(slot.start);
  if (slot.allDay) {
    if (!slot.end) {
      return { due_date: startYmd };
    }
    const dueYmd = inclusiveDueFromExclusiveEnd(slot.end);
    if (startYmd === dueYmd) {
      return { due_date: dueYmd };
    }
    return { start_date: startYmd, due_date: dueYmd };
  }
  const end = slot.end ?? addHours(slot.start, 1);
  return {
    start_date: startYmd,
    due_date: ymdLocal(end),
    start_at: slot.start.toISOString(),
    due_at: end.toISOString(),
  };
}

const MEETING_START_STEP_MS = 15 * 60 * 1000;
const ALL_DAY_MEETING_MS = 60 * 60 * 1000;

/** The first quarter hour at or after `nowMs`. */
function nextMeetingStart(nowMs: number): Date {
  return new Date(Math.ceil(nowMs / MEETING_START_STEP_MS) * MEETING_START_STEP_MS);
}

function draftFrom(start: Date, end: Date): ScheduleDraft {
  return { date: ymdLocal(start), start: hmLocal(start), end: hmLocal(end) };
}

/**
 * A meeting window for a calendar slot, or null when the slot has already
 * passed: the server and the dialog refuse a start in the past, so the
 * calendar must not offer one. A slot that is still running starts at the
 * next quarter hour and keeps its length; today's all-day slot does the same
 * instead of a morning that is already gone.
 */
export function meetingScheduleFromSlot(slot: CalendarSlot, nowMs: number): ScheduleDraft | null {
  if (slot.allDay) {
    const day = ymdLocal(slot.start);
    const today = ymdLocal(new Date(nowMs));
    if (day < today) return null;
    if (day > today) return { date: day, start: "09:00", end: "10:00" };
    const start = nextMeetingStart(nowMs);
    return draftFrom(start, new Date(start.getTime() + ALL_DAY_MEETING_MS));
  }
  const end = slot.end ?? addHours(slot.start, 1);
  if (end.getTime() <= nowMs) return null;
  if (slot.start.getTime() >= nowMs) return draftFrom(slot.start, end);
  const start = nextMeetingStart(nowMs);
  return draftFrom(start, new Date(start.getTime() + (end.getTime() - slot.start.getTime())));
}
