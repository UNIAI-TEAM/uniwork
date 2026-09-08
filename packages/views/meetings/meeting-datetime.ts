export const MEETING_TIMEZONES = [
  "Asia/Ho_Chi_Minh",
  "Asia/Bangkok",
  "Asia/Singapore",
  "Asia/Tokyo",
  "UTC",
  "Europe/London",
  "America/Los_Angeles",
] as const;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function splitIsoLocal(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    const now = new Date();
    return {
      date: `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`,
      time: `${pad2(now.getHours())}:${pad2(now.getMinutes())}`,
    };
  }
  return {
    date: `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`,
    time: `${pad2(d.getHours())}:${pad2(d.getMinutes())}`,
  };
}

export function combineLocalIso(date: string, time: string): string {
  const d = new Date(`${date}T${time}:00`);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

/** i18n language → BCP 47 tag the browser knows. */
export function meetingLocale(language?: string): string {
  return language?.startsWith("en") ? "en-GB" : "vi-VN";
}

function safeRange(
  startsAt: string,
  endsAt: string,
  locale: string,
  opts: Intl.DateTimeFormatOptions,
): string {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return "";
  try {
    // formatRange collapses the shared part ("28 thg 8, 09:00 – 09:30")
    // instead of printing the date twice.
    return new Intl.DateTimeFormat(locale, opts).formatRange(start, end);
  } catch {
    const f = new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" });
    return `${f.format(start)} – ${f.format(end)}`;
  }
}

/**
 * Date + time span in the viewer's clock, e.g. "28 thg 8, 2026, 09:00 – 09:30".
 * Every screen formats in the viewer's zone so list, detail and pre-join agree;
 * the meeting's stored `timezone` only seeds the schedule form.
 */
export function formatMeetingRange(startsAt: string, endsAt: string, locale = "vi-VN"): string {
  return safeRange(startsAt, endsAt, locale, { dateStyle: "medium", timeStyle: "short" });
}

/** Single start timestamp for invite and lobby screens: "7 thg 9, 2026, 13:30". */
export function formatMeetingStart(startsAt: string, locale = "vi-VN"): string {
  const start = new Date(startsAt);
  if (Number.isNaN(start.getTime())) return "";
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(start);
  } catch {
    return start.toLocaleString(locale);
  }
}

/** Time-only span for rows that already sit under a day heading: "09:00 – 09:30". */
export function formatMeetingTimes(startsAt: string, endsAt: string, locale = "vi-VN"): string {
  return safeRange(startsAt, endsAt, locale, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
}

/** Local calendar day of a timestamp, as a stable group key ("2026-08-28"). */
export function meetingDayKey(iso: string): string {
  return splitIsoLocal(iso).date;
}

/** Day heading for a group of meetings: "Thứ Năm, 28 tháng 8". */
export function formatMeetingDay(dayKey: string, locale = "vi-VN"): string {
  const d = new Date(`${dayKey}T12:00:00`);
  if (Number.isNaN(d.getTime())) return dayKey;
  return new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long" }).format(d);
}

/** Remaining time until `endsAt` as `HH:MM:SS`. Null when the stamp is unusable. */
export function formatRemaining(endsAt: string, nowMs = Date.now()): string | null {
  const end = Date.parse(endsAt);
  if (!Number.isFinite(end)) return null;
  const totalSec = Math.max(0, Math.floor((end - nowMs) / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${pad2(h)}:${pad2(m)}:${pad2(s)}`;
}

export function defaultScheduleDraft(): { date: string; start: string; end: string } {
  const start = new Date();
  start.setMinutes(0, 0, 0);
  start.setHours(start.getHours() + 1);
  const end = new Date(start.getTime() + 30 * 60 * 1000);
  return {
    date: `${start.getFullYear()}-${pad2(start.getMonth() + 1)}-${pad2(start.getDate())}`,
    start: `${pad2(start.getHours())}:${pad2(start.getMinutes())}`,
    end: `${pad2(end.getHours())}:${pad2(end.getMinutes())}`,
  };
}
