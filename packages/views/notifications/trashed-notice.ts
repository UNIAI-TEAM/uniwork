/**
 * The batch's purge date as the reader's calendar date, no time. The server
 * sends the raw RFC3339 `purge_after` (TRASH-NOTIFY-01 N-3); the day it falls
 * on is the viewer's, so the formatter is built per call and follows the
 * zone the viewer is in now. A value that is not a date is shown as sent
 * rather than as "Invalid Date".
 */
export function purgeDate(raw: string, locale: string): string {
  const at = new Date(raw);
  if (!raw || Number.isNaN(at.getTime())) return raw;
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(at);
}

/** How many other items of the batch the recipient owns; anything unreadable counts as none. */
export function trashedOtherCount(params: Record<string, string>): number {
  const n = Number.parseInt(params.count ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** The line under the sentence: the top item's name and how many more rode in its batch. */
export function trashedLine(document: string, more: string): string {
  const name = document.trim() ? `“${document.trim()}”` : "";
  return [name, more].filter(Boolean).join(" ");
}
