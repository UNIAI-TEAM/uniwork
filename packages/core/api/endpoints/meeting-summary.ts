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
