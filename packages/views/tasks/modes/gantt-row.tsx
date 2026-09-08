"use client";

import { useTranslation } from "react-i18next";
import { capabilityState } from "@uniwork/core/capabilities";
import { usePublicConfig } from "@uniwork/core/feature-flags";
import type { Task, TaskStatus } from "@uniwork/core/types";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@uniwork/ui/components/ui/tooltip";
import { cn } from "@uniwork/ui/lib/utils";
import { dateOnlyToUTCDate } from "./gantt-date";
import {
  barGeometry,
  LEFT_COL_WIDTH,
  ROW_HEIGHT,
  STATUS_BAR_BG,
  type GanttRange,
} from "./gantt-geometry";

const EMPTY_CONFIG = {
  flags: {},
  rum_sample_rate: 0,
  work_management_capabilities: {},
} as const;

export function GanttScheduledRow({
  task,
  range,
  dayPx,
  totalDays,
}: {
  task: Task;
  range: GanttRange;
  dayPx: number;
  totalDays: number;
}) {
  const { t, i18n } = useTranslation();
  const { data: publicConfig } = usePublicConfig();
  const agentCapability = capabilityState(
    publicConfig ?? EMPTY_CONFIG,
    "tasks.agent_runs",
  );
  const agentAvailable = agentCapability.status === "available";

  const start = dateOnlyToUTCDate(task.start_date);
  const due = dateOnlyToUTCDate(task.due_date);
  const bar = barGeometry(task, range, dayPx, totalDays);
  const statusBg =
    STATUS_BAR_BG[task.status as TaskStatus] ?? STATUS_BAR_BG.todo;

  const fmt = (d: Date) =>
    d.toLocaleDateString(i18n.language, {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    });

  return (
    <div
      className="flex border-b border-foreground/5 transition-colors hover:bg-accent/30"
      style={{ height: ROW_HEIGHT }}
      data-testid={`gantt-row-${task.id}`}
    >
      <div
        className="sticky left-0 z-[1] flex min-w-0 shrink-0 items-center gap-2 border-r bg-background px-3 text-body"
        style={{ width: LEFT_COL_WIDTH }}
      >
        <span className="w-14 shrink-0 truncate text-caption tabular-nums text-muted-foreground">
          {task.identifier || "—"}
        </span>
        <span className="min-w-0 flex-1 truncate">{task.title}</span>
        <span
          className={cn(
            "shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-micro text-muted-foreground",
            !agentAvailable && "cursor-not-allowed opacity-60",
          )}
          title={
            agentAvailable
              ? undefined
              : t(agentCapability.explanation_key || "capabilities.unknown")
          }
          aria-disabled={!agentAvailable}
        >
          {t("tasks.surface.agent_chip_stub")}
        </span>
      </div>
      <div className="relative shrink-0" style={{ width: totalDays * dayPx }}>
        {bar ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <div
                  className={cn(
                    "absolute top-1/2 -translate-y-1/2 transition-opacity hover:opacity-90",
                    bar.isMarker
                      ? "h-3 w-3 rotate-45 rounded-[2px]"
                      : "h-5 rounded-md",
                    statusBg,
                    bar.inverted &&
                      "ring-2 ring-destructive ring-offset-1 ring-offset-background",
                  )}
                  style={{ left: bar.left, width: bar.width }}
                />
              }
            >
              {!bar.isMarker && bar.width > 60 ? (
                <span className="block truncate px-2 py-[2px] text-micro leading-4 text-white">
                  {task.title}
                </span>
              ) : null}
            </TooltipTrigger>
            <TooltipContent side="top">
              <div className="flex flex-col gap-0.5 text-caption">
                <span className="font-medium">{task.title}</span>
                <span className="text-muted-foreground">
                  {start ? fmt(start) : "—"} → {due ? fmt(due) : "—"}
                </span>
                {bar.inverted ? (
                  <span className="text-destructive">
                    {t("tasks.gantt.inverted_dates_warning")}
                  </span>
                ) : null}
              </div>
            </TooltipContent>
          </Tooltip>
        ) : null}
      </div>
    </div>
  );
}
