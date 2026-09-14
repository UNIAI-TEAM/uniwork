"use client";

import { CircleCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { overdueDays } from "@uniwork/core/home/brief";
import type { Task } from "@uniwork/core/types";
import { Button } from "@uniwork/ui/components/ui/button";
import { Checkbox } from "@uniwork/ui/components/ui/checkbox";
import { cn } from "@uniwork/ui/lib/utils";
import { meetingLocale } from "../meetings/meeting-datetime";
import { AppLink } from "../navigation";

const PRIORITY_KEYS: Record<string, string> = {
  low: "tasks.priority_low",
  medium: "tasks.priority_medium",
  high: "tasks.priority_high",
  urgent: "tasks.priority_urgent",
};

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
 * and priority, and a complete button. A plain list item: the keyboard model
 * lives on the list and moves real focus to this row's link, so every control
 * here keeps its own role. A row completed here stays, dimmed, until the
 * summary refetch takes it away.
 */
export function HomeMyWorkRow({ task, today, href, checked, completing, onCheckedChange, onComplete }: HomeMyWorkRowProps) {
  const { t, i18n } = useTranslation();
  const done = task.status === "done";
  const late = overdueDays(today, task.due_date);
  const due = !task.due_date
    ? t("home.mywork.no_due")
    : late > 0
      ? t("home.mywork.overdue", { count: late })
      : task.due_date === today
        ? t("home.mywork.due_today")
        : t("home.mywork.due_on", { date: formatDay(task.due_date, meetingLocale(i18n.language)) });
  const priorityKey = PRIORITY_KEYS[task.priority];

  return (
    <li
      data-task-id={task.id}
      className={cn(
        "flex min-h-12 items-center gap-3 border-b border-border px-4 py-2 last:border-b-0 hover:bg-surface-hover focus-within:bg-surface-selected",
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
        <span className={cn("block truncate text-body font-medium text-foreground", done && "text-muted-foreground line-through")}>
          {task.title}
        </span>
        <span className="flex flex-wrap items-center gap-x-2 text-caption text-muted-foreground">
          {task.identifier ? <span className="font-mono tabular-nums">{task.identifier}</span> : null}
          <span className={cn(late > 0 && !done && "text-destructive")}>{due}</span>
          {priorityKey ? <span>{t(priorityKey)}</span> : null}
        </span>
      </AppLink>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={done || completing}
        onClick={() => onComplete(task)}
        aria-label={done ? t("home.mywork.completed") : t("home.mywork.complete_task", { title: task.title })}
      >
        <CircleCheck aria-hidden />
        <span className="hidden @md:inline">{done ? t("home.mywork.completed") : t("home.mywork.complete")}</span>
      </Button>
    </li>
  );
}
