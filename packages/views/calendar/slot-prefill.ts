import type { CreateTaskBody } from "@uniwork/core/tasks";
import { addHours, format, subDays } from "date-fns";

export type CalendarSlot = {
  start: Date;
  end: Date | null;
  allDay: boolean;
};

function ymdLocal(d: Date): string {
  return format(d, "yyyy-MM-dd");
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
