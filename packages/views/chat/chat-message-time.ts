/**
 * Time labels for the message timeline. Every formatter takes the app's
 * locale explicitly — the browser's default would print an English date in
 * a Vietnamese UI.
 */

function startOfDay(value: Date): number {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
}

/** Local calendar day of a timestamp, as a comparable key. */
export function messageDayKey(ts: number): number {
  return startOfDay(new Date(ts));
}

// A timeline formats hundreds of times per render; building an Intl
// formatter is the expensive part, so keep one per locale and shape.
const timeFormatters = new Map<string, Intl.DateTimeFormat>();
const dateTimeFormatters = new Map<string, Intl.DateTimeFormat>();

function cachedFormatter(
  cache: Map<string, Intl.DateTimeFormat>,
  locale: string,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  let formatter = cache.get(locale);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, options);
    cache.set(locale, formatter);
  }
  return formatter;
}

/** "14:05" — the time printed on a message. */
export function formatMessageTime(ts: number, locale: string): string {
  return cachedFormatter(timeFormatters, locale, { hour: "2-digit", minute: "2-digit" }).format(ts);
}

/** Full date and time for the tooltip on a message's time. */
export function formatMessageDateTime(ts: number, locale: string): string {
  return cachedFormatter(dateTimeFormatters, locale, { dateStyle: "full", timeStyle: "short" }).format(ts);
}

/**
 * The day separator: today and yesterday by name, this week by weekday,
 * anything older by date (with the year only when it is not this year).
 */
export function formatMessageDay(
  ts: number,
  locale: string,
  labels: { today: string; yesterday: string },
  now: Date = new Date(),
): string {
  const date = new Date(ts);
  const diff = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
  if (diff === 0) return labels.today;
  if (diff === 1) return labels.yesterday;
  if (diff > 1 && diff < 7) return date.toLocaleDateString(locale, { weekday: "long" });
  return date.toLocaleDateString(locale, {
    day: "numeric",
    month: "long",
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
}
