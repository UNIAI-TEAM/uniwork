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

/** "14:05" — the time printed on a message. */
export function formatMessageTime(ts: number, locale: string): string {
  return new Date(ts).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
}

/** Full date and time for the tooltip on a message's time. */
export function formatMessageDateTime(ts: number, locale: string): string {
  return new Date(ts).toLocaleString(locale, { dateStyle: "full", timeStyle: "short" });
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
