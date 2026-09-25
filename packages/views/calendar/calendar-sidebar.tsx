"use client";

import { Draggable } from "@fullcalendar/interaction";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, GripVertical, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import type {
  CalendarSidebar,
  CalendarSidebarMeeting,
  CalendarSidebarTask,
} from "@uniwork/core/calendar/types";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@uniwork/ui/components/ui/collapsible";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { cn } from "@uniwork/ui/lib/utils";
import { PriorityFlag } from "../tasks/modes/status-pill";

export const EMPTY_CALENDAR_SIDEBAR: CalendarSidebar = {
  priorities: [],
  meetWith: [],
  assigned: [],
  todayOverdue: [],
  backlog: [],
};

type CalendarSidebarProps = {
  workspaceId: string;
  viewerTimeZone?: string;
  sections: CalendarSidebar;
  isPending?: boolean;
  isError?: boolean;
  onRetry: () => void;
  onOpenTask: (id: string, source?: HTMLElement) => void;
  onOpenMeeting: (id: string) => void;
  onCreateMeeting: () => void;
  onQuickCreate: () => void;
};

type TaskSectionKey = "priorities" | "assigned" | "todayOverdue" | "backlog";

const TASK_SECTIONS: {
  key: TaskSectionKey;
  titleKey: string;
  emptyKey: string;
}[] = [
  {
    key: "priorities",
    titleKey: "calendar.sidebar_priorities",
    emptyKey: "calendar.sidebar_empty_priorities",
  },
  {
    key: "assigned",
    titleKey: "calendar.sidebar_assigned",
    emptyKey: "calendar.sidebar_empty_assigned",
  },
  {
    key: "todayOverdue",
    titleKey: "calendar.sidebar_today_overdue",
    emptyKey: "calendar.sidebar_empty_today_overdue",
  },
  {
    key: "backlog",
    titleKey: "calendar.sidebar_backlog",
    emptyKey: "calendar.sidebar_empty_backlog",
  },
];

function formatDueLabel(dueDate: string | undefined, locale: string): string | null {
  if (!dueDate) return null;
  try {
    const [year, month, day] = dueDate.split("-").map(Number);
    if (!year || !month || !day) return dueDate;
    const localDate = new Date(year, month - 1, day);
    if (
      localDate.getFullYear() !== year ||
      localDate.getMonth() !== month - 1 ||
      localDate.getDate() !== day
    ) {
      return dueDate;
    }
    return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }).format(
      localDate,
    );
  } catch {
    return dueDate;
  }
}

function formatMeetingWhen(startsAt: string, locale: string, timeZone?: string): string {
  try {
    const starts = new Date(startsAt);
    const date = new Intl.DateTimeFormat(locale, {
      weekday: "short",
      day: "numeric",
      month: "short",
      timeZone,
    }).format(starts);
    const time = new Intl.DateTimeFormat(locale, {
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      timeZone,
    }).format(starts);
    return `${date} · ${time}`;
  } catch {
    return startsAt;
  }
}

function SidebarTaskRow({
  task,
  onOpen,
}: {
  task: CalendarSidebarTask;
  onOpen: (source: HTMLElement) => void;
}) {
  const { t, i18n } = useTranslation();
  const dueLabel = formatDueLabel(task.dueDate, i18n.resolvedLanguage ?? i18n.language);
  return (
    <li className="min-w-0 rounded-md">
      <button
        type="button"
        data-calendar-external-task
        data-task-id={task.id}
        data-task-title={task.title}
        aria-label={t("calendar.sidebar_task_open_to_schedule", {
          title: task.title,
        })}
        title={t("calendar.sidebar_task_drag_handle", { title: task.title })}
        className="fc-event flex min-h-8 w-full min-w-0 cursor-grab items-center rounded-md px-1 py-1.5 text-left text-body hover:bg-surface-hover active:cursor-grabbing [@media(pointer:coarse)]:min-h-11"
        onClick={(event) => onOpen(event.currentTarget)}
      >
        <GripVertical
          className="mr-1 size-3.5 shrink-0 text-muted-foreground"
          aria-hidden
        />
        <span className="min-w-0 flex-1 truncate text-foreground">{task.title}</span>
        <span className="flex shrink-0 items-center gap-1.5">
          {task.priority ? (
            <PriorityFlag priority={task.priority} className="size-3.5" />
          ) : null}
          {dueLabel ? (
            <time
              dateTime={task.dueDate}
              className="text-caption tabular-nums text-muted-foreground"
            >
              {dueLabel}
            </time>
          ) : null}
        </span>
      </button>
    </li>
  );
}

function SidebarMeetingRow({
  meeting,
  viewerTimeZone,
  onOpen,
}: {
  meeting: CalendarSidebarMeeting;
  viewerTimeZone?: string;
  onOpen: () => void;
}) {
  const { i18n } = useTranslation();
  return (
    <li>
      <button
        type="button"
        className="flex w-full min-w-0 flex-col gap-0.5 rounded-md px-2 py-1.5 text-left hover:bg-surface-hover"
        onClick={onOpen}
      >
        <span className="truncate text-body text-foreground">{meeting.title}</span>
        <time
          dateTime={meeting.startsAt}
          className="text-caption tabular-nums text-muted-foreground"
        >
          {formatMeetingWhen(
            meeting.startsAt,
            i18n.resolvedLanguage ?? i18n.language,
            viewerTimeZone,
          )}
        </time>
      </button>
    </li>
  );
}

