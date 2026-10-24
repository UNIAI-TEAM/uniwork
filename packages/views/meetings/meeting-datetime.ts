import type { useTranslation } from "react-i18next";

type TFunction = ReturnType<typeof useTranslation>["t"];

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

type WallClock = { year: number; month: number; day: number; hour: number; minute: number; second: number };

const partsFormatters = new Map<string, Intl.DateTimeFormat | null>();

/** One formatter per zone; null for a zone this engine does not know. */
function partsFormatter(timeZone: string): Intl.DateTimeFormat | null {
  if (!partsFormatters.has(timeZone)) {
    try {
      partsFormatters.set(
        timeZone,
        new Intl.DateTimeFormat("en-US", {
          timeZone,
          hourCycle: "h23",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }),
      );
    } catch {
      partsFormatters.set(timeZone, null);
    }
  }
  return partsFormatters.get(timeZone) ?? null;
}

function wallClockIn(ms: number, fmt: Intl.DateTimeFormat): WallClock {
  const parts = fmt.formatToParts(ms);
  const read = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    // Some engines still print midnight as "24" under h23.
    hour: read("hour") % 24,
    minute: read("minute"),
    second: read("second"),
  };
}

/** The zone's offset from UTC at an instant, in ms (Tokyo: +9h). */
function offsetAt(ms: number, fmt: Intl.DateTimeFormat): number {
  const w = wallClockIn(ms, fmt);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return asUtc - (ms - (((ms % 1000) + 1000) % 1000));
}

function toParts(date: Date): { date: string; time: string } {
  return {
    date: `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`,
    time: `${pad2(date.getHours())}:${pad2(date.getMinutes())}`,
  };
}

/**
 * An instant as the date and time a clock shows in `timeZone` (an IANA name),
 * or in the browser's zone when none is given or the engine does not know it.
 */
export function splitIsoLocal(iso: string, timeZone?: string): { date: string; time: string } {
  const d = new Date(iso);
  const valid = !Number.isNaN(d.getTime());
  const ms = valid ? d.getTime() : Date.now();
  const fmt = timeZone ? partsFormatter(timeZone) : null;
  if (!fmt) return toParts(valid ? d : new Date(ms));
  const w = wallClockIn(ms, fmt);
  return { date: `${w.year}-${pad2(w.month)}-${pad2(w.day)}`, time: `${pad2(w.hour)}:${pad2(w.minute)}` };
}

/**
 * Wall-clock `date` + `time` in `timeZone` as an ISO instant. The offset is
 * looked up at the candidate instant and again at the corrected one, so a
 * time on a DST day lands on the right side of the switch. A time inside a
 * spring-forward gap moves forward (02:30 → 03:30), and one that happens twice
 * takes the first occurrence — what the browser does for its own zone.
 */
export function combineLocalIso(date: string, time: string, timeZone?: string): string {
  const fmt = timeZone ? partsFormatter(timeZone) : null;
  if (!fmt) {
    const d = new Date(`${date}T${time}:00`);
    return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
  }
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const tm = /^(\d{2}):(\d{2})$/.exec(time);
  if (!dm || !tm) return new Date().toISOString();
  const wall = Date.UTC(Number(dm[1]), Number(dm[2]) - 1, Number(dm[3]), Number(tm[1]), Number(tm[2]));
  if (Number.isNaN(wall)) return new Date().toISOString();
  const first = offsetAt(wall, fmt);
  const second = offsetAt(wall - first, fmt);
  if (first === second) return new Date(wall - first).toISOString();
  const third = offsetAt(wall - second, fmt);
  if (third === second) return new Date(wall - second).toISOString();
  // In the gap neither offset round-trips; the earlier (smaller) one moves forward.
  return new Date(wall - Math.min(second, third)).toISOString();
}

/** Adds whole days to a "YYYY-MM-DD" key without touching any clock. */
function nextDayKey(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return date;
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * The instants a schedule form sends. An end at or before the start is read
 * as the next day, so a meeting may run past midnight instead of being
 * clamped into a sliver of the day it started on.
 */
export function scheduleWindowIso(
  date: string,
  start: string,
  end: string,
  timeZone?: string,
): { starts_at: string; ends_at: string; overnight: boolean } {
  const overnight = end <= start;
  return {
    starts_at: combineLocalIso(date, start, timeZone),
    ends_at: combineLocalIso(overnight ? nextDayKey(date) : date, end, timeZone),
    overnight,
  };
}

/**
 * Whether two zones read the same clock at an instant. Names differ for the
 * same place (Asia/Saigon, Asia/Ho_Chi_Minh), so the offset is what counts.
 */
export function sameUtcOffset(a: string, b: string, atMs = Date.now()): boolean {
  if (a === b) return true;
  const fa = partsFormatter(a);
  const fb = partsFormatter(b);
  if (!fa || !fb) return false;
  return offsetAt(atMs, fa) === offsetAt(atMs, fb);
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
  timeZone?: string,
): string {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return "";
  try {
    // formatRange collapses the shared part ("28 thg 8, 09:00 – 09:30")
    // instead of printing the date twice.
    return new Intl.DateTimeFormat(locale, { ...opts, timeZone }).formatRange(start, end);
  } catch {
    const f = new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" });
    return `${f.format(start)} – ${f.format(end)}`;
  }
}

/** Time-only span for rows that already sit under a day heading: "09:00 – 09:30". */
export function formatMeetingTimes(startsAt: string, endsAt: string, locale = "vi-VN", timeZone?: string): string {
  return safeRange(startsAt, endsAt, locale, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }, timeZone);
}

