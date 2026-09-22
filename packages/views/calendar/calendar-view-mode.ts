import { addDays, addMonths, subDays, subMonths } from "date-fns";

export type CalendarViewMode = "day" | "work_week" | "week" | "month";

export function fcViewForMode(mode: CalendarViewMode): string {
  switch (mode) {
    case "day":
      return "timeGridDay";
    case "work_week":
    case "week":
      return "timeGridWeek";
    case "month":
      return "dayGridMonth";
    default: {
      const _exhaustive: never = mode;
      return _exhaustive;
    }
  }
}

export function fcHiddenDays(mode: CalendarViewMode): number[] {
  return mode === "work_week" ? [0, 6] : [];
}

export function shiftAnchor(mode: CalendarViewMode, anchor: Date, dir: -1 | 1): Date {
  const step = dir === 1 ? 1 : -1;
  switch (mode) {
    case "day":
      return step === 1 ? addDays(anchor, 1) : subDays(anchor, 1);
    case "week":
    case "work_week":
      return step === 1 ? addDays(anchor, 7) : subDays(anchor, 7);
    case "month":
      return step === 1 ? addMonths(anchor, 1) : subMonths(anchor, 1);
    default: {
      const _exhaustive: never = mode;
      return _exhaustive;
    }
  }
}
