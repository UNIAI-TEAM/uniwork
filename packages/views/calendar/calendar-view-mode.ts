import {
  addDays,
  addMonths,
  endOfMonth,
  endOfWeek,
  format,
  startOfMonth,
  startOfWeek,
  subDays,
  subMonths,
} from "date-fns";

export type CalendarViewMode = "day" | "work_week" | "week" | "month";

export type CalendarFeedRange = { from: string; to: string };

/** Matches FullCalendar default week start (Sunday) for toolbar-driven fetch hints. */
const FC_WEEK_STARTS_ON = 0 as const;

const WORK_WEEK_HIDDEN_DAYS: number[] = [0, 6];
const NO_HIDDEN_DAYS: number[] = [];

export function rangeForMode(mode: CalendarViewMode, anchor: Date): CalendarFeedRange {
  switch (mode) {
    case "day": {
      const day = format(anchor, "yyyy-MM-dd");
      return { from: day, to: day };
    }
    case "week":
    case "work_week": {
      const start = startOfWeek(anchor, { weekStartsOn: FC_WEEK_STARTS_ON });
      const end = endOfWeek(anchor, { weekStartsOn: FC_WEEK_STARTS_ON });
      return {
        from: format(start, "yyyy-MM-dd"),
        to: format(end, "yyyy-MM-dd"),
      };
    }
    case "month":
      return {
        from: format(startOfMonth(anchor), "yyyy-MM-dd"),
        to: format(endOfMonth(anchor), "yyyy-MM-dd"),
      };
    default: {
      const _exhaustive: never = mode;
      return _exhaustive;
    }
  }
}

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
  return mode === "work_week" ? WORK_WEEK_HIDDEN_DAYS : NO_HIDDEN_DAYS;
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
