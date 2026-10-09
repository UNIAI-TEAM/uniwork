"use client";

import { Draggable } from "@fullcalendar/interaction";
import {
  CalendarClock,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  RotateCw,
  Search,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { CalendarEvent } from "@uniwork/core/calendar/types";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandTextInput,
} from "@uniwork/ui/components/ui/command";
import {
  UI_EASE_OUT,
  UI_MOTION_DISTANCE,
  UI_MOTION_DURATION,
} from "@uniwork/ui/lib/motion";
import { cn } from "@uniwork/ui/lib/utils";
import type { CalendarViewMode } from "./calendar-view-mode";
import { MODULE_ICONS } from "../layout/module-icons";

export type CalendarSearchTask = {
  id: string;
  identifier?: string;
  title: string;
  status: string;
  dueDate?: string;
};

type CalendarFloatingSearchProps = {
  tasks: CalendarSearchTask[];
  events: CalendarEvent[];
  viewMode: CalendarViewMode;
  showWeekends: boolean;
  viewerTimeZone: string;
  onOpenTask: (id: string, source?: HTMLElement) => void;
  onOpenEvent: (event: CalendarEvent, source?: HTMLElement) => void;
  onGoToday: () => void;
  onPreviousPeriod: () => void;
  onNextPeriod: () => void;
  onRefresh: () => void;
  onShowWeekendsChange: (next: boolean) => void;
  onViewModeChange: (mode: CalendarViewMode) => void;
};

type CalendarCommand = {
  id: string;
  label: string;
  keywords: string;
  icon: typeof CalendarDays;
  action: () => void;
};

const RESULT_LIMIT = 8;
const SUGGESTED_COMMANDS = new Set(["today", "previous", "next", "refresh"]);

const VIEW_KEYWORDS: Record<CalendarViewMode, string> = {
  day: "day ngay",
  work_week: "work week tuan lam viec",
  week: "week tuan",
  month: "month thang",
};

function searchable(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLocaleLowerCase();
}

function formatWhen(
  event: CalendarEvent,
  locale: string,
  timeZone: string,
  allDayLabel: string,
): string {
  try {
    const date = new Date(event.start);
    const day = new Intl.DateTimeFormat(locale, {
      weekday: "short",
      day: "numeric",
      month: "short",
      timeZone,
    }).format(date);
    if (event.allDay) return `${day} · ${allDayLabel}`;
    const time = new Intl.DateTimeFormat(locale, {
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      timeZone,
    }).format(date);
    return `${day} · ${time}`;
  } catch {
    return event.start;
  }
}

function formatDueDate(value: string | undefined, locale: string): string | null {
  if (!value) return null;
  try {
    const [year, month, day] = value.split("-").map(Number);
    if (!year || !month || !day) return value;
    return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }).format(
      new Date(year, month - 1, day),
    );
  } catch {
    return value;
  }
}

