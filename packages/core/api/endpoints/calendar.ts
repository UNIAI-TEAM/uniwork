import { z } from "zod";
import type { CalendarEvent, CalendarSidebar } from "../../calendar/types";
import { ApiError, request, requestText } from "../http";
import { parseWithFallback } from "../schema";

const enc = encodeURIComponent;

const CalendarEventItemSchema = z
  .object({
    id: z.string(),
    kind: z.string(),
    entity_id: z.string(),
    title: z.string(),
    start: z.string(),
    end: z.string().optional().nullable(),
    all_day: z.boolean(),
    status: z.string().optional().nullable(),
    priority: z.string().optional().nullable(),
    project_id: z.string().optional().nullable(),
    provider: z.enum(["google", "outlook"]).optional(),
    external_url: z.string().optional(),
  })
  .transform(
    (e): CalendarEvent => ({
      id: e.id,
      kind: e.kind as CalendarEvent["kind"],
      entityId: e.entity_id,
      title: e.title,
      start: e.start,
      end: e.end ?? undefined,
      allDay: e.all_day,
      status: e.status ?? undefined,
      priority: e.priority ?? undefined,
      projectId: e.project_id ?? undefined,
      provider: e.provider,
      externalUrl: e.external_url,
    }),
  );

const CalendarEventListSchema = z
  .object({
    events: z.array(CalendarEventItemSchema),
  })
  .transform((v) => v.events);

const EMPTY_EVENTS: CalendarEvent[] = [];

const CalendarSidebarTaskSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    status: z.string(),
    priority: z.string().optional().nullable(),
    due_date: z.string().optional().nullable(),
  })
  .transform((t) => ({
    id: t.id,
    title: t.title,
    status: t.status,
    priority: t.priority ?? undefined,
    dueDate: t.due_date ?? undefined,
  }));

const CalendarSidebarMeetingSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    starts_at: z.string(),
    ends_at: z.string(),
  })
  .transform((m) => ({
    id: m.id,
    title: m.title,
    startsAt: m.starts_at,
    endsAt: m.ends_at,
  }));

const CalendarSidebarSchema = z
  .object({
    priorities: z.array(CalendarSidebarTaskSchema).optional(),
    meet_with: z.array(CalendarSidebarMeetingSchema).optional(),
    assigned: z.array(CalendarSidebarTaskSchema).optional(),
    today_overdue: z.array(CalendarSidebarTaskSchema).optional(),
    backlog: z.array(CalendarSidebarTaskSchema).optional(),
  })
  .transform(
    (v): CalendarSidebar => ({
      priorities: v.priorities ?? [],
      meetWith: v.meet_with ?? [],
      assigned: v.assigned ?? [],
      todayOverdue: v.today_overdue ?? [],
      backlog: v.backlog ?? [],
    }),
  );

const EMPTY_SIDEBAR: CalendarSidebar = {
  priorities: [],
  meetWith: [],
  assigned: [],
  todayOverdue: [],
  backlog: [],
};

export async function listCalendarEvents(
  workspaceId: string,
  params: { from: string; to: string; mine?: boolean },
): Promise<CalendarEvent[]> {
  const q = new URLSearchParams({ from: params.from, to: params.to });
  if (params.mine) q.set("mine", "true");
  const raw = await request(`/api/v1/workspaces/${enc(workspaceId)}/calendar/events?${q}`);
  return parseWithFallback<CalendarEvent[]>(raw, CalendarEventListSchema, EMPTY_EVENTS, {
    endpoint: "GET /api/v1/workspaces/{ws}/calendar/events",
  });
}

export async function getCalendarSidebar(workspaceId: string): Promise<CalendarSidebar> {
  const raw = await request(`/api/v1/workspaces/${enc(workspaceId)}/calendar/sidebar`);
  return parseWithFallback<CalendarSidebar>(raw, CalendarSidebarSchema, EMPTY_SIDEBAR, {
    endpoint: "GET /api/v1/workspaces/{ws}/calendar/sidebar",
  });
}

const WORKSPACE_ICS_FILENAME = "uniwork-calendar.ics";

