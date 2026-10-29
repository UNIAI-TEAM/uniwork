import type { Meeting, MeetingParticipant } from "@uniwork/core/types/meeting";
import { meetingVenue } from "@uniwork/core/meetings/venue";
import { combineLocalIso, splitIsoLocal } from "../meeting-datetime";
import { canonicalZone, type MeetingDraft } from "./draft-model";
import { plusMinutes } from "./draft-validation";

const MINUTE = 60_000;
const WEEK_MS = 7 * 24 * 60 * MINUTE;
const QUARTER_MIN = 15;

/**
 * "Lên lịch họp tiếp theo" (create brief §3.5): the next meeting of a series
 * starts on the same weekday and time, the first week of it still ahead, and
 * lasts the previous length rounded up to 15 minutes (28 → 30).
 */
export function followUpWindow(
  meeting: Pick<Meeting, "starts_at" | "ends_at">,
  nowMs: number,
  timezone?: string,
): { date: string; start: string; end: string } | undefined {
  const start = Date.parse(meeting.starts_at);
  const end = Date.parse(meeting.ends_at);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return undefined;
  // Weeks are counted on the wall date, so the clock time holds across a DST change.
  const wall = splitIsoLocal(meeting.starts_at, timezone);
  const [y, m, d] = wall.date.split("-").map(Number);
  const dayAfter = (weeks: number) => new Date(Date.UTC(y!, m! - 1, d! + weeks * 7)).toISOString().slice(0, 10);
  const slot = (weeks: number) => Date.parse(combineLocalIso(dayAfter(weeks), wall.time, timezone));
  // The UTC estimate is off by at most the DST shift, so it starts at or below the answer.
  let weeks = Math.max(1, Math.floor((nowMs - start) / WEEK_MS));
  while (slot(weeks) < nowMs) weeks++;
  const length = Math.ceil((end - start) / MINUTE / QUARTER_MIN) * QUARTER_MIN;
  const from = splitIsoLocal(new Date(slot(weeks)).toISOString(), timezone);
  return { date: from.date, start: from.time, end: plusMinutes(from.time, length) };
}

/** Who the next meeting invites again: the people still in this one, the host aside (they host the next). */
export function followUpAttendeeIds(participants: readonly MeetingParticipant[], hostUserId: string | undefined): string[] {
  const ids = participants
    .filter((p) => p.status === "ACTIVE" && p.user_id && p.user_id !== hostUserId)
    .map((p) => p.user_id as string);
  return [...new Set(ids)];
}

/** ISO 8601 week number of a "YYYY-MM-DD" day. */
export function isoWeek(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  const date = new Date(Date.UTC(y!, m! - 1, d!));
  const weekday = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - weekday);
  const yearStart = Date.UTC(date.getUTCFullYear(), 0, 1);
  return Math.ceil(((date.getTime() - yearStart) / (24 * 60 * MINUTE) + 1) / 7);
}

const WEEK_WORD = /(tuần|week)\s+(\d{1,2})/i;

/**
 * "Giao ban tuần 43 — …" → "Giao ban tuần 44 — …" when 43 is the week the
 * previous meeting fell in; any other title is copied as it is.
 */
export function followUpTitle(
  title: string,
  previousDay: string,
  nextDay: string,
): { title: string; swap: { from: number; to: number } | null } {
  const match = WEEK_WORD.exec(title);
  const from = isoWeek(previousDay);
  const to = isoWeek(nextDay);
  if (!match || Number(match[2]) !== from || from === to) return { title, swap: null };
  return { title: title.replace(WEEK_WORD, `${match[1]} ${to}`), swap: { from, to } };
}

/**
 * The follow-up draft: title with the week swapped, the next slot, the people
 * as members (roles are not carried over), project, Vào phòng, scribe and
 * sharing from the previous meeting. The agenda starts empty — the old one is
 * offered back as "Dùng lại".
 */
export function followUpDraft(
  previous: Meeting,
  participants: readonly MeetingParticipant[],
  nowMs: number,
  fallbackZone: string,
): { draft: MeetingDraft; swap: { from: number; to: number } | null } {
  const timezone = canonicalZone(previous.timezone || fallbackZone);
  const window = followUpWindow(previous, nowMs, timezone) ?? {
    ...splitIsoLocal(new Date(nowMs).toISOString(), timezone),
    start: "09:00",
    end: "09:30",
  };
  const previousDay = splitIsoLocal(previous.starts_at, timezone).date;
  const named = followUpTitle(previous.title, previousDay, window.date);
  const { date, start, end } = window;
  return {
    swap: named.swap,
    draft: {
      title: named.title,
      // A series keeps its venue, like its project and its scribe.
      venue: meetingVenue(previous),
      description: "",
      date,
      start,
      end,
      timezone,
      people: followUpAttendeeIds(participants, previous.host_user_id).map((userId) => ({ userId, role: "MEMBER" })),
      projectId: previous.project_id ?? "",
      allowJoin: previous.allow_join_request !== false,
      scribe: previous.scribe_enabled !== false,
      aiShared: previous.ai_content_shared === true,
      links: [],
      motions: [],
      quorum: "",
    },
  };
}
