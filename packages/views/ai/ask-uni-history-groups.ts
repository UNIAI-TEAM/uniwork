import type { AiConversation } from "@uniwork/core/types";

export type HistoryGroupKey = "today" | "yesterday" | "week" | "older";

const DAY_MS = 86_400_000;

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Whole local days between `iso` and `now`; null for an unparsable date. */
function daysAgo(iso: string, now: Date): number | null {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  return Math.round((startOfDay(now) - startOfDay(at)) / DAY_MS);
}

function keyOf(days: number | null): HistoryGroupKey {
  if (days === null || days >= 7) return "older";
  if (days <= 0) return "today";
  return days === 1 ? "yesterday" : "week";
}

/** Groups by local `updated_at`, keeps the given order inside a group, drops empty groups. */
export function groupConversations(
  list: AiConversation[],
  now: Date,
): { key: HistoryGroupKey; items: AiConversation[] }[] {
  const order: HistoryGroupKey[] = ["today", "yesterday", "week", "older"];
  const buckets = new Map<HistoryGroupKey, AiConversation[]>(order.map((k) => [k, []]));
  for (const c of list) buckets.get(keyOf(daysAgo(c.updated_at, now)))?.push(c);
  return order.flatMap((key) => {
    const items = buckets.get(key) ?? [];
    return items.length > 0 ? [{ key, items }] : [];
  });
}

/** Today: HH:mm. Within 7 days: weekday. Older: dd/MM. Invalid input: "". */
export function formatConversationTime(iso: string, now: Date, locale: string): string {
  const days = daysAgo(iso, now);
  if (days === null) return "";
  const at = new Date(iso);
  if (days <= 0) return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", hour12: false }).format(at);
  if (days < 7) return new Intl.DateTimeFormat(locale, { weekday: "short" }).format(at);
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "2-digit" }).format(at);
}
