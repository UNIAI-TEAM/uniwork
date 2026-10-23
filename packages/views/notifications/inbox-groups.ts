import type { Notification } from "@uniwork/core/types";

export type InboxGroupKey = "unread" | "today" | "yesterday" | "week" | "older";

export interface InboxGroup {
  key: InboxGroupKey;
  rows: Notification[];
}

const DAY = 86_400_000;

/**
 * Unread first, all of it, because that is what needs the person; then what
 * they have already seen, by the viewer's calendar day: today, yesterday, the
 * rest of the last seven days, older. Rows keep the server's newest-first
 * order inside each group, and empty groups are dropped. A row in `pinned`
 * stays in the group recorded for it whatever its read state is now.
 */
export function groupInbox(
  rows: Notification[],
  now: Date,
  pinned: ReadonlyMap<string, InboxGroupKey> = new Map(),
): InboxGroup[] {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const start = today.getTime();
  const buckets: Record<InboxGroupKey, Notification[]> = { unread: [], today: [], yesterday: [], week: [], older: [] };
  for (const n of rows) {
    const pin = pinned.get(n.id);
    if (pin) {
      buckets[pin].push(n);
      continue;
    }
    if (!n.read_at) {
      buckets.unread.push(n);
      continue;
    }
    const at = new Date(n.created_at).getTime();
    if (Number.isNaN(at) || at >= start) buckets.today.push(n);
    else if (at >= start - DAY) buckets.yesterday.push(n);
    else if (at >= start - 6 * DAY) buckets.week.push(n);
    else buckets.older.push(n);
  }
  return (Object.keys(buckets) as InboxGroupKey[])
    .filter((key) => buckets[key].length > 0)
    .map((key) => ({ key, rows: buckets[key] }));
}