/** Local calendar day of a timestamp, as a stable group key ("2026-08-28"). */
export function meetingDayKey(iso: string): string {
  return splitIsoLocal(iso).date;
}

/** The one way a meetings screen writes a day: "Thứ Năm, 28 tháng 8". */
export const MEETING_DAY_FORMAT: Intl.DateTimeFormatOptions = { weekday: "long", day: "numeric", month: "long" };

/**
 * Day heading for a group of meetings: "Thứ Năm, 28 tháng 8". A day from
 * another year says which one, so last October never reads as this one.
 */
export function formatMeetingDay(dayKey: string, locale = "vi-VN"): string {
  const d = new Date(`${dayKey}T12:00:00`);
  if (Number.isNaN(d.getTime())) return dayKey;
  const year = d.getFullYear() === new Date().getFullYear() ? {} : { year: "numeric" as const };
  return new Intl.DateTimeFormat(locale, { ...MEETING_DAY_FORMAT, ...year }).format(d);
}

/** "16:59" in the viewer's clock, or in `timeZone` when given. */
export function formatMeetingClock(ms: number, locale: string, timeZone?: string): string {
  const opts: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit", hourCycle: "h23" };
  try {
    return new Intl.DateTimeFormat(locale, { ...opts, timeZone }).format(ms);
  } catch {
    return new Intl.DateTimeFormat(locale, opts).format(ms);
  }
}

/**
 * A window in the hero's words: its day and the clock span, in the viewer's
 * zone or `timeZone`. `nextDay` marks one that ends the following day (the
 * schedule form's "ends the next day"); a longer one names the end's day too.
 */
export function meetingWindowParts(
  startsAt: string,
  endsAt: string,
  locale = "vi-VN",
  timeZone?: string,
): { dayKey: string; day: string; times: string; nextDay: boolean } | null {
  const start = Date.parse(startsAt);
  const end = Date.parse(endsAt);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  const dayKey = splitIsoLocal(startsAt, timeZone).date;
  const endKey = splitIsoLocal(endsAt, timeZone).date;
  const day = formatMeetingDay(dayKey, locale);
  if (endKey <= dayKey) return { dayKey, day, times: formatMeetingTimes(startsAt, endsAt, locale, timeZone), nextDay: false };
  const from = formatMeetingClock(start, locale, timeZone);
  const to = formatMeetingClock(end, locale, timeZone);
  if (endKey === nextDayKey(dayKey)) return { dayKey, day, times: `${from} – ${to}`, nextDay: true };
  return { dayKey, day, times: `${from} – ${formatMeetingDay(endKey, locale)}, ${to}`, nextDay: false };
}

/** "Thứ Tư, 21 tháng 10 · 23:57 – 00:57 (hôm sau)": a window on one line (room header, pre-join). */
export function formatMeetingWindow(startsAt: string, endsAt: string, locale: string, t: TFunction): string {
  const parts = meetingWindowParts(startsAt, endsAt, locale);
  if (!parts) return "";
  const times = parts.nextDay ? t("meetings.timesNextDay", { times: parts.times }) : parts.times;
  return t("meetings.windowOnDay", { day: parts.day, times });
}

/**
 * The window a meeting is told by: the schedule, until it has ended with
 * both actual times on record — then when it really ran, so an instant
 * meeting closed after two minutes does not read as its default hour.
 */
export function meetingShownWindow(
  meeting: { starts_at: string; ends_at: string; actual_start_at?: string; actual_end_at?: string },
  ended: boolean,
): { startsAt: string; endsAt: string } {
  const start = meeting.actual_start_at ?? "";
  const end = meeting.actual_end_at ?? "";
  const ran = ended && Number.isFinite(Date.parse(start)) && Date.parse(end) >= Date.parse(start);
  return ran ? { startsAt: start, endsAt: end } : { startsAt: meeting.starts_at, endsAt: meeting.ends_at };
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

export type ScheduleDraft = { date: string; start: string; end: string };

export function defaultScheduleDraft(): ScheduleDraft {
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
