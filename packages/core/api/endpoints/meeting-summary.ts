import { z } from "zod";
import { MeetingSummarySchema, type MeetingSummary } from "../../types/meeting";
import { ApiError, request } from "../http";
import { parseWithFallback } from "../schema";

const enc = encodeURIComponent;

const SummaryResponse = z.object({ summary: MeetingSummarySchema.nullable() });

export async function getMeetingSummary(meetingId: string): Promise<MeetingSummary | null> {
  try {
    const raw = await request(`/api/v1/meetings/${enc(meetingId)}/summary`);
    return parseWithFallback(raw, SummaryResponse, { summary: null }, { endpoint: "getMeetingSummary" }).summary;
  } catch (err) {
    // Older servers returned 404 when no summary existed yet.
    if (err instanceof ApiError && err.status === 404 && err.code === "not_found") {
      return null;
    }
    throw err;
  }
}

export async function createMeetingSummary(meetingId: string, locale: string): Promise<MeetingSummary | null> {
  const raw = await request(`/api/v1/meetings/${enc(meetingId)}/summary`, { method: "POST", body: { locale } });
  return parseWithFallback(raw, SummaryResponse, { summary: null }, { endpoint: "createMeetingSummary" }).summary;
}

/**
 * One action item the host turns into a task, with the values the host
 * confirmed. `assignee_id` and `due_date` are always sent: null is "nobody" /
 * "no due date", and the server never re-reads the AI's words into them.
 * `project_id` omitted takes the meeting's project; "" is no project.
 */
export interface MeetingSummaryTaskInput {
  index: number;
  title?: string;
  description?: string;
  assignee_id: string | null;
  due_date: string | null;
  project_id?: string;
  priority?: string;
}

export interface MeetingSummaryTasksBody {
  /** The summary the host chose from; an older one is refused with summary_superseded. */
  summary_id: string;
  items: MeetingSummaryTaskInput[];
}

/** Which action item became which task, in request order. */
export interface MeetingSummaryTasksResult {
  task_ids: string[];
  items: { index: number; task_id: string }[];
}

const SummaryTasksResponse = z.object({
  task_ids: z.array(z.string()),
  items: z.array(z.object({ index: z.number(), task_id: z.string() })).nullish(),
});

/**
 * Null when the answer cannot be read: the tasks may well exist, so the
 * caller must not report a count it does not know (the refetched summary
 * marks the items that became tasks).
 */
export async function createTasksFromSummary(
  meetingId: string,
  body: MeetingSummaryTasksBody,
): Promise<MeetingSummaryTasksResult | null> {
  const raw = await request(`/api/v1/meetings/${enc(meetingId)}/summary/tasks`, { method: "POST", body });
  const parsed = parseWithFallback<z.infer<typeof SummaryTasksResponse> | null>(raw, SummaryTasksResponse, null, {
    endpoint: "createTasksFromSummary",
  });
  if (!parsed) return null;
  return { task_ids: parsed.task_ids, items: parsed.items ?? [] };
}
