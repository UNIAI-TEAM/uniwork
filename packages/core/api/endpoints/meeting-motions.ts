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

/** One motion the caller is on the roll for (GET /meetings/{id}/my-ballots). */
const MyMotionBallotSchema = z.object({
  motion_id: z.string(),
  cast: z.boolean(),
  /** Only once a public ballot is cast; a secret ballot never stores one. */
  choice: z.string().nullish(),
});
export type MyMotionBallot = z.infer<typeof MyMotionBallotSchema>;
const MyBallotsResponse = z.object({ ballots: z.array(MyMotionBallotSchema) });

const MotionVotersSchema = z.object({
  yes: z.array(z.string()),
  no: z.array(z.string()),
  abstain: z.array(z.string()),
});
export type MotionVoters = z.infer<typeof MotionVotersSchema>;
/** `voters` is null while the motion is open, and for a secret ballot. */
const MotionVotersResponse = z.object({ voters: MotionVotersSchema.nullish() });

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

/**
 * The caller's own roll. null on drift: the caller then falls back to what the
 * list itself says (nothing, on a current server) rather than inventing a roll.
 */
export async function listMyMotionBallots(meetingId: string): Promise<MyMotionBallot[] | null> {
  const raw = await request(`/api/v1/meetings/${enc(meetingId)}/my-ballots`);
  const parsed = parseWithFallback<{ ballots: MyMotionBallot[] } | null>(raw, MyBallotsResponse, null, {
    endpoint: "GET /api/v1/meetings/{id}/my-ballots",
  });
  return parsed?.ballots ?? null;
}

/** Who chose what on a closed public motion; null while open, for a secret ballot, or on drift. */
export async function getMotionVoters(meetingId: string, motionId: string): Promise<MotionVoters | null> {
  const raw = await request(`${motionPath(meetingId, motionId)}/voters`);
  const parsed = parseWithFallback<{ voters?: MotionVoters | null } | null>(raw, MotionVotersResponse, null, {
    endpoint: "GET /api/v1/meetings/{id}/motions/{motionId}/voters",
  });
  return parsed?.voters ?? null;
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
