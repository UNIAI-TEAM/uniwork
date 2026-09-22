import { z } from "zod";
import type { CalendarEvent } from "../../calendar/types";
import { request } from "../http";
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
    }),
  );

const CalendarEventListSchema = z
  .object({
    events: z.array(CalendarEventItemSchema),
  })
  .transform((v) => v.events);

const EMPTY_EVENTS: CalendarEvent[] = [];

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
