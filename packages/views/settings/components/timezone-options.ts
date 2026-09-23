export interface TimezoneItem {
  /** IANA id, what the server stores. */
  value: string;
  /**
   * "(UTC+07:00) Hồ Chí Minh · Giờ Đông Dương": the offset people search by,
   * the place, then the zone's name in the reader's language.
   */
  label: string;
  offsetMinutes: number;
  /** Folded text the search matches: label, IANA id, offsets, city aliases. */
  search: string;
}

const FALLBACK_ZONES = ["Asia/Ho_Chi_Minh", "Asia/Bangkok", "Asia/Singapore", "Asia/Tokyo", "UTC"];

/**
 * Engines list some zones under a retired id (Asia/Saigon); the server and
 * every other client use the current one, so the list shows the current id.
 */
const CURRENT_ID: Record<string, string> = {
  "Asia/Saigon": "Asia/Ho_Chi_Minh",
  "Asia/Calcutta": "Asia/Kolkata",
  "Asia/Katmandu": "Asia/Kathmandu",
  "Asia/Rangoon": "Asia/Yangon",
  "Europe/Kiev": "Europe/Kyiv",
  "America/Godthab": "America/Nuuk",
  "Atlantic/Faeroe": "Atlantic/Faroe",
  "Pacific/Ponape": "Pacific/Pohnpei",
  "Pacific/Truk": "Pacific/Chuuk",
  "Pacific/Enderbury": "Pacific/Kanton",
};

/**
 * Places people type that the IANA id does not name. Vietnam is one zone,
 * filed under Ho Chi Minh City, so the capital and the other cities find it.
 */
const SEARCH_ALIASES: Record<string, string> = {
  "Asia/Ho_Chi_Minh": "Hà Nội Hanoi Sài Gòn Saigon Hồ Chí Minh Đà Nẵng Da Nang Hải Phòng Cần Thơ Việt Nam Vietnam",
  "Asia/Bangkok": "Thái Lan Thailand",
  "Asia/Phnom_Penh": "Campuchia Cambodia",
  "Asia/Vientiane": "Lào Laos",
};

/** The place's own spelling where the reader's language has one. */
const CITY_NAMES: Record<string, Record<string, string>> = {
  vi: { "Asia/Ho_Chi_Minh": "Hồ Chí Minh" },
};

const caches = new Map<string, TimezoneItem[]>();

/** Lowercase, no diacritics, "đ" as "d": "Hà Nội" and "ha noi" meet. */
export function foldSearchText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .replace(/[_/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** "GMT+7", "GMT+05:30", "GMT" → minutes east of UTC. */
function parseOffset(zoneName: string): number {
  const m = /([+-])(\d{1,2})(?::?(\d{2}))?/.exec(zoneName);
  if (!m) return 0;
  const minutes = Number(m[2]) * 60 + Number(m[3] ?? 0);
  return m[1] === "-" ? -minutes : minutes;
}

function formatOffset(minutes: number): string {
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return `UTC${sign}${hh}:${mm}`;
}

/** "UTC+7", "GMT+7", "UTC+5:30": the short forms people type. */
function shortOffsets(minutes: number): string {
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  const short = `${sign}${Math.floor(abs / 60)}${abs % 60 ? `:${String(abs % 60).padStart(2, "0")}` : ""}`;
  return `UTC${short} GMT${short}`;
}

function zoneName(zone: string, locale: string, style: "shortOffset" | "longGeneric", at: Date): string {
  try {
    return (
      new Intl.DateTimeFormat(locale, { timeZone: zone, timeZoneName: style })
        .formatToParts(at)
        .find((p) => p.type === "timeZoneName")?.value ?? ""
    );
  } catch {
    return "";
  }
}

function offsetOf(zone: string, at: Date): number {
  return parseOffset(zoneName(zone, "en-US", "shortOffset", at));
}

function cityOf(zone: string, locale: string): string {
  const own = CITY_NAMES[locale]?.[zone];
  if (own) return own;
  // Etc/GMT+5 reads backwards (it is UTC-5); the offset carries the meaning.
  if (zone.startsWith("Etc/") || !zone.includes("/")) return zone;
  return (zone.split("/").pop() ?? zone).replace(/_/g, " ");
}

function buildItem(value: string, locale: string, at: Date): TimezoneItem {
  const offsetMinutes = offsetOf(value, at);
  const city = cityOf(value, locale);
  const generic = zoneName(value, locale, "longGeneric", at);
  // An engine with no name for the zone answers "GMT+07:00": the offset
  // already says that, so the label keeps only the place.
  const named = generic && !/^(GMT|UTC)\b/.test(generic) ? generic : "";
  const label = `(${formatOffset(offsetMinutes)}) ${named ? `${city} · ${named}` : city}`;
  const search = foldSearchText(
    [label, value, shortOffsets(offsetMinutes), SEARCH_ALIASES[value] ?? ""].join(" "),
  );
  return { value, offsetMinutes, label, search };
}

/** Whether a folded query matches a zone; every word must appear somewhere. */
export function matchesTimezone(item: TimezoneItem, query: string): boolean {
  const words = foldSearchText(query).split(" ").filter(Boolean);
  return words.every((w) => item.search.includes(w));
}

/**
 * Every IANA zone the engine knows, sorted by offset then name, labelled in
 * `locale`. Built once per locale: ~400 `Intl` lookups are cheap once and
 * wasteful on every render.
 */
export function timezoneItems(current: string, locale = "en"): TimezoneItem[] {
  let cache = caches.get(locale);
  if (!cache) {
    const intl = Intl as unknown as { supportedValuesOf?: (k: string) => string[] };
    const listed = intl.supportedValuesOf ? intl.supportedValuesOf("timeZone") : FALLBACK_ZONES;
    const zones = [...new Set(listed.map((z) => CURRENT_ID[z] ?? z))];
    const now = new Date();
    cache = zones
      .map((value) => buildItem(value, locale, now))
      .sort((a, b) => a.offsetMinutes - b.offsetMinutes || a.value.localeCompare(b.value));
    caches.set(locale, cache);
  }
  if (!current || cache.some((z) => z.value === current)) return cache;
  // A zone the server holds but this engine does not list stays selectable,
  // in its offset's place.
  const extra = buildItem(current, locale, new Date());
  const at = cache.findIndex((z) => z.offsetMinutes > extra.offsetMinutes);
  return at === -1 ? [...cache, extra] : [...cache.slice(0, at), extra, ...cache.slice(at)];
}
