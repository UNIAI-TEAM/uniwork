/**
 * Wall-clock time of an instant, in the person's zone when the summary names
 * one (the same zone "today" is computed in), else the viewer's.
 */
export function clock(iso: string, locale: string, timeZone?: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const opts: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit", hourCycle: "h23" };
  try {
    return new Intl.DateTimeFormat(locale, { ...opts, timeZone: timeZone || undefined }).format(d);
  } catch {
    return new Intl.DateTimeFormat(locale, opts).format(d);
  }
}

/** Hour of day (0–23) now, in the given zone when it is a real one. */
export function hourIn(timeZone: string | undefined, now = new Date()): number {
  try {
    const h = new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: timeZone || undefined }).format(now);
    const n = Number.parseInt(h, 10);
    return Number.isNaN(n) ? now.getHours() : n;
  } catch {
    return now.getHours();
  }
}

/** Whole minutes between two instants; 0 when either is unusable or they are reversed. */
export function minutesBetween(startIso: string, endIso: string): number {
  const ms = Date.parse(endIso) - Date.parse(startIso);
  return Number.isFinite(ms) && ms > 0 ? Math.round(ms / 60_000) : 0;
}
