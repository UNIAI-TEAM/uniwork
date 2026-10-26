import type { useTranslation } from "react-i18next";
import { formatMeetingClock, splitIsoLocal } from "../meeting-datetime";

/**
 * The meeting detail page's time words (kit boards): "còn 17 giờ", "24 phút",
 * "đã họp 1 giờ 24 phút", "T5 22/10", "Thứ Năm 22/10", "09:00–09:28". Every
 * helper takes the clock (`nowMs`) and an optional IANA `timeZone` (the
 * viewer's own when omitted), so a test or a frozen capture pins both.
 */

type TFunction = ReturnType<typeof useTranslation>["t"];

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

const parse = (iso: string | null | undefined): number => (iso ? Date.parse(iso) : NaN);

/** "1 giờ 24 phút", "45 phút", "2 giờ": whole minutes in the hero's duration words. */
export function durationWords(minutes: number, t: TFunction): string {
  const total = Math.max(0, Math.floor(minutes));
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  return [
    hours > 0 ? t("meetings.durationHours", { count: hours }) : null,
    rest > 0 || hours === 0 ? t("meetings.durationMinutes", { count: rest }) : null,
  ]
    .filter(Boolean)
    .join(" ");
}

/** Calendar day of an instant in `timeZone` as a UTC-midnight stamp, so day arithmetic ignores DST. */
function dayStamp(ms: number, timeZone?: string): number {
  const [y, m, d] = splitIsoLocal(new Date(ms).toISOString(), timeZone).date.split("-").map(Number);
  return Date.UTC(y!, m! - 1, d!);
}

/**
 * Time left until `iso`: "còn 50 phút" under an hour, "còn 17 giờ" under a
 * day (rounded), then "còn 6 ngày" by calendar day. Empty once it has passed
 * or for a bad stamp.
 */
export function untilWords(iso: string | null | undefined, nowMs: number, t: TFunction, timeZone?: string): string {
  const at = parse(iso);
  if (!Number.isFinite(at) || at <= nowMs) return "";
  const left = at - nowMs;
  const duration =
    left < HOUR
      ? t("meetings.durationMinutes", { count: Math.ceil(left / MINUTE) })
      : left < 24 * HOUR
        ? t("meetings.durationHours", { count: Math.round(left / HOUR) })
        : t("meetings.detail.format.days", {
            count: Math.round((dayStamp(at, timeZone) - dayStamp(nowMs, timeZone)) / (24 * HOUR)),
          });
  return t("meetings.detail.format.until", { duration });
}

/**
 * Time since `iso` (the actual start): "24 phút" for the live pill, or with
 * `held` "đã họp 1 giờ 24 phút" for the overtime meta line. Empty for a bad
 * stamp; never negative.
 */
export function elapsedWords(
  iso: string | null | undefined,
  nowMs: number,
  t: TFunction,
  opts: { held?: boolean } = {},
): string {
  const at = parse(iso);
  if (!Number.isFinite(at)) return "";
  const duration = durationWords((nowMs - at) / MINUTE, t);
  return opts.held ? t("meetings.detail.format.held", { duration }) : duration;
}

/** Time past the scheduled end, for "Quá giờ · 10 phút". Empty before the end or for a bad stamp. */
export function overtimeWords(endsAt: string | null | undefined, nowMs: number, t: TFunction): string {
  const at = parse(endsAt);
  if (!Number.isFinite(at) || nowMs < at) return "";
  return durationWords((nowMs - at) / MINUTE, t);
}

function dayParts(iso: string, nowMs: number, timeZone?: string): { weekday: number; date: string } | null {
  const ms = parse(iso);
  if (!Number.isFinite(ms)) return null;
  const [y, m, d] = splitIsoLocal(iso, timeZone).date.split("-");
  const weekday = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d))).getUTCDay();
  // Another year says which one, so last October never reads as this one.
  const thisYear = splitIsoLocal(new Date(nowMs).toISOString(), timeZone).date.slice(0, 4);
  return { weekday, date: y === thisYear ? `${d}/${m}` : `${d}/${m}/${y}` };
}

/** "T5 22/10" (vi) / "Thu 22/10" (en); the year only when it is not this one. Empty for a bad stamp. */
export function shortDay(iso: string, nowMs: number, t: TFunction, timeZone?: string): string {
  const parts = dayParts(iso, nowMs, timeZone);
  if (!parts) return "";
  return t("meetings.detail.format.day", { weekday: t(`meetings.detail.format.wd_${parts.weekday}`), date: parts.date });
}

/** "Thứ Năm 22/10" (vi) / "Thursday 22/10" (en), the header's day. Empty for a bad stamp. */
export function longDay(iso: string, nowMs: number, t: TFunction, timeZone?: string): string {
  const parts = dayParts(iso, nowMs, timeZone);
  if (!parts) return "";
  return t("meetings.detail.format.day", {
    weekday: t(`meetings.detail.format.wdLong_${parts.weekday}`),
    date: parts.date,
  });
}

/** "hôm nay" / "hôm qua" / "ngày mai" beside the header's day; null for any other day. */
export function dayWord(iso: string, nowMs: number, t: TFunction, timeZone?: string): string | null {
  const ms = parse(iso);
  if (!Number.isFinite(ms)) return null;
  const diff = Math.round((dayStamp(ms, timeZone) - dayStamp(nowMs, timeZone)) / (24 * HOUR));
  if (diff === 0) return t("meetings.detail.format.today");
  if (diff === -1) return t("meetings.detail.format.yesterday");
  if (diff === 1) return t("meetings.detail.format.tomorrow");
  return null;
}

/** "09:06": a 24-hour wall clock (same in vi and en). Empty for a bad stamp. */
export function clock(iso: string | null | undefined, timeZone?: string): string {
  const ms = parse(iso);
  return Number.isFinite(ms) ? formatMeetingClock(ms, "vi-VN", timeZone) : "";
}

/** "09:00–09:28", the kit's range (en dash, no spaces). Empty when either end is bad. */
export function clockRange(startIso: string, endIso: string, timeZone?: string): string {
  const from = clock(startIso, timeZone);
  const to = clock(endIso, timeZone);
  return from && to ? `${from}–${to}` : "";
}
