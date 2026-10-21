/**
 * Reading helpers for the meeting detail page: storage values ("Asia/Ho_Chi_Minh")
 * turned into what a colleague reads ("GMT+7 · Hồ Chí Minh").
 */

/** Cities whose name differs from the IANA segment, per UI language. */
const CITY_NAMES: Record<string, { vi: string; en: string }> = {
  "Asia/Ho_Chi_Minh": { vi: "Hồ Chí Minh", en: "Ho Chi Minh City" },
  "Asia/Saigon": { vi: "Hồ Chí Minh", en: "Ho Chi Minh City" },
  "Asia/Hanoi": { vi: "Hà Nội", en: "Hanoi" },
};

function cityOf(zone: string, language: string): string {
  const named = CITY_NAMES[zone];
  if (named) return language.startsWith("en") ? named.en : named.vi;
  return zone.split("/").at(-1)?.replace(/_/g, " ") ?? zone;
}

function shortOffset(zone: string, at: Date): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "shortOffset" }).formatToParts(at);
    const value = parts.find((part) => part.type === "timeZoneName")?.value ?? "";
    // ICU 76+ prints UTC itself as "GMT".
    return value === "GMT" ? "GMT+0" : value;
  } catch {
    return "";
  }
}

/**
 * Offset first, because that is what someone acts on (is it their morning?),
 * then the city. A zone the browser rejects falls back to its city alone.
 * `at` picks the offset in force then (a meeting after a DST switch).
 */
export function meetingTimeZoneLabel(value: string, language: string, at: Date = new Date()): string {
  const zone = value.trim();
  if (zone === "") return "";
  if (zone === "UTC" || zone === "Etc/UTC") return "UTC";
  const offset = shortOffset(zone, Number.isNaN(at.getTime()) ? new Date() : at);
  const city = cityOf(zone, language);
  return offset ? `${offset} · ${city}` : city;
}

/**
 * A moment on the detail page in the hero's date style plus the clock, in the
 * viewer's zone: "Thứ Tư, 21 tháng 10, 15:59". Empty for a bad timestamp.
 */
export function formatMeetingDayTime(iso: string | null | undefined, locale: string): string {
  const ms = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(ms)) return "";
  // Two formatters: vi-VN would put the clock first ("lúc 15:59 Thứ Tư, …").
  // A moment from another year says which one; this year's reads like the hero.
  const year = new Date(ms).getFullYear() === new Date().getFullYear() ? {} : { year: "numeric" as const };
  const day = new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long", ...year }).format(ms);
  const clock = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(ms);
  return `${day}, ${clock}`;
}