/** Fetches workspace iCalendar text; caller saves it as a download. */
export async function fetchWorkspaceCalendarIcs(
  workspaceId: string,
  opts?: { from?: string; to?: string },
): Promise<string> {
  const q = new URLSearchParams();
  if (opts?.from) q.set("from", opts.from);
  if (opts?.to) q.set("to", opts.to);
  const query = q.toString();
  const path = `/api/v1/workspaces/${enc(workspaceId)}/calendar.ics${query ? `?${query}` : ""}`;
  const text = await requestText(path);
  if (!text.trim() || !text.includes("BEGIN:VCALENDAR")) {
    throw new ApiError("Invalid calendar export", "internal", 502);
  }
  return text;
}

export { WORKSPACE_ICS_FILENAME };

export type CalendarProvider = "google" | "outlook";
export type CalendarConnection = {
  provider: CalendarProvider;
  email: string;
  selectedCalendarIds: string[];
};
export type ExternalCalendar = {
  id: string;
  name: string;
  color?: string;
  primary: boolean;
  selected: boolean;
  readOnly: boolean;
};

const ConnectionSchema = z
  .object({
    provider: z.enum(["google", "outlook"]),
    email: z.string(),
    selected_calendar_ids: z.array(z.string()).optional(),
  })
  .transform((value) => ({
    provider: value.provider,
    email: value.email,
    selectedCalendarIds: value.selected_calendar_ids ?? [],
  }));
const ConnectionsSchema = z
  .object({ connections: z.array(ConnectionSchema) })
  .transform((value) => value.connections);
const OAuthStartSchema = z
  .object({ authorization_url: z.string().url() })
  .transform((value) => value.authorization_url);
const ExternalCalendarSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    color: z.string().optional(),
    primary: z.boolean().optional(),
    selected: z.boolean().optional(),
    read_only: z.boolean().optional(),
  })
  .transform((value) => ({
    id: value.id,
    name: value.name,
    color: value.color,
    primary: value.primary ?? false,
    selected: value.selected ?? false,
    readOnly: value.read_only ?? false,
  }));
const ExternalCalendarsSchema = z
  .object({ calendars: z.array(ExternalCalendarSchema) })
  .transform((value) => value.calendars);

export async function listCalendarConnections(
  workspaceId: string,
): Promise<CalendarConnection[]> {
  const raw = await request(
    `/api/v1/workspaces/${enc(workspaceId)}/calendar/connections`,
  );
  return parseWithFallback(raw, ConnectionsSchema, [], {
    endpoint: "GET /api/v1/workspaces/{ws}/calendar/connections",
  });
}

export async function startCalendarConnection(
  workspaceId: string,
  provider: CalendarProvider,
): Promise<string> {
  const raw = await request(
    `/api/v1/workspaces/${enc(workspaceId)}/calendar/connections/${provider}/start`,
  );
  return parseWithFallback(raw, OAuthStartSchema, "", {
    endpoint: "GET /api/v1/workspaces/{ws}/calendar/connections/{provider}/start",
  });
}

export async function listExternalCalendars(
  workspaceId: string,
  provider: CalendarProvider,
): Promise<ExternalCalendar[]> {
  const raw = await request(
    `/api/v1/workspaces/${enc(workspaceId)}/calendar/connections/${provider}/calendars`,
  );
  return parseWithFallback(raw, ExternalCalendarsSchema, [], {
    endpoint: "GET /api/v1/workspaces/{ws}/calendar/connections/{provider}/calendars",
  });
}

export async function selectExternalCalendars(
  workspaceId: string,
  provider: CalendarProvider,
  calendarIds: string[],
): Promise<void> {
  await request(
    `/api/v1/workspaces/${enc(workspaceId)}/calendar/connections/${provider}/calendars`,
    { method: "PUT", body: { calendar_ids: calendarIds } },
  );
}

export async function disconnectCalendarConnection(
  workspaceId: string,
  provider: CalendarProvider,
): Promise<void> {
  await request(
    `/api/v1/workspaces/${enc(workspaceId)}/calendar/connections/${provider}`,
    { method: "DELETE" },
  );
}
