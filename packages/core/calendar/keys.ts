export const calendarKeys = {
  all: (wsId: string) => ["calendar", wsId] as const,
  events: (wsId: string, from: string, to: string, mine: boolean) =>
    [...calendarKeys.all(wsId), "events", from, to, mine] as const,
  sidebar: (wsId: string) => [...calendarKeys.all(wsId), "sidebar"] as const,
  connections: (wsId: string) => [...calendarKeys.all(wsId), "connections"] as const,
  providerCalendars: (wsId: string, provider: string) =>
    [...calendarKeys.connections(wsId), provider, "calendars"] as const,
};
