/** Whether the planned meeting window has ended (ends_at is exclusive). */
export function isPastScheduledEnd(endsAt: string, nowMs = Date.now()): boolean {
  const end = Date.parse(endsAt);
  return Number.isFinite(end) && nowMs > end;
}

/** Milliseconds until scheduled end; negative when already past. */
export function msUntilScheduledEnd(endsAt: string, nowMs = Date.now()): number | null {
  const end = Date.parse(endsAt);
  if (!Number.isFinite(end)) return null;
  return end - nowMs;
}

export const SCHEDULE_WARN_5_MIN_MS = 5 * 60_000;
export const SCHEDULE_WARN_1_MIN_MS = 60_000;

/** Whether join/start actions are allowed for the scheduled window. */
export function canEnterScheduledMeeting(
  meeting: { ends_at: string; status?: string },
  nowMs = Date.now(),
): boolean {
  if (meeting.status === "ENDED" || meeting.status === "CANCELED") return false;
  return !isPastScheduledEnd(meeting.ends_at, nowMs);
}
