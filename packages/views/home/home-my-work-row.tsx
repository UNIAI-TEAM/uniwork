"use client";

import { AlarmClock, CalendarClock, CalendarDays, CircleCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { overdueDays } from "@uniwork/core/home/brief";
import type { Task } from "@uniwork/core/types";
import { Button } from "@uniwork/ui/components/ui/button";
import { Checkbox } from "@uniwork/ui/components/ui/checkbox";
import { cn } from "@uniwork/ui/lib/utils";
import { meetingLocale } from "../meetings/meeting-datetime";
import { AppLink } from "../navigation";
import { PriorityFlag } from "../tasks/modes/status-pill";

const PRIORITIES = new Set(["low", "medium", "high", "urgent"]);

const DUE_CHIP = "inline-flex items-center gap-1 rounded-md px-1.5 py-px text-micro font-medium [&_svg]:size-3";

function formatDay(date: string, locale: string): string {
  const d = new Date(`${date}T12:00:00`);
  if (Number.isNaN(d.getTime())) return date;
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }).format(d);
}

export interface HomeMyWorkRowProps {
  task: Task;
  today: string;
  href: string;
  checked: boolean;
  completing: boolean;
  onCheckedChange: (task: Task, checked: boolean) => void;
  onComplete: (task: Task) => void;
}

/**
 * One open task: select box, title linking to the task, identifier, due state
 * and priority, and a complete button that stays out of sight until the row
 * is hovered or focused. A selected row takes the selection tint. A plain
 * list item: the keyboard model
 * lives on the list and moves real focus to this row's link, so every control
 * here keeps its own role. A row completed here stays, dimmed, until the
 * summary refetch takes it away.
 */
export function HomeMyWorkRow({ task, today, href, checked, completing, onCheckedChange, onComplete }: HomeMyWorkRowProps) {
  const { t, i18n } = useTranslation();
  const done = task.status === "done";
  const late = overdueDays(today, task.due_date);
  const dueState = done || !task.due_date ? "plain" : late > 0 ? "overdue" : task.due_date === today ? "today" : "later";
  const due = !task.due_date
    ? t("home.mywork.no_due")
    : late > 0
      ? t("home.mywork.overdue", { count: late })
      : task.due_date === today
        ? t("home.mywork.due_today")
        : t("home.mywork.due_on", { date: formatDay(task.due_date, meetingLocale(i18n.language)) });

  return (
    <li
      data-task-id={task.id}
      className={cn(
        "group/row flex min-h-14 items-center gap-3 border-b border-border px-4 py-2 transition-colors duration-150 last:border-b-0",
        checked ? "bg-brand-subtle" : "hover:bg-surface-hover focus-within:bg-surface-selected",
        (done || completing) && "opacity-60",
      )}
    >
      <Checkbox
        checked={checked}
        disabled={done}
        onCheckedChange={(value) => onCheckedChange(task, value === true)}
        aria-label={t("home.mywork.select_task", { title: task.title })}
      />
      <AppLink href={href} className="min-w-0 flex-1 rounded-sm">
        <span className={cn("line-clamp-2 text-body font-medium text-pretty text-foreground", done && "text-muted-foreground line-through")}>
          {task.title}
        </span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-muted-foreground">
          {task.identifier ? <span className="font-mono tabular-nums">{task.identifier}</span> : null}
          {dueState === "overdue" ? (
            <span className={cn(DUE_CHIP, "bg-destructive-soft text-destructive-soft-foreground")}>
              <AlarmClock aria-hidden />
              {due}
            </span>
          ) : dueState === "today" ? (
            <span className={cn(DUE_CHIP, "bg-warning-soft text-warning-soft-foreground")}>
              <CalendarClock aria-hidden />
              {due}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1">
              {task.due_date ? <CalendarDays aria-hidden className="size-3" /> : null}
              {due}
            </span>
          )}
          {PRIORITIES.has(task.priority) ? <PriorityFlag priority={task.priority} withLabel /> : null}
        </span>
      </AppLink>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={done || completing}
        onClick={() => onComplete(task)}
        aria-label={done ? t("home.mywork.completed") : t("home.mywork.complete_task", { title: task.title })}
        // One quiet control per row instead of a column of repeated labels: it
        // shows on hover or focus with a fine pointer, always on touch.
        className={cn(
          "text-muted-foreground transition-opacity duration-150 hover:bg-success-soft hover:text-success-soft-foreground",
          !done && "opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100 pointer-coarse:opacity-100",
        )}
      >
        <CircleCheck aria-hidden />
        <span className="hidden @xl:inline">{done ? t("home.mywork.completed") : t("home.mywork.complete")}</span>
      </Button>
    </li>
  );
}
