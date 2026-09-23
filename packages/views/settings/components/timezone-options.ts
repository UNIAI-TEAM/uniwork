interface TimezoneItem {
  /** IANA id, what the server stores. */
  value: string;
  /** "(UTC+07:00) Asia/Ho Chi Minh": the offset people search by, then the place. */
  label: string;
  offsetMinutes: number;
}

const FALLBACK_ZONES = ["Asia/Ho_Chi_Minh", "Asia/Bangkok", "Asia/Singapore", "Asia/Tokyo", "UTC"];

let cache: TimezoneItem[] | null = null;

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

function offsetOf(zone: string, at: Date): number {
  try {
    const part = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "shortOffset" })
      .formatToParts(at)
      .find((p) => p.type === "timeZoneName");
    return parseOffset(part?.value ?? "");
  } catch {
    return 0;
  }
}

function timezoneLabel(zone: string, offsetMinutes: number): string {
  return `(${formatOffset(offsetMinutes)}) ${zone.replace(/_/g, " ")}`;
}

/**
 * Every IANA zone the engine knows, sorted by offset then name. Built once per
 * page: ~600 `Intl` lookups are cheap once and wasteful on every render.
 */
export function timezoneItems(current: string): TimezoneItem[] {
  if (!cache) {
    const intl = Intl as unknown as { supportedValuesOf?: (k: string) => string[] };
    const zones = intl.supportedValuesOf ? intl.supportedValuesOf("timeZone") : FALLBACK_ZONES;
    const now = new Date();
    cache = zones
      .map((value) => {
        const offsetMinutes = offsetOf(value, now);
        return { value, offsetMinutes, label: timezoneLabel(value, offsetMinutes) };
      })
      .sort((a, b) => a.offsetMinutes - b.offsetMinutes || a.value.localeCompare(b.value));
  }
  if (!current || cache.some((z) => z.value === current)) return cache;
  // A zone the server holds but this engine does not list stays selectable, in
  // its offset's place: engines list canonical ids, so Asia/Ho_Chi_Minh (our
  // default) is missing where the engine says Asia/Saigon.
  const offsetMinutes = offsetOf(current, new Date());
  const extra = { value: current, offsetMinutes, label: timezoneLabel(current, offsetMinutes) };
  const at = cache.findIndex((z) => z.offsetMinutes > offsetMinutes);
  return at === -1 ? [...cache, extra] : [...cache.slice(0, at), extra, ...cache.slice(at)];
}
