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

/**
 * Date + time span in the viewer's clock, e.g. "28 thg 8, 2026, 09:00 – 09:30".
 * Every screen formats in the viewer's zone so list, detail and pre-join agree;
 * `timeZone` is for the one place that also shows the meeting's own clock.
 */
export function formatMeetingRange(startsAt: string, endsAt: string, locale = "vi-VN", timeZone?: string): string {
  return safeRange(startsAt, endsAt, locale, { dateStyle: "medium", timeStyle: "short" }, timeZone);
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
export function formatMeetingTimes(startsAt: string, endsAt: string, locale = "vi-VN", timeZone?: string): string {
  return safeRange(startsAt, endsAt, locale, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }, timeZone);
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

export type ScheduleDraft = { date: string; start: string; end: string };

export function scheduleDraftFromDefaults(scheduleDefaults?: ScheduleDraft): ScheduleDraft {
  return scheduleDefaults ?? defaultScheduleDraft();
}

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
