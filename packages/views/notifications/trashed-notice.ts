/**
 * The batch's purge date as the reader's calendar date, no time. The server
 * sends `purge_after` as RFC3339 by contract (TRASH-NOTIFY-01 N-3); the day it
 * falls on is the viewer's, so the formatter is built per call and follows the
 * zone the viewer is in now. A value that is not a date formats as "" and the
 * sentence drops the date part (`notificationTitleKey`), never "Invalid Date".
 */
export function isPurgeDate(raw: string): boolean {
  return Boolean(raw) && !Number.isNaN(new Date(raw).getTime());
}

export function purgeDate(raw: string, locale: string): string {
  return isPurgeDate(raw) ? new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(raw)) : "";
}

/** How many other items of the batch the recipient owns; anything unreadable counts as none. */
export function trashedOtherCount(params: Record<string, string>): number {
  const n = Number.parseInt(params.count ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** The top item's name as the line under the sentence quotes it. */
export function quoted(document: string): string {
  return `“${document.trim()}”`;
}
