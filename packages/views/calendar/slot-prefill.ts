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

export function meetingScheduleFromSlot(slot: CalendarSlot): ScheduleDraft {
  if (slot.allDay) {
    return { date: ymdLocal(slot.start), start: "09:00", end: "10:00" };
  }
  const end = slot.end ?? addHours(slot.start, 1);
  return {
    date: ymdLocal(slot.start),
    start: hmLocal(slot.start),
    end: hmLocal(end),
  };
}
