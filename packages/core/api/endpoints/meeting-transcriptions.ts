import { z } from "zod";
import {
  type Meeting,
  MeetingSchema,
  type MeetingTranscription,
  MeetingTranscriptionSchema,
} from "../../types/meeting";
import { request } from "../http";
import { parseWithFallback } from "../schema";

// Meetings held without a room (UNI-2001): recording one as held, and the
// batch transcription of its uploaded recordings. The upload itself is the
// shared large upload session (createMeetingAudioUploadSession).

const enc = encodeURIComponent;
const base = (meetingId: string) => `/api/v1/meetings/${enc(meetingId)}`;

/** SCHEDULED → ENDED at the times the host reports (RFC 3339). */
export async function recordMeetingHeld(
  meetingId: string,
  body: { started_at: string; ended_at: string },
): Promise<Meeting | null> {
  const raw = await request(`${base(meetingId)}/held`, { method: "POST", body });
  return (
    parseWithFallback<{ meeting: Meeting } | null>(raw, z.object({ meeting: MeetingSchema }), null, {
      endpoint: "POST /api/v1/meetings/{id}/held",
    })?.meeting ?? null
  );
}

export async function listMeetingTranscriptions(meetingId: string): Promise<MeetingTranscription[]> {
  const raw = await request(`${base(meetingId)}/transcriptions`);
  return parseWithFallback(
    raw,
    z.object({ transcriptions: z.array(MeetingTranscriptionSchema) }),
    { transcriptions: [] },
    { endpoint: "GET /api/v1/meetings/{id}/transcriptions" },
  ).transcriptions;
}

/** consent: the clerk told attendees the meeting was recorded. */
export async function requestMeetingTranscription(
  meetingId: string,
  body: { upload_id: string; language: string; consent: boolean },
): Promise<MeetingTranscription | null> {
  const raw = await request(`${base(meetingId)}/transcriptions`, { method: "POST", body });
  return (
    parseWithFallback<{ transcription: MeetingTranscription } | null>(
      raw,
      z.object({ transcription: MeetingTranscriptionSchema }),
      null,
      { endpoint: "POST /api/v1/meetings/{id}/transcriptions" },
    )?.transcription ?? null
  );
}
