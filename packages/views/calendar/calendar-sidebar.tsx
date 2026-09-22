"use client";

import { Draggable } from "@fullcalendar/interaction";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, Plus } from "lucide-react";
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
import { format, parseISO } from "date-fns";
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
  sections: CalendarSidebar;
  isPending?: boolean;
  isError?: boolean;
  onOpenTask: (id: string) => void;
  onOpenMeeting: (id: string) => void;
  onCreateMeeting: () => void;
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

function formatDueLabel(dueDate: string | undefined): string | null {
  if (!dueDate) return null;
  try {
    return format(parseISO(dueDate), "d MMM");
  } catch {
    return dueDate;
  }
}

function formatMeetingWhen(startsAt: string): string {
  try {
    return format(parseISO(startsAt), "EEE d MMM · HH:mm");
  } catch {
    return startsAt;
  }
}

function SidebarTaskRow({
  task,
  onOpen,
}: {
  task: CalendarSidebarTask;
  onOpen: () => void;
}) {
  const dueLabel = formatDueLabel(task.dueDate);
  return (
    <li
      data-calendar-external-task
      data-task-id={task.id}
      data-task-title={task.title}
      className="fc-event cursor-grab active:cursor-grabbing"
    >
      <button
        type="button"
        className="flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-body hover:bg-surface-hover"
        onClick={onOpen}
      >
        <span className="min-w-0 flex-1 truncate text-foreground">{task.title}</span>
        <span className="flex shrink-0 items-center gap-1.5">
          {task.priority ? (
            <PriorityFlag priority={task.priority} className="size-3.5" />
          ) : null}
          {dueLabel ? (
            <span className="text-caption tabular-nums text-muted-foreground">{dueLabel}</span>
          ) : null}
        </span>
      </button>
    </li>
  );
}

function SidebarMeetingRow({
  meeting,
  onOpen,
}: {
  meeting: CalendarSidebarMeeting;
  onOpen: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        className="flex w-full min-w-0 flex-col gap-0.5 rounded-md px-2 py-1.5 text-left hover:bg-surface-hover"
        onClick={onOpen}
      >
        <span className="truncate text-body text-foreground">{meeting.title}</span>
        <span className="text-caption text-muted-foreground">
          {formatMeetingWhen(meeting.startsAt)}
        </span>
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
  onOpenTask: (id: string) => void;
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
          <SidebarTaskRow key={task.id} task={task} onOpen={() => onOpenTask(task.id)} />
        ))}
      </ul>
    </SidebarSection>
  );
}

export function CalendarSidebar({
  sections,
  isPending,
  isError,
  onOpenTask,
  onOpenMeeting,
  onCreateMeeting,
}: CalendarSidebarProps) {
  const { t } = useTranslation();

  return (
    <aside
      className="flex w-72 shrink-0 flex-col border-r border-border bg-background"
      aria-label={t("calendar.sidebar_label")}
    >
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
          <p className="px-2 py-3 text-caption text-muted-foreground" role="status">
            {t("calendar.sidebar_error")}
          </p>
        ) : null}
        {!isPending ? (
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
