"use client";

import type {
  DateClickArg,
  DatesSetArg,
  EventClickArg,
  EventDropArg,
  EventResizeDoneArg,
  SelectArg,
} from "@fullcalendar/core";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";
import FullCalendar from "@fullcalendar/react";
import timeGridPlugin from "@fullcalendar/timegrid";
import type { CalendarEvent } from "@uniwork/core/calendar/types";
import { cn } from "@uniwork/ui/lib/utils";
import { addDays, format } from "date-fns";
import { useMemo } from "react";
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

export function FullCalendarHost(props: {
  events: CalendarEvent[];
  initialDate: string;
  viewMode: CalendarViewMode;
  onDatesSet: (range: { from: string; to: string }) => void;
  onEventClick: (event: CalendarEvent) => void;
  editable?: boolean;
  onEventDropOrResize?: (patch: CalendarDropPatch) => void | Promise<void>;
  onExternalTaskReceive?: (input: {
    taskId: string;
    dueDate: string;
  }) => void | Promise<void>;
  onSlotSelect?: (slot: CalendarSlot) => void;
  className?: string;
}) {
  const eventsById = useMemo(
    () => new Map(props.events.map((ev) => [ev.id, ev])),
    [props.events],
  );
  const fcEvents = useMemo(() => props.events.map(toFcEvent), [props.events]);
  const initialView = fcViewForMode(props.viewMode);
  const hiddenDays = fcHiddenDays(props.viewMode);

  const handleDatesSet = (arg: DatesSetArg) => {
    props.onDatesSet({
      from: format(arg.start, "yyyy-MM-dd"),
      to: format(addDays(arg.end, -1), "yyyy-MM-dd"),
    });
  };

  const handleEventClick = (info: EventClickArg) => {
    const id = info.event.id;
    const match = eventsById.get(id);
    if (match) {
      props.onEventClick(match);
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
    props.onSlotSelect?.({
      start: info.date,
      end: null,
      allDay: info.allDay,
    });
  };

  const handleSelect = (info: SelectArg) => {
    props.onSlotSelect?.({
      start: info.start,
      end: info.end,
      allDay: info.allDay,
    });
  };

  return (
    <div
      data-testid="calendar-grid"
      className={cn("uniwork-fc flex min-h-0 flex-1 flex-col", props.className)}
    >
      <FullCalendar
        key={`${props.viewMode}-${props.initialDate}`}
        plugins={FC_PLUGINS}
        initialView={initialView}
        initialDate={props.initialDate}
        hiddenDays={hiddenDays}
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
        dateClick={slotSelectEnabled ? handleDateClick : undefined}
        select={slotSelectEnabled ? handleSelect : undefined}
      />
    </div>
  );
}
