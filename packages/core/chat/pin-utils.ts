/** Max pinned messages per room; server enforces the same number. */
export const CHAT_PINNED_MESSAGES_MAX = 10;

type PinnedSortable = { pinned_at?: string; created_at: string };

/** Newest pin first (by pinned_at, then message time). */
export function comparePinnedMessages(a: PinnedSortable, b: PinnedSortable): number {
  const aAt = pinnedSortKey(a);
  const bAt = pinnedSortKey(b);
  return bAt - aAt;
}

function pinnedSortKey(row: PinnedSortable): number {
  const pinnedAt = Date.parse(row.pinned_at ?? "");
  if (Number.isFinite(pinnedAt)) return pinnedAt;
  const created = Date.parse(row.created_at);
  return Number.isFinite(created) ? created : 0;
}
