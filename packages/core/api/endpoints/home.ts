import { z } from "zod";
import {
  HomePreferenceSchema,
  HomeSummarySchema,
  type HomePreference,
  type HomeSource,
  type HomeSummary,
} from "../../types/home";
import { MeetingSchema } from "../../types/meeting";
import { NotificationSchema } from "../../types/notification";
import { TaskSchema } from "../../types/task";
import { request } from "../http";
import { parseWithFallback } from "../schema";

const enc = encodeURIComponent;

const SECTIONS: { key: "my_work" | "upcoming_meetings" | "inbox"; schema: z.ZodType; source: HomeSource }[] = [
  { key: "my_work", schema: z.array(TaskSchema), source: "tasks" },
  { key: "upcoming_meetings", schema: z.array(MeetingSchema), source: "meetings" },
  { key: "inbox", schema: z.array(NotificationSchema), source: "notifications" },
];

/**
 * A list the schema had to empty is a source the page cannot trust, so it is
 * reported like a server-side failure instead of reading as "nothing to do".
 */
function withDriftedSections(raw: unknown, summary: HomeSummary): HomeSummary {
  const record = raw as Record<string, unknown>;
  const partial = [...summary.partial];
  for (const s of SECTIONS) {
    if (!s.schema.safeParse(record[s.key]).success && !partial.includes(s.source)) partial.push(s.source);
  }
  return partial.length === summary.partial.length ? summary : { ...summary, partial };
}

/** null when the response is unusable; the screen shows its error state. */
export async function getHomeSummary(workspaceId: string): Promise<HomeSummary | null> {
  const raw = await request(`/api/v1/workspaces/${enc(workspaceId)}/home`);
  const summary = parseWithFallback<HomeSummary | null>(raw, HomeSummarySchema, null, {
    endpoint: "GET /api/v1/workspaces/{ws}/home",
  });
  return summary ? withDriftedSections(raw, summary) : null;
}

const EMPTY_PREFERENCE: HomePreference = { prefs: {}, updated_at: "" };

export async function getHomePreference(workspaceId: string): Promise<HomePreference> {
  const raw = await request(`/api/v1/workspaces/${enc(workspaceId)}/home/preferences`);
  return parseWithFallback<HomePreference>(raw, HomePreferenceSchema, EMPTY_PREFERENCE, {
    endpoint: "GET /api/v1/workspaces/{ws}/home/preferences",
  });
}

export async function putHomePreference(workspaceId: string, prefs: Record<string, unknown>): Promise<HomePreference | null> {
  const raw = await request(`/api/v1/workspaces/${enc(workspaceId)}/home/preferences`, {
    method: "PUT",
    body: { prefs },
  });
  return parseWithFallback<HomePreference | null>(raw, HomePreferenceSchema, null, {
    endpoint: "PUT /api/v1/workspaces/{ws}/home/preferences",
  });
}
