import { z } from "zod";
import { request } from "../http";
import { parseWithFallback } from "../schema";

const enc = encodeURIComponent;

const MinutesSchema = z.object({
  /** The UniNote page of the minutes; null for a reader the page is closed to. */
  document_id: z.string().nullish(),
  finalized: z.boolean().catch(false),
  finalized_at: z.string().nullish(),
  finalized_by: z.string().nullish(),
  finalized_version_id: z.string().nullish(),
  /** The finalized version's ordinal in the page's history. */
  finalized_version: z.number().nullish(),
  /** The page's content was saved after the finalized version. */
  edited_since_finalized: z.boolean().catch(false),
  /** The caller may edit the page (finalizing and reopening need it). */
  can_edit: z.boolean().catch(false),
  /** Action items still pending (neither converted nor dismissed): warn before finalizing. */
  pending_items: z.number().int().nonnegative().catch(0),
});

/** A meeting's minutes (spec meeting follow-through §6.6); null when it has none. */
export type MeetingMinutes = z.infer<typeof MinutesSchema>;

const MinutesResponse = z.object({ minutes: MinutesSchema.nullable().catch(null) });

function parseMinutes(raw: unknown, endpoint: string): MeetingMinutes | null {
  return parseWithFallback(raw, MinutesResponse, { minutes: null }, { endpoint }).minutes;
}

const base = (meetingId: string) => `/api/v1/meetings/${enc(meetingId)}/minutes`;

export async function getMeetingMinutes(meetingId: string): Promise<MeetingMinutes | null> {
  return parseMinutes(await request(base(meetingId)), "getMeetingMinutes");
}

/** Makes the minutes page from the meeting's data, in the request's language. */
export async function createMeetingMinutes(meetingId: string, locale: string): Promise<MeetingMinutes | null> {
  const raw = await request(base(meetingId), { method: "POST", body: { locale } });
  return parseMinutes(raw, "createMeetingMinutes");
}

export async function finalizeMeetingMinutes(meetingId: string): Promise<MeetingMinutes | null> {
  return parseMinutes(await request(`${base(meetingId)}/finalize`, { method: "POST" }), "finalizeMeetingMinutes");
}

/** Rewrites the fact sections of draft minutes (roll, votes, assigned tasks); 409 minutes_finalized once finalized. */
export async function refreshMeetingMinutes(meetingId: string): Promise<MeetingMinutes | null> {
  return parseMinutes(await request(`${base(meetingId)}/refresh`, { method: "POST" }), "refreshMeetingMinutes");
}

export async function reopenMeetingMinutes(meetingId: string): Promise<MeetingMinutes | null> {
  return parseMinutes(await request(`${base(meetingId)}/reopen`, { method: "POST" }), "reopenMeetingMinutes");
}
