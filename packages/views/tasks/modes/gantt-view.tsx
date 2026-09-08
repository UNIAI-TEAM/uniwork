"use client";

import { useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { GanttZoom } from "@uniwork/core/tasks/stores/view-store-types";
import { useViewStore, useViewStoreApi } from "@uniwork/core/tasks/stores/view-store-context";
import type { Task } from "@uniwork/core/types";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { sortTasksForTable } from "./table-view-model";
import { GanttAxis, GanttBackgroundLayer } from "./gantt-axis";
import { daysBetween, startOfDayUTC } from "./gantt-date";
import {
  computeRange,
  DAY_PX_BY_ZOOM,
  HEADER_HEIGHT,
  LEFT_COL_WIDTH,
  ROW_HEIGHT,
} from "./gantt-geometry";
import { GanttScheduledRow } from "./gantt-row";

/**
 * Suite TaskSurface gantt mode — timeline renderer. The surface applies
 * `ganttCanvasRows` before handing tasks over; this view only orders + draws.
 */
export function GanttView({ tasks }: { tasks: Task[] }) {
  const { t } = useTranslation();
  const zoom = useViewStore((s) => s.ganttZoom);
  const showCompleted = useViewStore((s) => s.ganttShowCompleted);
  const sortBy = useViewStore((s) => s.sortBy);
  const sortDirection = useViewStore((s) => s.sortDirection);
  const act = useViewStoreApi().getState();

  const today = useMemo(() => startOfDayUTC(new Date()), []);
  const dayPx = DAY_PX_BY_ZOOM[zoom];

  const scheduled = useMemo(() => {
    const sortField = sortBy === "position" ? "start_date" : sortBy;
    return sortTasksForTable(tasks, sortField, sortDirection);
  }, [tasks, sortBy, sortDirection]);

  const range = useMemo(
    () => computeRange(scheduled, today, zoom),
    [scheduled, today, zoom],
  );
  const totalDays = daysBetween(range.start, range.end);
  const timelineWidth = totalDays * dayPx;
  const todayOffsetDays = daysBetween(range.start, today);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const target = Math.max(0, LEFT_COL_WIDTH + todayOffsetDays * dayPx - 240);
    el.scrollLeft = target;
  }, [todayOffsetDays, dayPx]);

  if (scheduled.length === 0) {
    return (
      <div
        className="flex min-h-0 flex-1 items-center justify-center text-body text-muted-foreground"
        data-testid="gantt-empty"
      >
        {t("tasks.gantt.empty")}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="gantt-view">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b px-3">
        <div className="inline-flex items-center rounded-md border border-foreground/10 p-0.5">
          {(
            [
              { value: "day" as const, label: t("tasks.gantt.zoom_day") },
              { value: "week" as const, label: t("tasks.gantt.zoom_week") },
              { value: "month" as const, label: t("tasks.gantt.zoom_month") },
            ] satisfies { value: GanttZoom; label: string }[]
          ).map((opt) => (
            <Button
              key={opt.value}
              size="sm"
              variant={zoom === opt.value ? "secondary" : "ghost"}
              className={cn(
                "h-6 px-2 text-caption",
                zoom !== opt.value && "text-muted-foreground",
              )}
              onClick={() => act.setGanttZoom(opt.value)}
            >
              {opt.label}
            </Button>
          ))}
        </div>
        <div className="flex-1" />
        <Button
          size="sm"
          variant={showCompleted ? "secondary" : "outline"}
          className={cn(
            "h-7 text-caption",
            !showCompleted && "text-muted-foreground",
          )}
          onClick={act.toggleGanttShowCompleted}
        >
          {t("tasks.gantt.show_completed")}
        </Button>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
        <div style={{ minWidth: LEFT_COL_WIDTH + timelineWidth }}>
          <div className="sticky top-0 z-20 flex">
            <div
              className="sticky left-0 z-30 shrink-0 border-b border-r bg-background"
              style={{ width: LEFT_COL_WIDTH, height: HEADER_HEIGHT }}
            >
              <div className="flex h-full items-end px-3 pb-1.5 text-micro font-medium text-muted-foreground">
                {t("tasks.gantt.header_task")}
              </div>
            </div>
            <GanttAxis
              range={range}
              dayPx={dayPx}
              zoom={zoom}
              todayOffsetDays={todayOffsetDays}
              width={timelineWidth}
            />
          </div>

          <div className="relative">
            <div
              className="pointer-events-none absolute top-0"
              style={{ left: LEFT_COL_WIDTH, width: timelineWidth }}
            >
              <GanttBackgroundLayer
                range={range}
                dayPx={dayPx}
                height={scheduled.length * ROW_HEIGHT}
                todayOffsetDays={todayOffsetDays}
              />
            </div>
            {scheduled.map((row) => (
              <GanttScheduledRow
                key={row.id}
                task={row}
                range={range}
                dayPx={dayPx}
                totalDays={totalDays}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
