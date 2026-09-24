const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function formatCommentTimeAgo(value: string | undefined, locale: string, now = Date.now()): string | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  const elapsed = timestamp - now;
  const absolute = Math.abs(elapsed);
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (absolute < MINUTE) return formatter.format(0, "second");
  if (absolute < HOUR) return formatter.format(Math.round(elapsed / MINUTE), "minute");
  if (absolute < DAY) return formatter.format(Math.round(elapsed / HOUR), "hour");
  return formatter.format(Math.round(elapsed / DAY), "day");
}

export function formatCommentDateTime(value: string | undefined, locale: string): string | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(timestamp);
}
