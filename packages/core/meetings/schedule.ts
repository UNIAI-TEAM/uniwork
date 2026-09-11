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

/** IN_PROGRESS and still inside the scheduled window — the list join affordance. */
export function isScheduledMeetingLive(
  meeting: { ends_at: string; status?: string },
  nowMs = Date.now(),
): boolean {
  return meeting.status === "IN_PROGRESS" && canEnterScheduledMeeting(meeting, nowMs);
}

/**
 * Status the list and detail badge should show. After `ends_at` the room is
 * closed to joiners even if the server row is still IN_PROGRESS.
 */
export function displayMeetingStatus(
  meeting: { ends_at: string; status?: string },
  nowMs = Date.now(),
): string {
  const status = meeting.status || "SCHEDULED";
  if (status === "ENDED" || status === "CANCELED") return status;
  if (isPastScheduledEnd(meeting.ends_at, nowMs)) return "ENDED";
  return status;
}
