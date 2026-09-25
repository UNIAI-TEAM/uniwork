"use client";

import { useQuery } from "@tanstack/react-query";
import { getCalendarSidebar, listCalendarEvents } from "../api/endpoints/calendar";
import type { CalendarEvent, CalendarSidebar } from "./types";
import { calendarKeys } from "./keys";

export function useCalendarEvents(wsId: string, from: string, to: string, mine: boolean) {
  return useQuery<CalendarEvent[]>({
    queryKey: calendarKeys.events(wsId, from, to, mine),
    queryFn: () => listCalendarEvents(wsId, { from, to, mine }),
    enabled: Boolean(wsId && from && to),
  });
}

export function useCalendarSidebar(wsId: string) {
  return useQuery<CalendarSidebar>({
    queryKey: calendarKeys.sidebar(wsId),
    queryFn: () => getCalendarSidebar(wsId),
    enabled: Boolean(wsId),
  });
}

export { calendarKeys } from "./keys";
