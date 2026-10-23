import type { Meeting, MeetingParticipant } from "@uniwork/core/types/meeting";
import { splitIsoLocal, type ScheduleDraft } from "./meeting-datetime";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The slot the next meeting of a series starts on (follow-4): the same
 * weekday, time and length as this one, the first week of it still ahead,
 * in the browser's wall clock as the schedule form reads it.
 */
export function followUpScheduleDraft(meeting: Pick<Meeting, "starts_at" | "ends_at">, nowMs = Date.now()): ScheduleDraft | undefined {
  const start = Date.parse(meeting.starts_at);
  const end = Date.parse(meeting.ends_at);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return undefined;
  const weeks = Math.max(1, Math.ceil((nowMs - start) / WEEK_MS));
  const next = start + weeks * WEEK_MS;
  const from = splitIsoLocal(new Date(next).toISOString());
  const to = splitIsoLocal(new Date(next + (end - start)).toISOString());
  return { date: from.date, start: from.time, end: to.time };
}

/** Who the next meeting invites again: the people still in this one, the host aside (they host the next). */
export function followUpAttendeeIds(participants: readonly MeetingParticipant[], hostUserId: string | undefined): string[] {
  const ids = participants
    .filter((p) => p.status === "ACTIVE" && p.user_id && p.user_id !== hostUserId)
    .map((p) => p.user_id as string);
  return [...new Set(ids)];
}