function SidebarSection({
  title,
  count,
  emptyCopy,
  defaultOpen = true,
  headerAction,
  children,
}: {
  title: string;
  count: number;
  emptyCopy: string;
  defaultOpen?: boolean;
  headerAction?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="border-b border-border pb-2">
      <div className="flex items-center gap-1">
        <CollapsibleTrigger className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-1.5 text-left hover:bg-surface-hover">
          <ChevronDown
            aria-hidden
            className={cn(
              "size-4 shrink-0 text-muted-foreground transition-transform",
              !open && "-rotate-90",
            )}
          />
          <span className="min-w-0 flex-1 truncate text-caption font-medium text-foreground">
            {title}
          </span>
          <span className="text-caption tabular-nums text-muted-foreground">{count}</span>
        </CollapsibleTrigger>
        {headerAction}
      </div>
      <CollapsibleContent>
        {count === 0 ? (
          <p className="px-2 py-3 text-caption text-muted-foreground">{emptyCopy}</p>
        ) : (
          children
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

function TaskListSection({
  titleKey,
  emptyKey,
  tasks,
  onOpenTask,
}: {
  titleKey: string;
  emptyKey: string;
  tasks: CalendarSidebarTask[];
  onOpenTask: (id: string, source?: HTMLElement) => void;
}) {
  const { t } = useTranslation();
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const root = listRef.current;
    if (!root || tasks.length === 0) {
      return;
    }

    const draggable = new Draggable(root, {
      itemSelector: "[data-calendar-external-task]",
      eventData(eventEl) {
        const taskId = eventEl.getAttribute("data-task-id") ?? "";
        const title = eventEl.getAttribute("data-task-title") ?? "";
        return {
          title,
          duration: { days: 1 },
          extendedProps: { uniworkTaskId: taskId },
        };
      },
    });

    return () => {
      draggable.destroy();
    };
  }, [tasks]);

  return (
    <SidebarSection title={t(titleKey)} count={tasks.length} emptyCopy={t(emptyKey)}>
      <ul ref={listRef} className="space-y-0.5">
        {tasks.map((task) => (
          <SidebarTaskRow
            key={task.id}
            task={task}
            onOpen={(source) => onOpenTask(task.id, source)}
          />
        ))}
      </ul>
    </SidebarSection>
  );
}

export function CalendarSidebar({
  sections,
  viewerTimeZone,
  isPending,
  isError,
  onRetry,
  onOpenTask,
  onOpenMeeting,
  onCreateMeeting,
  onQuickCreate,
}: CalendarSidebarProps) {
  const { t } = useTranslation();

  return (
    <aside
      className="flex w-72 shrink-0 flex-col border-r border-border bg-background"
      aria-label={t("calendar.sidebar_label")}
    >
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-border px-3">
        <span className="truncate text-label font-medium text-foreground">
          {t("calendar.planner_title")}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="shrink-0 text-muted-foreground"
          aria-label={t("calendar.create_item")}
          onClick={onQuickCreate}
        >
          <Plus aria-hidden className="size-4" />
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-3">
        {isPending ? (
          <>
            <p className="sr-only">{t("calendar.sidebar_loading")}</p>
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </>
        ) : null}
        {isError ? (
          <div className="flex flex-col items-start gap-3 px-2 py-3" role="alert">
            <p className="text-caption text-muted-foreground">
              {t("calendar.sidebar_error")}
            </p>
            <Button type="button" size="sm" variant="outline" onClick={onRetry}>
              {t("calendar.retry")}
            </Button>
          </div>
        ) : null}
        {!isPending && !isError ? (
          <>
            <TaskListSection
              titleKey="calendar.sidebar_priorities"
              emptyKey="calendar.sidebar_empty_priorities"
              tasks={sections.priorities}
              onOpenTask={onOpenTask}
            />
            <SidebarSection
              title={t("calendar.sidebar_meet_with")}
              count={sections.meetWith.length}
              emptyCopy={t("calendar.sidebar_empty_meet_with")}
              headerAction={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="shrink-0 text-muted-foreground"
                  aria-label={t("calendar.create_meeting")}
                  onClick={onCreateMeeting}
                >
                  <Plus className="size-3.5" aria-hidden />
                </Button>
              }
            >
              <ul className="space-y-0.5">
                {sections.meetWith.map((meeting) => (
                  <SidebarMeetingRow
                    key={meeting.id}
                    meeting={meeting}
                    viewerTimeZone={viewerTimeZone}
                    onOpen={() => onOpenMeeting(meeting.id)}
                  />
                ))}
              </ul>
            </SidebarSection>
            {TASK_SECTIONS.filter((s) => s.key !== "priorities").map(({ key, titleKey, emptyKey }) => (
              <TaskListSection
                key={key}
                titleKey={titleKey}
                emptyKey={emptyKey}
                tasks={sections[key]}
                onOpenTask={onOpenTask}
              />
            ))}
          </>
        ) : null}
      </div>
    </aside>
  );
}
