"use client";

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { GanttZoom } from "@uniwork/core/tasks/stores/view-store-types";
import { cn } from "@uniwork/ui/lib/utils";
import {
  addDays,
  daysBetween,
  isMonthStartUTC,
  isWeekStartUTC,
  isWeekendUTC,
  startOfDayUTC,
} from "./gantt-date";
import { HEADER_HEIGHT, type GanttRange } from "./gantt-geometry";

export function GanttAxis({
  range,
  dayPx,
  zoom,
  todayOffsetDays,
  width,
}: {
  range: GanttRange;
  dayPx: number;
  zoom: GanttZoom;
  todayOffsetDays: number;
  width: number;
}) {
  const { i18n } = useTranslation();
  const locale = i18n.language;
  const totalDays = daysBetween(range.start, range.end);

  const monthBlocks = useMemo(() => {
    const out: { label: string; left: number; width: number }[] = [];
    let cursor = startOfDayUTC(range.start);
    while (cursor.getTime() < range.end.getTime()) {
      const monthEnd = new Date(
        Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1),
      );
      const blockEnd =
        monthEnd.getTime() > range.end.getTime() ? range.end : monthEnd;
      const startDays = daysBetween(range.start, cursor);
      const widthDays = daysBetween(cursor, blockEnd);
      out.push({
        label: cursor.toLocaleDateString(locale, {
          month: "short",
          year: "numeric",
          timeZone: "UTC",
        }),
        left: startDays * dayPx,
        width: widthDays * dayPx,
      });
      cursor = monthEnd;
    }
    return out;
  }, [range, dayPx, locale]);

  return (
    <div
      className="relative shrink-0 border-b bg-background"
      style={{ height: HEADER_HEIGHT, width }}
    >
      <div className="relative h-7 border-b">
        {monthBlocks.map((block, i) => (
          <div
            key={i}
            className="absolute top-0 bottom-0 flex items-center px-2 text-caption font-medium text-foreground"
            style={{ left: block.left, width: block.width }}
          >
            {block.width > 40 ? (
              <span className="truncate">{block.label}</span>
            ) : null}
          </div>
        ))}
      </div>
      <div className="relative h-7">
        {Array.from({ length: totalDays }, (_, i) => {
          const date = addDays(range.start, i);
          const isMonth = isMonthStartUTC(date);
          const isWeek = isWeekStartUTC(date);
          const showLabel =
            zoom === "day" ||
            (zoom === "week" && isWeek) ||
            (zoom === "month" && isMonth);
          return (
            <div
              key={i}
              className={cn(
                "absolute top-0 bottom-0 flex items-center justify-center border-l text-micro text-muted-foreground",
                isMonth
                  ? "border-foreground/15"
                  : isWeek
                    ? "border-foreground/10"
                    : "border-foreground/5",
              )}
              style={{ left: i * dayPx, width: dayPx }}
            >
              {showLabel ? (
                <div className="flex flex-col items-center leading-tight">
                  {zoom === "day" ? (
                    <>
                      <span className="tabular-nums">{date.getUTCDate()}</span>
                      <span className="text-micro">
                        {date.toLocaleDateString(locale, {
                          weekday: "short",
                          timeZone: "UTC",
                        })}
                      </span>
                    </>
                  ) : null}
                  {zoom === "week" ? (
                    <span className="tabular-nums">{date.getUTCDate()}</span>
                  ) : null}
                  {zoom === "month" ? (
                    <span className="whitespace-nowrap tabular-nums">
                      {date.toLocaleDateString(locale, {
                        month: "short",
                        day: "numeric",
                        timeZone: "UTC",
                      })}
                    </span>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
        {todayOffsetDays >= 0 && todayOffsetDays <= totalDays ? (
          <div
            className="absolute top-0 bottom-0 w-px bg-brand"
            style={{ left: todayOffsetDays * dayPx }}
          />
        ) : null}
      </div>
    </div>
  );
}

export function GanttBackgroundLayer({
  range,
  dayPx,
  height,
  todayOffsetDays,
}: {
  range: GanttRange;
  dayPx: number;
  height: number;
  todayOffsetDays: number;
}) {
  const totalDays = daysBetween(range.start, range.end);
  return (
    <div
      className="pointer-events-none absolute inset-0"
      style={{ height, width: totalDays * dayPx }}
    >
      {Array.from({ length: totalDays }, (_, i) => {
        const date = addDays(range.start, i);
        const weekend = isWeekendUTC(date);
        const isMonth = isMonthStartUTC(date);
        const isWeek = isWeekStartUTC(date);
        return (
          <div
            key={i}
            className="absolute top-0 bottom-0"
            style={{ left: i * dayPx, width: dayPx }}
          >
            {weekend ? <div className="absolute inset-0 bg-muted/40" /> : null}
            {isMonth || isWeek ? (
              <div
                className={cn(
                  "absolute top-0 bottom-0 left-0 w-px",
                  isMonth ? "bg-foreground/10" : "bg-foreground/5",
                )}
              />
            ) : null}
          </div>
        );
      })}
      {todayOffsetDays >= 0 && todayOffsetDays <= totalDays ? (
        <div
          className="absolute top-0 bottom-0 w-px bg-brand/70"
          style={{ left: todayOffsetDays * dayPx }}
        />
      ) : null}
    </div>
  );
}
