import type { QueryClient, QueryKey } from "@tanstack/react-query";
import type { MeetingFeedPage, MeetingFeedQuery } from "../api/endpoints/meetings-feed";

/**
 * What the in-room chat and transcript queries cache (G7, G18): the rows
 * read so far, oldest first, and the two cursors that extend them. A realtime
 * frame invalidates the query; its query function then reads only the rows
 * after `afterCursor` and merges them, instead of the whole history.
 */
export type MeetingFeed<T> = { items: T[]; olderCursor: string; afterCursor: string };

export type MeetingFeedSpec<T> = {
  id: (row: T) => string;
  /** Reading order: negative when `a` comes first. */
  compare: (a: T, b: T) => number;
  fetch: (q: MeetingFeedQuery) => Promise<MeetingFeedPage<T>>;
};

/**
 * Adds rows not already present (by id) and keeps reading order. Returns
 * `list` itself when nothing is new, so a delta that only re-sent the overlap
 * does not re-render anything.
 */
export function mergeFeedRows<T>(list: T[], incoming: T[], spec: Pick<MeetingFeedSpec<T>, "id" | "compare">): T[] {
  const known = new Set(list.map(spec.id));
  const fresh: T[] = [];
  for (const row of incoming) {
    const id = spec.id(row);
    if (known.has(id)) continue;
    known.add(id);
    fresh.push(row);
  }
  if (fresh.length === 0) return list;
  fresh.sort(spec.compare);
  const last = list[list.length - 1];
  const first = fresh[0]!;
  if (last === undefined || spec.compare(last, first) <= 0) return [...list, ...fresh];
  return [...list, ...fresh].sort(spec.compare);
}

/**
 * The query function behind both feeds. With a cached `afterCursor` it reads
 * the delta and merges it into whatever the cache holds when the delta lands
 * (a send may have written its own row meanwhile). With no cursor, or when
 * the delta overflowed its page (a long disconnect), it reads the newest page
 * and starts over; older pages are one `before` read away.
 */
export async function readMeetingFeed<T>(
  qc: QueryClient,
  key: QueryKey,
  spec: MeetingFeedSpec<T>,
  signal?: AbortSignal,
): Promise<MeetingFeed<T>> {
  const cached = qc.getQueryData<MeetingFeed<T>>(key);
  if (cached?.afterCursor) {
    const delta = await spec.fetch({ after: cached.afterCursor, signal });
    if (!delta.hasMoreAfter) {
      const current = qc.getQueryData<MeetingFeed<T>>(key) ?? cached;
      return {
        items: mergeFeedRows(current.items, delta.items, spec),
        olderCursor: current.olderCursor,
        afterCursor: delta.afterCursor || current.afterCursor,
      };
    }
  }
  const page = await spec.fetch({ signal });
  return { items: page.items, olderCursor: page.olderCursor, afterCursor: page.afterCursor };
}

/** Prepends the page before the cached one; a no-op when nothing is older. */
export async function readOlderMeetingFeed<T>(qc: QueryClient, key: QueryKey, spec: MeetingFeedSpec<T>): Promise<void> {
  const cached = qc.getQueryData<MeetingFeed<T>>(key);
  if (!cached?.olderCursor) return;
  const page = await spec.fetch({ before: cached.olderCursor });
  qc.setQueryData<MeetingFeed<T>>(key, (prev) =>
    prev && prev.olderCursor === cached.olderCursor
      ? { ...prev, items: mergeFeedRows(prev.items, page.items, spec), olderCursor: page.olderCursor }
      : prev,
  );
}

/** A row the client already holds (its own send) goes straight into the cache. */
export function addMeetingFeedRow<T>(
  qc: QueryClient,
  key: QueryKey,
  spec: Pick<MeetingFeedSpec<T>, "id" | "compare">,
  row: T,
): void {
  qc.setQueryData<MeetingFeed<T>>(key, (prev) =>
    prev ? { ...prev, items: mergeFeedRows(prev.items, [row], spec) } : prev,
  );
}

export function feedRows<T>(feed: MeetingFeed<T>): T[] {
  return feed.items;
}

export function feedHasOlder<T>(feed: MeetingFeed<T>): boolean {
  return feed.olderCursor !== "";
}
