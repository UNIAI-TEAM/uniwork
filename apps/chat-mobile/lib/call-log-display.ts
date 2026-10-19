// Ported from packages/views/chat/voice-call-log-row.tsx (voiceCallLogLabel and
// the `missed` rule) and packages/views/chat/voice-call-duration.ts: a row of
// the calls tab says what the web's call-log row says in the room. The title
// and the time are the tab's own.
import type { CallLog } from "@/data/queries/call-logs";
import { resolveChatNicknameForUser } from "./contacts-display";
import { formatMessageDay } from "./timeline-display";

export interface CallLogView {
  /** the web row's i18n key, with its params */
  labelKey: string;
  labelParams?: { duration: string };
  direction: "outgoing" | "incoming";
  /** only a call that rang for the viewer and went unanswered */
  missed: boolean;
}

/** Elapsed seconds as M:SS, or H:MM:SS from an hour. */
export function formatVoiceCallDuration(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function callLogView(
  log: Pick<CallLog, "outcome" | "video" | "caller_id" | "duration_seconds">,
  currentUserId: string,
): CallLogView {
  const outgoing = log.caller_id === currentUserId;
  const kind = log.video ? "video_call_log" : "voice_call_log";
  const view = (labelKey: string, labelParams?: { duration: string }): CallLogView => ({
    labelKey,
    labelParams,
    direction: outgoing ? "outgoing" : "incoming",
    missed: log.outcome === "unanswered" && !outgoing,
  });
  switch (log.outcome) {
    case "completed":
      return view(`chat.${kind}_completed`, { duration: formatVoiceCallDuration(log.duration_seconds) });
    case "declined":
      return view(outgoing ? `chat.${kind}_declined_outgoing` : `chat.${kind}_declined_incoming`);
    case "unanswered":
      return view(outgoing ? `chat.${kind}_cancelled` : `chat.${kind}_missed`);
    default:
      return view(`chat.${kind}_unknown`);
  }
}

/** A DM is the viewer's nickname for the peer, else the peer's name; a room its name, else the caller. */
export function callLogTitle(
  log: Pick<CallLog, "room_kind" | "room_name" | "peer_user_id" | "caller_name">,
  nicknames: Readonly<Record<string, string>>,
): string {
  const nickname = log.room_kind === "dm" && log.peer_user_id ? resolveChatNicknameForUser(nicknames, log.peer_user_id) : undefined;
  return nickname || log.room_name || log.caller_name;
}

/** Today: the time; an earlier day: the date; another year: the date with the year. */
export function formatCallTime(iso: string, locale: string, now: Date = new Date()): string {
  const at = new Date(iso);
  if (!iso || Number.isNaN(at.getTime())) return "";
  if (at.toDateString() === now.toDateString()) return at.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  const sameYear = at.getFullYear() === now.getFullYear();
  return at.toLocaleDateString(locale, sameYear ? { day: "2-digit", month: "2-digit" } : { day: "2-digit", month: "2-digit", year: "numeric" });
}

/** The clock time of a log; the day header above the row carries the date. Blank when unreadable. */
export function formatCallClock(iso: string, locale: string): string {
  const at = new Date(iso);
  if (!iso || Number.isNaN(at.getTime())) return "";
  return at.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
}

export type CallLogFilter = "all" | "missed";

type SectionedLog = Pick<CallLog, "outcome" | "video" | "caller_id" | "duration_seconds" | "ended_at">;

/**
 * The calls tab's day groups: the logs in the order the server pages them
 * (newest first), a header each time the calendar day changes, titled like the
 * room's day divider. `missed` keeps only the calls missed by the viewer.
 */
export function callLogSections<T extends SectionedLog>(
  logs: readonly T[],
  options: { userId: string; filter: CallLogFilter; locale: string; labels: { today: string; yesterday: string }; now?: Date },
): { title: string; data: T[] }[] {
  const sections: { title: string; data: T[] }[] = [];
  for (const log of logs) {
    if (options.filter === "missed" && !callLogView(log, options.userId).missed) continue;
    const ts = new Date(log.ended_at).getTime();
    const title = log.ended_at && !Number.isNaN(ts) ? formatMessageDay(ts, options.locale, options.labels, options.now) : "";
    const last = sections.at(-1);
    if (last && last.title === title) last.data.push(log);
    else sections.push({ title, data: [log] });
  }
  return sections;
}
