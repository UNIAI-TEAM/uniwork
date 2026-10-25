import { z } from "zod";
import { type MeetingParticipant, ParticipantSchema, type SpeakerLabel, SpeakerLabelSchema } from "../../types/meeting";
import { request } from "../http";
import { parseWithFallback } from "../schema";

// The shared microphone and its speaker labels (meeting scribe S2, UNI-2024).

const enc = encodeURIComponent;
const base = (meetingId: string) => `/api/v1/meetings/${enc(meetingId)}`;

export async function setParticipantSharedMic(
  meetingId: string,
  participantId: string,
  enabled: boolean,
): Promise<MeetingParticipant | null> {
  const raw = await request(`${base(meetingId)}/participants/${enc(participantId)}/shared-mic`, {
    method: "PUT",
    body: { enabled },
  });
  const parsed = parseWithFallback<{ participant: MeetingParticipant } | null>(
    raw,
    z.object({ participant: ParticipantSchema }),
    null,
    { endpoint: "PUT /api/v1/meetings/{id}/participants/{pid}/shared-mic" },
  );
  return parsed?.participant ?? null;
}

export async function getSpeakerLabels(meetingId: string): Promise<SpeakerLabel[]> {
  const raw = await request(`${base(meetingId)}/speaker-labels`);
  return parseWithFallback(raw, z.object({ labels: z.array(SpeakerLabelSchema) }), { labels: [] }, {
    endpoint: "GET /api/v1/meetings/{id}/speaker-labels",
  }).labels;
}

/** One of user_id or name; neither clears the assignment. */
export async function assignSpeakerLabel(
  meetingId: string,
  labelId: string,
  body: { user_id?: string; name?: string },
): Promise<SpeakerLabel | null> {
  const raw = await request(`${base(meetingId)}/speaker-labels/${enc(labelId)}`, { method: "PUT", body });
  const parsed = parseWithFallback<{ label: SpeakerLabel } | null>(raw, z.object({ label: SpeakerLabelSchema }), null, {
    endpoint: "PUT /api/v1/meetings/{id}/speaker-labels/{labelId}",
  });
  return parsed?.label ?? null;
}
