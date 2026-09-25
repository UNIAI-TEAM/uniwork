"use client";

import type {
  DateSelectArg,
  DatesSetArg,
  DayCellContentArg,
  DayCellMountArg,
  EventClickArg,
  EventDropArg,
} from "@fullcalendar/core";
import enGbCalendarLocale from "@fullcalendar/core/locales/en-gb";
import viCalendarLocale from "@fullcalendar/core/locales/vi";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin, {
  type DateClickArg,
  type EventResizeDoneArg,
} from "@fullcalendar/interaction";
import FullCalendar from "@fullcalendar/react";
import timeGridPlugin from "@fullcalendar/timegrid";
import { ChevronDown, ChevronRight, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { CalendarEvent } from "@uniwork/core/calendar/types";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { addDays, format } from "date-fns";
import { useMemo, useRef, useState } from "react";
import { dropToPatch, type CalendarDropPatch } from "./calendar-drop-patch";
import { toFcEvent } from "./calendar-fc-map";

export type { CalendarDropPatch };
import {
  type CalendarViewMode,
  fcHiddenDays,
  fcViewForMode,
} from "./calendar-view-mode";
import type { CalendarSlot } from "./slot-prefill";
import "./fullcalendar-theme.css";

export type { CalendarSlot };

const FC_PLUGINS = [dayGridPlugin, timeGridPlugin, interactionPlugin];
const dayCellKeyHandlers = new WeakMap<
  HTMLElement,
  { target: HTMLElement; handler: EventListener }
>();

function timeZoneOffsetLabel(timeZone: string, initialDate: string): string {
  try {
    const at = new Date(`${initialDate}T12:00:00Z`);
    const offset = new Intl.DateTimeFormat("en-US", {
      timeZone,
      timeZoneName: "shortOffset",
    })
      .formatToParts(at)
      .find((part) => part.type === "timeZoneName")?.value;
    return offset === "GMT" ? "GMT+0" : (offset ?? "GMT+0");
  } catch {
    return "GMT+0";
  }
}

export function FullCalendarHost(props: {
  events: CalendarEvent[];
  initialDate: string;
  viewMode: CalendarViewMode;
  showWeekends?: boolean;
  language?: string;
  viewerTimeZone?: string;
  onDatesSet: (range: { from: string; to: string }) => void;
  onEventClick: (event: CalendarEvent, source?: HTMLElement) => void;
  editable?: boolean;
  onEventDropOrResize?: (patch: CalendarDropPatch) => void | Promise<void>;
  onExternalTaskReceive?: (input: {
    taskId: string;
    dueDate: string;
  }) => void | Promise<void>;
  onSlotSelect?: (slot: CalendarSlot, source?: HTMLElement) => void;
  className?: string;
}) {
  const { t } = useTranslation();
  const hostRef = useRef<HTMLDivElement>(null);
  const [allDayExpanded, setAllDayExpanded] = useState(false);
  const eventsById = useMemo(
    () => new Map(props.events.map((ev) => [ev.id, ev])),
    [props.events],
  );
  const fcEvents = useMemo(() => props.events.map(toFcEvent), [props.events]);
  const initialView = fcViewForMode(props.viewMode);
  const showWeekends = props.showWeekends !== false;
  const hiddenDays = fcHiddenDays(props.viewMode, showWeekends);
  const isTimeGrid = props.viewMode !== "month";
  const calendarLocale = props.language?.startsWith("vi")
    ? viCalendarLocale
    : enGbCalendarLocale;
  const timeZoneLabel = props.viewerTimeZone
    ? timeZoneOffsetLabel(props.viewerTimeZone, props.initialDate)
    : null;

  const handleDatesSet = (arg: DatesSetArg) => {
    const inclusiveEnd = props.viewMode === "work_week"
      ? addDays(arg.start, 4)
      : addDays(arg.end, -1);
    props.onDatesSet({
      from: format(arg.start, "yyyy-MM-dd"),
      to: format(inclusiveEnd, "yyyy-MM-dd"),
    });
  };

  const handleEventClick = (info: EventClickArg) => {
    const id = info.event.id;
    const match = eventsById.get(id);
    if (match) {
      props.onEventClick(match, info.el);
    }
  };

  const handleEventDropOrResize = async (info: EventDropArg | EventResizeDoneArg) => {
    const id = info.event.id;
    const match = eventsById.get(id);
    const start = info.event.start;
    if (!match || !props.onEventDropOrResize || !start) {
      info.revert();
      return;
    }

    const patch = dropToPatch({
      event: match,
      start,
      end: info.event.end,
      allDay: info.event.allDay,
    });
    if (!patch) {
      info.revert();
      return;
    }

    try {
      await props.onEventDropOrResize(patch);
    } catch {
      info.revert();
    }
  };

  const editable = props.editable !== false;
  const slotSelectEnabled = Boolean(props.onSlotSelect);
  const externalDropEnabled = Boolean(props.onExternalTaskReceive);

  const renderDayCellContent = (info: DayCellContentArg) => {
    if (!slotSelectEnabled || info.view.type !== "dayGridMonth") {
      return info.dayNumberText;
    }
    return (
      <span className="flex w-full items-center justify-end gap-0.5">
        <span>{info.dayNumberText}</span>
        <Plus
          aria-hidden
          className="calendar-day-create size-3.5 text-muted-foreground"
        />
      </span>
    );
  };

  const enhanceMonthDayCell = (info: DayCellMountArg) => {
    if (!slotSelectEnabled || info.view.type !== "dayGridMonth") return;
    const target = info.el.querySelector<HTMLElement>(".fc-daygrid-day-number");
    if (!target) return;
    const dateLabel = format(info.date, "dd/MM/yyyy");
    target.setAttribute("role", "button");
    target.setAttribute(
      "aria-label",
      t("calendar.create_item_on_date", { date: dateLabel }),
    );
    target.tabIndex = 0;
    const handler: EventListener = (event) => {
      const keyboardEvent = event as KeyboardEvent;
      if (keyboardEvent.key !== "Enter" && keyboardEvent.key !== " ") return;
      keyboardEvent.preventDefault();
      props.onSlotSelect?.(
        { start: info.date, end: null, allDay: true },
        target,
      );
    };
    target.addEventListener("keydown", handler);
    dayCellKeyHandlers.set(info.el, { target, handler });
  };

  const cleanupMonthDayCell = (info: DayCellMountArg) => {
    const registered = dayCellKeyHandlers.get(info.el);
    if (!registered) return;
    registered.target.removeEventListener("keydown", registered.handler);
    dayCellKeyHandlers.delete(info.el);
  };

  const handleEventReceive = async (info: {
    event: {
      start: Date | null;
      extendedProps: Record<string, unknown>;
    };
    revert: () => void;
  }) => {
    const taskId = info.event.extendedProps.uniworkTaskId;
    const start = info.event.start;
    if (typeof taskId !== "string" || !taskId || !props.onExternalTaskReceive || !start) {
      info.revert();
      return;
    }

    const dueDate = format(start, "yyyy-MM-dd");
    try {
      await props.onExternalTaskReceive({ taskId, dueDate });
    } finally {
      info.revert();
    }
  };

  const handleDateClick = (info: DateClickArg) => {
    props.onSlotSelect?.(
      {
        start: info.date,
        end: null,
        allDay: info.allDay,
      },
      info.dayEl,
    );
  };

  const handleSelect = (info: DateSelectArg) => {
    const eventTarget = info.jsEvent?.target;
    let source: HTMLElement | undefined;

    if (props.viewMode === "month") {
      const targetCell = eventTarget instanceof Element
        ? eventTarget.closest<HTMLElement>(".fc-daygrid-day")
        : null;
      const fallbackDate = format(addDays(info.end, -1), "yyyy-MM-dd");
      const stableCell = targetCell && hostRef.current?.contains(targetCell)
        ? targetCell
        : hostRef.current?.querySelector<HTMLElement>(
            `.fc-daygrid-day[data-date="${fallbackDate}"]`,
          );
      source = stableCell?.querySelector<HTMLElement>(".fc-daygrid-day-number")
        ?? stableCell
        ?? hostRef.current
        ?? undefined;
    } else {
      source = eventTarget instanceof HTMLElement && eventTarget.isConnected
        ? eventTarget
        : (hostRef.current ?? undefined);
    }

    props.onSlotSelect?.(
      {
        start: info.start,
        end: info.end,
        allDay: info.allDay,
      },
      source,
    );
  };

  return (
    <div
      ref={hostRef}
      data-testid="calendar-grid"
      lang={props.language}
      className={cn("uniwork-fc relative flex min-h-0 flex-1 flex-col", props.className)}
    >
      {props.viewMode !== "month" && timeZoneLabel ? (
        <span
          className="pointer-events-none absolute left-2 top-2 z-10 text-caption tabular-nums text-muted-foreground"
          title={props.viewerTimeZone}
        >
          {timeZoneLabel}
        </span>
      ) : null}
      {isTimeGrid ? (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="absolute left-1 top-8 z-20 h-7 gap-0.5 px-0.5 text-caption font-normal text-muted-foreground pointer-coarse:min-h-11"
          aria-expanded={allDayExpanded}
          aria-label={t(
            allDayExpanded
              ? "calendar.collapse_all_day"
              : "calendar.expand_all_day",
          )}
          onClick={() => setAllDayExpanded((expanded) => !expanded)}
        >
          {allDayExpanded ? (
            <ChevronDown aria-hidden className="size-3.5" />
          ) : (
            <ChevronRight aria-hidden className="size-3.5" />
          )}
          {t("calendar.all_day")}
        </Button>
      ) : null}
      <FullCalendar
        key={`${props.viewMode}-${props.initialDate}-${showWeekends ? "weekends" : "weekdays"}`}
        plugins={FC_PLUGINS}
        initialView={initialView}
        initialDate={props.initialDate}
        locale={calendarLocale}
        firstDay={1}
        timeZone="local"
        nowIndicator={isTimeGrid}
        slotMinTime="00:00:00"
        slotMaxTime="24:00:00"
        scrollTime="00:00:00"
        hiddenDays={hiddenDays}
        dayMaxEventRows={isTimeGrid ? (allDayExpanded ? false : 1) : undefined}
        allDayText={isTimeGrid ? "" : undefined}
        headerToolbar={false}
        height="100%"
        events={fcEvents}
        editable={editable}
        droppable={externalDropEnabled}
        eventReceive={externalDropEnabled ? handleEventReceive : undefined}
        datesSet={handleDatesSet}
        eventClick={handleEventClick}
        eventDrop={handleEventDropOrResize}
        eventResize={handleEventDropOrResize}
        selectable={slotSelectEnabled}
        selectMirror={slotSelectEnabled}
        dayCellContent={props.viewMode === "month" ? renderDayCellContent : undefined}
        dayCellDidMount={props.viewMode === "month" ? enhanceMonthDayCell : undefined}
        dayCellWillUnmount={props.viewMode === "month" ? cleanupMonthDayCell : undefined}
        dateClick={slotSelectEnabled ? handleDateClick : undefined}
        select={slotSelectEnabled ? handleSelect : undefined}
      />
    </div>
  );
}
