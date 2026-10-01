import { z } from "zod";
import {
  type BallotChoice,
  type MeetingMotion,
  MeetingMotionSchema,
  type MotionDraftInput,
} from "../../types/meeting";
import { request } from "../http";
import { parseWithFallback } from "../schema";

const enc = encodeURIComponent;
const motionsPath = (meetingId: string) => `/api/v1/meetings/${enc(meetingId)}/motions`;
const motionPath = (meetingId: string, motionId: string) => `${motionsPath(meetingId)}/${enc(motionId)}`;

const MotionListResponse = z.object({ motions: z.array(MeetingMotionSchema) });
const MotionResponse = z.object({ motion: MeetingMotionSchema });

// Guests need nothing here: rawFetch sends X-Guest-Session when there is no
// access token, and the list and ballot routes are public on the server.

export async function listMeetingMotions(meetingId: string): Promise<MeetingMotion[]> {
  const raw = await request(motionsPath(meetingId));
  const parsed = parseWithFallback<{ motions: MeetingMotion[] } | null>(raw, MotionListResponse, null, {
    endpoint: "GET /api/v1/meetings/{id}/motions",
  });
  // An empty list would hide an open vote; the tab shows its error state instead.
  if (!parsed) throw new Error("meeting_motions_invalid");
  return parsed.motions;
}

export async function createMeetingMotion(meetingId: string, body: MotionDraftInput): Promise<MeetingMotion | null> {
  const raw = await request(motionsPath(meetingId), { method: "POST", body });
  const parsed = parseWithFallback<{ motion: MeetingMotion } | null>(raw, MotionResponse, null, {
    endpoint: "POST /api/v1/meetings/{id}/motions",
  });
  return parsed?.motion ?? null;
}

export async function updateMeetingMotion(
  meetingId: string,
  motionId: string,
  body: Partial<MotionDraftInput> & { position?: number },
): Promise<MeetingMotion | null> {
  const raw = await request(motionPath(meetingId, motionId), { method: "PATCH", body });
  const parsed = parseWithFallback<{ motion: MeetingMotion } | null>(raw, MotionResponse, null, {
    endpoint: "PATCH /api/v1/meetings/{id}/motions/{motionId}",
  });
  return parsed?.motion ?? null;
}

export async function deleteMeetingMotion(meetingId: string, motionId: string): Promise<void> {
  await request(motionPath(meetingId, motionId), { method: "DELETE" });
}

export async function openMeetingMotion(meetingId: string, motionId: string): Promise<void> {
  await request(`${motionPath(meetingId, motionId)}/open`, { method: "POST" });
}

export async function closeMeetingMotion(meetingId: string, motionId: string): Promise<void> {
  await request(`${motionPath(meetingId, motionId)}/close`, { method: "POST" });
}

/** Irreversible; already_voted / not_on_roll arrive as ApiError codes. */
export async function castMeetingBallot(meetingId: string, motionId: string, choice: BallotChoice): Promise<void> {
  await request(`${motionPath(meetingId, motionId)}/ballot`, { method: "POST", body: { choice } });
}
