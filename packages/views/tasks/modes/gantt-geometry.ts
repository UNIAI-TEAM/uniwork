import type { GanttZoom } from "@uniwork/core/tasks/stores/view-store-types";
import type { Task, TaskStatus } from "@uniwork/core/types";
import {
  addDays,
  dateOnlyToUTCDate,
  daysBetween,
  MS_PER_DAY,
  startOfDayUTC,
} from "./gantt-date";

export const ROW_HEIGHT = 36;
export const HEADER_HEIGHT = 56;
export const LEFT_COL_WIDTH = 320;

export const DAY_PX_BY_ZOOM: Record<GanttZoom, number> = {
  day: 36,
  week: 14,
  month: 6,
};

export interface GanttRange {
  start: Date;
  end: Date;
}

export const STATUS_BAR_BG: Record<TaskStatus, string> = {
  backlog: "bg-muted-foreground/60",
  todo: "bg-muted-foreground/70",
  in_progress: "bg-warning",
  in_review: "bg-success",
  done: "bg-info",
  blocked: "bg-destructive",
  cancelled: "bg-muted-foreground/40",
};

export function computeRange(
  tasks: Task[],
  today: Date,
  zoom: GanttZoom,
): GanttRange {
  const defaultPad: Record<GanttZoom, number> = {
    day: 21,
    week: 60,
    month: 180,
  };
  let minTs = today.getTime() - defaultPad[zoom] * MS_PER_DAY;
  let maxTs = today.getTime() + defaultPad[zoom] * MS_PER_DAY;
  for (const task of tasks) {
    const s = dateOnlyToUTCDate(task.start_date);
    const e = dateOnlyToUTCDate(task.due_date);
    if (s && s.getTime() < minTs) minTs = s.getTime();
    if (e && e.getTime() > maxTs) maxTs = e.getTime();
    if (s && s.getTime() > maxTs) maxTs = s.getTime();
    if (e && e.getTime() < minTs) minTs = e.getTime();
  }
  const pad = Math.max(2, Math.round(defaultPad[zoom] / 6));
  return {
    start: addDays(startOfDayUTC(new Date(minTs)), -pad),
    end: addDays(startOfDayUTC(new Date(maxTs)), pad + 1),
  };
}

export function barGeometry(
  task: Task,
  range: GanttRange,
  dayPx: number,
  totalDays: number,
): { left: number; width: number; isMarker: boolean; inverted: boolean } | null {
  const start = dateOnlyToUTCDate(task.start_date);
  const due = dateOnlyToUTCDate(task.due_date);
  const inverted =
    start !== null && due !== null && start.getTime() > due.getTime();
  const rangeStart = start && due ? (inverted ? due : start) : (start ?? due);
  const rangeEnd = start && due ? (inverted ? start : due) : (start ?? due);
  if (!rangeStart || !rangeEnd) return null;
  const s = Math.max(daysBetween(range.start, rangeStart), 0);
  const e = Math.min(daysBetween(range.start, rangeEnd) + 1, totalDays);
  if (e <= s) return null;
  const isSingle = !start || !due;
  if (isSingle) {
    return {
      left: s * dayPx,
      width: Math.max(dayPx, 12),
      isMarker: true,
      inverted,
    };
  }
  return {
    left: s * dayPx,
    width: (e - s) * dayPx,
    isMarker: false,
    inverted,
  };
}
