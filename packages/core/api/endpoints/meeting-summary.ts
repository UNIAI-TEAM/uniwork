import { z } from "zod";
import { MeetingSummaryRunSchema, MeetingSummarySchema, type MeetingSummary, type MeetingSummaryRun } from "../../types/meeting";
import { ApiError, request } from "../http";
import { parseWithFallback } from "../schema";

const enc = encodeURIComponent;

const SummaryResponse = z.object({ summary: MeetingSummarySchema.nullable() });

const IDLE_RUN: MeetingSummaryRun = { status: "idle", at: null, attempts: 0 };

const SummaryStateResponse = z.object({
  summary: MeetingSummarySchema.nullable().catch(null),
  /** Absent on a server before UNI-1995: idle. */
  run: MeetingSummaryRunSchema.optional().transform((r) => r ?? IDLE_RUN),
});

/** A meeting's latest summary and whether one is being made. */
export interface MeetingSummaryState {
  summary: MeetingSummary | null;
  run: MeetingSummaryRun;
}

export async function getMeetingSummary(meetingId: string): Promise<MeetingSummaryState> {
  try {
    const raw = await request(`/api/v1/meetings/${enc(meetingId)}/summary`);
    return parseWithFallback(raw, SummaryStateResponse, { summary: null, run: IDLE_RUN }, { endpoint: "getMeetingSummary" });
  } catch (err) {
    // Older servers returned 404 when no summary existed yet.
    if (err instanceof ApiError && err.status === 404 && err.code === "not_found") {
      return { summary: null, run: IDLE_RUN };
    }
    throw err;
  }
}

export async function createMeetingSummary(meetingId: string, locale: string): Promise<MeetingSummary | null> {
  const raw = await request(`/api/v1/meetings/${enc(meetingId)}/summary`, { method: "POST", body: { locale } });
  return parseWithFallback(raw, SummaryResponse, { summary: null }, { endpoint: "createMeetingSummary" }).summary;
}

const CatchUpPointSchema = z.object({
  text: z.string(),
  segment_id: z.string().optional(),
  /** RFC3339: when the stretch of speech the point came from was said; absent for a point from the notes. */
  spoken_at: z.string().optional(),
});

const MeetingCatchUpSchema = z.object({
  summary: z.string(),
  highlights: z.array(CatchUpPointSchema).catch([]),
  action_items: z
    .array(CatchUpPointSchema.omit({ text: true }).extend({ title: z.string(), owner: z.string().optional(), due: z.string().optional() }))
    .catch([]),
  generated_at: z.string().catch(""),
  partial: z.boolean().catch(false),
});

export type MeetingCatchUp = z.infer<typeof MeetingCatchUpSchema>;

/** A late joiner's brief (scribe spec §5.1); null when the answer cannot be read. */
export async function createMeetingCatchUp(meetingId: string, locale: string): Promise<MeetingCatchUp | null> {
  const raw = await request(`/api/v1/meetings/${enc(meetingId)}/catch-up`, { method: "POST", body: { locale } });
  return parseWithFallback<MeetingCatchUp | null>(raw, MeetingCatchUpSchema, null, { endpoint: "createMeetingCatchUp" });
}

