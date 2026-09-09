/**
 * Two profile fields arrive as machine values: a calendar date and an IANA
 * timezone id. "2024-03-18" and "Asia/Ho_Chi_Minh" are storage formats, so the
 * directory reads them out rather than printing them.
 */

/** i18n language → a BCP 47 tag the browser knows. */
function localeOf(language: string | undefined): string {
  return language?.startsWith("en") ? "en-GB" : "vi-VN";
}

/** A stored `YYYY-MM-DD` in the reader's language; anything else passes through. */
export function formatJoinedOn(value: string, language?: string): string {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!parts) return value;
  const [, year, month, day] = parts;
  // Built from the parts rather than parsed: `new Date("2024-03-18")` is UTC
  // midnight, which is the day before anywhere west of Greenwich.
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  if (Number.isNaN(date.getTime()) || date.getMonth() !== Number(month) - 1) return value;
  try {
    return date.toLocaleDateString(localeOf(language), { dateStyle: "long" });
  } catch {
    return value;
  }
}

/**
 * An IANA id read as offset then zone name: "GMT+7 · Giờ Đông Dương". The
 * offset comes first because it is the fact a colleague acts on — whether this
 * person is at their desk right now. An id the browser rejects falls back to
 * its city, which still beats showing the underscore.
 */
export function formatTimezone(value: string, language?: string): string {
  const zone = value.trim();
  if (zone === "") return "";
  const locale = localeOf(language);
  const offset = zoneName(locale, zone, "shortOffset");
  if (offset === "") return zone.split("/").at(-1)?.replace(/_/g, " ") ?? zone;
  const name = zoneName(locale, zone, "long");
  return name === "" || name === offset ? offset : `${offset} · ${name}`;
}

function zoneName(locale: string, timeZone: string, timeZoneName: "long" | "shortOffset"): string {
  try {
    const parts = new Intl.DateTimeFormat(locale, { timeZone, timeZoneName }).formatToParts(new Date());
    return parts.find((part) => part.type === "timeZoneName")?.value ?? "";
  } catch {
    return "";
  }
}
