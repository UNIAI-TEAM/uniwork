// Ported from packages/views/chat/use-chat-catch-up-ui.ts (unreadSinceOf) and
// packages/views/chat/native-chat-message-item.tsx (firstUnreadIndex, sentAtMs).
// Where a conversation's unread messages begin when it opens: the room's own read pointer and unread count, taken
// from the inbox before opening marks the room read, and the first message
// from someone else sent after it. The conversation draws
// "N tin chưa đọc" above that message and opens on it, as WhatsApp, Telegram
// and Slack do.
import type { ChatRoomRecord } from "@uniwork/core/api/endpoints/chat-schemas";
import type { TimelineMessage } from "./timeline-display";

export interface UnreadSnapshot {
  /** The reader's read pointer when the room opened. */
  since: string;
  /** How many were unread then (0: unknown, the divider says "Tin mới"). */
  count: number;
}

/** The room's read pointer while it still has unread messages, else none. */
export function unreadSnapshot(
  room: Pick<ChatRoomRecord, "unread_count" | "mention_unread_count" | "last_read_at"> | undefined,
): UnreadSnapshot | null {
  const hasUnread = (room?.unread_count ?? 0) > 0 || (room?.mention_unread_count ?? 0) > 0;
  return hasUnread && room?.last_read_at ? { since: room.last_read_at, count: room.unread_count } : null;
}

/** Sent-at in ms, from the micro-precision cursor when there is one (created_at is whole seconds). */
function sentAtMs(message: TimelineMessage): number {
  const micros = Number(message.record?.cursor?.split(".")[0]);
  return Number.isFinite(micros) && micros > 0 ? micros / 1000 : message.ts;
}

/**
 * The first message from someone else sent after `since` (oldest first), or null. One's own and unsent ones never
 * start it. When the oldest loaded message is already unread and older pages remain (`complete` false), the real
 * first unread is further up than what is loaded: no line, rather than one in the wrong place.
 */
export function firstUnreadMessageId(
  messages: readonly TimelineMessage[],
  currentUserId: string,
  since: string | null,
  complete: boolean,
): string | null {
  const at = since ? Date.parse(since) : Number.NaN;
  if (Number.isNaN(at)) return null;
  const first = messages.find((message) => message.sender !== currentUserId && !message.pending && sentAtMs(message) > at);
  if (!first) return null;
  const before = messages.slice(0, messages.indexOf(first));
  if (!complete && before.every((message) => message.sender === currentUserId || sentAtMs(message) > at)) return null;
  return first.id;
}

/**
 * How many older pages a room opened with unread messages loads, at most, to find where they begin (50 messages a
 * page: the line is drawn for up to 250 unread, within the eight pages the sliding window keeps,
 * data/timeline-window.ts). Past that the room opens at the newest message with no line.
 */
export const UNREAD_BACKFILL_PAGES = 4;

/** True when only the history not loaded yet keeps the unread line from being drawn: an older page would place it. */
export function unreadLineNeedsOlder(messages: readonly TimelineMessage[], currentUserId: string, since: string | null, complete: boolean): boolean {
  return (
    !complete &&
    firstUnreadMessageId(messages, currentUserId, since, false) === null &&
    firstUnreadMessageId(messages, currentUserId, since, true) !== null
  );
}
