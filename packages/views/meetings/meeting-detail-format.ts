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

function shortOffset(zone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "shortOffset" }).formatToParts(new Date());
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
 */
export function meetingTimeZoneLabel(value: string, language: string): string {
  const zone = value.trim();
  if (zone === "") return "";
  if (zone === "UTC" || zone === "Etc/UTC") return "UTC";
  const offset = shortOffset(zone);
  const city = cityOf(zone, language);
  return offset ? `${offset} · ${city}` : city;
}
