"use client";

import type { EventClickArg, DatesSetArg } from "@fullcalendar/core";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";
import FullCalendar from "@fullcalendar/react";
import timeGridPlugin from "@fullcalendar/timegrid";
import type { CalendarEvent } from "@uniwork/core/calendar/types";
import { cn } from "@uniwork/ui/lib/utils";
import { addDays, format } from "date-fns";
import { useMemo } from "react";
import { toFcEvent } from "./calendar-fc-map";
import {
  type CalendarViewMode,
  fcHiddenDays,
  fcViewForMode,
} from "./calendar-view-mode";
import "./fullcalendar-theme.css";

export function FullCalendarHost(props: {
  events: CalendarEvent[];
  initialDate: string;
  viewMode: CalendarViewMode;
  onDatesSet: (range: { from: string; to: string }) => void;
  onEventClick: (event: CalendarEvent) => void;
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

  return (
    <div data-testid="calendar-grid" className={cn("uniwork-fc min-h-0 flex-1", props.className)}>
      <FullCalendar
        key={`${props.viewMode}-${props.initialDate}`}
        plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
        initialView={initialView}
        initialDate={props.initialDate}
        hiddenDays={hiddenDays}
        headerToolbar={false}
        height="auto"
        events={fcEvents}
        datesSet={handleDatesSet}
        eventClick={handleEventClick}
      />
    </div>
  );
}
