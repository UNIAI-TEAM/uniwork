"use client";

import { useQuery } from "@tanstack/react-query";
import {
  getCalendarSidebar,
  listCalendarConnections,
  listCalendarEvents,
  listExternalCalendars,
} from "../api/endpoints/calendar";
import type { CalendarProvider } from "../api/endpoints/calendar";
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

export function useCalendarConnections(wsId: string) {
  return useQuery({
    queryKey: calendarKeys.connections(wsId),
    queryFn: () => listCalendarConnections(wsId),
    enabled: Boolean(wsId),
  });
}

export function useExternalCalendars(
  wsId: string,
  provider: CalendarProvider,
  enabled = true,
) {
  return useQuery({
    queryKey: calendarKeys.providerCalendars(wsId, provider),
    queryFn: () => listExternalCalendars(wsId, provider),
    enabled: Boolean(wsId) && enabled,
  });
}

export { calendarKeys } from "./keys";