export function CalendarFloatingSearch({
  tasks,
  events,
  viewMode,
  showWeekends,
  viewerTimeZone,
  onOpenTask,
  onOpenEvent,
  onGoToday,
  onPreviousPeriod,
  onNextPeriod,
  onRefresh,
  onShowWeekendsChange,
  onViewModeChange,
}: CalendarFloatingSearchProps) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const reduceMotion = useReducedMotion() ?? false;
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const normalizedQuery = searchable(query.trim());

  const close = () => {
    setOpen(false);
    setQuery("");
  };

  const run = (action: () => void) => {
    close();
    action();
  };

  const commands = useMemo<CalendarCommand[]>(
    () => [
      {
        id: "today",
        label: t("calendar.search_today"),
        keywords: "today hom nay",
        icon: CalendarDays,
        action: onGoToday,
      },
      {
        id: "previous",
        label: t("calendar.search_previous"),
        keywords: "previous prev truoc",
        icon: ChevronLeft,
        action: onPreviousPeriod,
      },
      {
        id: "next",
        label: t("calendar.search_next"),
        keywords: "next sau",
        icon: ChevronRight,
        action: onNextPeriod,
      },
      ...(["day", "work_week", "week", "month"] as const).map((mode) => ({
        id: `view-${mode}`,
        label: t(`calendar.search_view_${mode}`),
        keywords: `${VIEW_KEYWORDS[mode]} view xem`,
        icon: CalendarClock,
        action: () => onViewModeChange(mode),
      })),
      {
        id: "weekends",
        label: t(showWeekends ? "calendar.search_hide_weekends" : "calendar.search_show_weekends"),
        keywords: "weekend cuoi tuan an hien",
        icon: showWeekends ? EyeOff : Eye,
        action: () => onShowWeekendsChange(!showWeekends),
      },
      {
        id: "refresh",
        label: t("calendar.refresh"),
        keywords: "refresh reload lam moi",
        icon: RotateCw,
        action: onRefresh,
      },
    ],
    [
      onGoToday,
      onNextPeriod,
      onPreviousPeriod,
      onRefresh,
      onShowWeekendsChange,
      onViewModeChange,
      showWeekends,
      t,
    ],
  );

  const visibleCommands = useMemo(
    () =>
      commands.filter((command) =>
        normalizedQuery
          ? searchable(`${command.label} ${command.keywords}`).includes(normalizedQuery)
          : SUGGESTED_COMMANDS.has(command.id),
      ),
    [commands, normalizedQuery],
  );
  const visibleTasks = useMemo(
    () =>
      normalizedQuery
        ? tasks
            .filter((task) =>
              searchable(`${task.identifier ?? ""} ${task.title} ${task.status}`).includes(
                normalizedQuery,
              ),
            )
            .slice(0, RESULT_LIMIT)
        : [],
    [normalizedQuery, tasks],
  );
  const visibleEvents = useMemo(
    () =>
      events
        .filter((event) =>
          normalizedQuery
            ? searchable(event.title).includes(normalizedQuery)
            : new Date(event.start).getTime() >= new Date().setHours(0, 0, 0, 0),
        )
        .sort((left, right) => left.start.localeCompare(right.start))
        .slice(0, RESULT_LIMIT),
    [events, normalizedQuery],
  );

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close();
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  useEffect(() => {
    const root = resultsRef.current;
    if (!open || !root || visibleTasks.length === 0) return;
    const draggable = new Draggable(root, {
      itemSelector: "[data-calendar-external-task]",
      eventData(eventEl) {
        return {
          title: eventEl.getAttribute("data-task-title") ?? "",
          duration: { days: 1 },
          extendedProps: {
            uniworkTaskId: eventEl.getAttribute("data-task-id") ?? "",
          },
        };
      },
    });
    return () => draggable.destroy();
  }, [open, visibleTasks]);

  const hasResults =
    visibleCommands.length > 0 || visibleTasks.length > 0 || visibleEvents.length > 0;

  return (
    <div
      ref={rootRef}
      className="pointer-events-none absolute inset-x-0 bottom-8 z-30 flex justify-center px-4"
    >
      <motion.button
        ref={triggerRef}
        type="button"
        aria-label={t("calendar.search_open")}
        initial={false}
        animate={{ opacity: open ? 0 : 1, y: open && !reduceMotion ? 4 : 0 }}
        transition={{
          duration: UI_MOTION_DURATION.fast,
          ease: UI_EASE_OUT,
        }}
        className={cn(
          "pointer-events-auto flex h-11 w-full max-w-sm items-center gap-2.5 rounded-lg border border-border/80 bg-background/95 px-3.5 text-left shadow-floating backdrop-blur-sm",
          "transition-colors hover:border-foreground/15 hover:bg-background",
          open && "pointer-events-none invisible",
        )}
        onClick={() => setOpen(true)}
      >
        <Search aria-hidden className="size-4 text-foreground/70" />
        <span className="min-w-0 flex-1 truncate text-body text-foreground/75">
          {t("calendar.search_placeholder")}
        </span>
        <span className="flex items-center gap-1.5 text-caption text-muted-foreground">
          <CalendarDays aria-hidden className="size-3.5" />
          {t("calendar.search_scope")}
        </span>
      </motion.button>

      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            key="calendar-floating-search"
            initial={{
              opacity: 0,
              y: reduceMotion ? 0 : UI_MOTION_DISTANCE.subtle,
            }}
            animate={{ opacity: 1, y: 0 }}
            exit={{
              opacity: 0,
              y: reduceMotion ? 0 : UI_MOTION_DISTANCE.subtle,
            }}
            transition={{
              duration: UI_MOTION_DURATION.fast,
              ease: UI_EASE_OUT,
            }}
            className="pointer-events-auto absolute bottom-0 w-[min(30rem,calc(100%-2rem))] overflow-hidden rounded-lg border border-border/80 bg-popover text-popover-foreground shadow-floating"
          >
          <Command
            label={t("calendar.search_input_label")}
            shouldFilter={false}
            className="rounded-none p-0"
          >
            <div className="flex items-center justify-between gap-3 border-b border-border/70 px-3.5 py-2.5">
              <div className="flex min-w-0 items-center gap-2">
                <CalendarDays aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                <span className="truncate text-label font-medium text-foreground">
                  {t("calendar.search_title")}
                </span>
              </div>
              <span className="shrink-0 text-caption text-muted-foreground">
                {t("calendar.search_navigation_hint")}
              </span>
            </div>
            <div ref={resultsRef}>
              <CommandList className="max-h-[min(20rem,48vh)] p-1.5">
                {!hasResults ? (
                  <CommandEmpty>{t("calendar.search_empty")}</CommandEmpty>
                ) : null}
                {visibleEvents.length > 0 ? (
                  <CommandGroup
                    heading={t(normalizedQuery ? "calendar.search_events" : "calendar.search_up_next")}
                    className="[&_[cmdk-group-items]]:space-y-0.5"
                  >
                    {visibleEvents.map((event) => {
                      const Icon = event.kind === "task" ? MODULE_ICONS.tasks : MODULE_ICONS.meetings;
                      return (
                        <CommandItem
                          key={event.id}
                          value={`event-${event.id}`}
                          className="min-h-10 rounded-md px-2.5 py-2 data-[selected=true]:bg-surface-hover"
                          onSelect={() =>
                            run(() => onOpenEvent(event, triggerRef.current ?? undefined))
                          }
                        >
                          <Icon aria-hidden />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate">{event.title}</span>
                            <span className="block truncate text-caption text-muted-foreground">
                              {formatWhen(
                                event,
                                locale,
                                viewerTimeZone,
                                t("calendar.all_day"),
                              )}
                            </span>
                          </span>
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                ) : null}
                {visibleTasks.length > 0 ? (
                  <CommandGroup
                    heading={t("calendar.search_tasks")}
                    className="[&_[cmdk-group-items]]:space-y-0.5"
                  >
                    {visibleTasks.map((task) => {
                      const due = formatDueDate(task.dueDate, locale);
                      const statusKey = `tasks.status_${task.status}`;
                      const statusLabel = t(statusKey, { defaultValue: task.status });
                      return (
                        <CommandItem
                          key={task.id}
                          value={`task-${task.id}`}
                          data-calendar-external-task
                          data-task-id={task.id}
                          data-task-title={task.title}
                          className="fc-event min-h-10 cursor-grab rounded-md px-2.5 py-2 data-[selected=true]:bg-surface-hover active:cursor-grabbing"
                          onSelect={() =>
                            run(() => onOpenTask(task.id, triggerRef.current ?? undefined))
                          }
                        >
                          <MODULE_ICONS.tasks aria-hidden />
                          <span className="min-w-0 flex-1">
                            <span className="flex min-w-0 items-center gap-2">
                              {task.identifier ? (
                                <span className="shrink-0 text-caption text-muted-foreground">
                                  {task.identifier}
                                </span>
                              ) : null}
                              <span className="truncate">{task.title}</span>
                            </span>
                            <span className="block truncate text-caption text-muted-foreground">
                              {due
                                ? t("calendar.search_task_due", { status: statusLabel, due })
                                : statusLabel}
                            </span>
                          </span>
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                ) : null}
                {visibleCommands.length > 0 ? (
                  <CommandGroup
                    heading={t("calendar.search_commands")}
                    className="[&_[cmdk-group-items]]:space-y-0.5"
                  >
                    {visibleCommands.map((command) => {
                      const Icon = command.icon;
                      return (
                        <CommandItem
                          key={command.id}
                          value={`command-${command.id}`}
                          className="min-h-9 rounded-md px-2.5 data-[selected=true]:bg-surface-hover"
                          onSelect={() => run(command.action)}
                        >
                          <Icon aria-hidden />
                          <span>{command.label}</span>
                          {command.id === `view-${viewMode}` ? (
                            <span className="ml-auto text-caption text-muted-foreground">
                              {t("calendar.search_current")}
                            </span>
                          ) : null}
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                ) : null}
              </CommandList>
            </div>
            <CommandSeparator className="mx-0" />
            <div className="flex h-12 items-center gap-2.5 bg-muted/25 px-3.5">
              <Search aria-hidden className="size-4 shrink-0 text-foreground/65" />
              <CommandTextInput
                autoFocus
                aria-label={t("calendar.search_input_label")}
                placeholder={t("calendar.search_placeholder")}
                value={query}
                onValueChange={setQuery}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    close();
                  }
                }}
              />
              <span className="shrink-0 text-caption text-muted-foreground">
                {t("calendar.search_escape_hint")}
              </span>
            </div>
          </Command>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
