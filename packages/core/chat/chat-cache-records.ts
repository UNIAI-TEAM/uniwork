// How one server message lands in a cached list: pure record transforms over
// the room list, a timeline page and a thread, with no query client, store or
// transport. realtime-cache.ts (the web) and the phone's data/chat-cache.ts
// (apps/chat-mobile, ADR 0011) both apply frames through these, so a fix to
// what a frame does to a record lands once.
import type { ChatMessageRecord, ChatRoomRecord } from "../api/endpoints/chat-schemas";
import { isDefaultWorkspaceChannel } from "./chat-room-helpers";
import {
  CHAT_MESSAGE_CACHE_MAX,
  compareMessages,
  insertCreatedTimelineMessage,
  replaceTimelineMessage,
  roomTimelineHas,
  type RoomTimeline,
} from "./room-timeline-pages";

export function mergeMessageIntoList(
  existing: ChatMessageRecord[] | undefined,
  message: ChatMessageRecord,
): ChatMessageRecord[] {
  const list = existing ?? [];
  const index = list.findIndex((entry) => entry.id === message.id);
  const next =
    index >= 0
      ? [...list.slice(0, index), message, ...list.slice(index + 1)]
      : [...list, message].sort(
          (a, b) => Date.parse(a.created_at) - Date.parse(b.created_at),
        );
  if (next.length <= CHAT_MESSAGE_CACHE_MAX) return next;
  return next.slice(next.length - CHAT_MESSAGE_CACHE_MAX);
}

/** An update to a flat list: replace in place, never insert. */
export function replaceMessageInList(existing: ChatMessageRecord[], message: ChatMessageRecord): ChatMessageRecord[] {
  return existing.some((entry) => entry.id === message.id)
    ? existing.map((entry) => (entry.id === message.id ? message : entry))
    : existing;
}

export function removeMessageFromList(
  existing: ChatMessageRecord[] | undefined,
  messageId: string,
): ChatMessageRecord[] {
  return (existing ?? []).filter((entry) => entry.id !== messageId);
}

export function patchRoomSidebarFromMessage(
  rooms: ChatRoomRecord[] | undefined,
  roomId: string,
  message: ChatMessageRecord,
  options?: { incrementUnread?: boolean; incrementMentionUnread?: boolean },
): ChatRoomRecord[] {
  if (!rooms) return [];
  const updated = rooms.map((room) => {
    if (room.id !== roomId) return room;
    return {
      ...room,
      last_message_body: message.body,
      last_message_kind: message.kind ?? "text",
      last_message_sender_id: message.sender_id,
      last_message_sender_name: message.sender_display_name,
      // The list line's call outcome and voice length, as the room list sends them.
      last_message_call_outcome: message.kind === "voice_call_log" ? message.voice_call?.outcome : undefined,
      last_message_duration_ms: message.kind === "voice" ? message.voice?.duration_ms : undefined,
      last_message_at: message.created_at,
      unread_count:
        options?.incrementUnread === true
          ? (room.unread_count ?? 0) + 1
          : room.unread_count,
      mention_unread_count:
        options?.incrementMentionUnread === true
          ? (room.mention_unread_count ?? 0) + 1
          : room.mention_unread_count,
    };
  });
  return [...updated].sort((a, b) => {
    const aTs = a.last_message_at ? Date.parse(a.last_message_at) : 0;
    const bTs = b.last_message_at ? Date.parse(b.last_message_at) : 0;
    return bTs - aTs;
  });
}

/** Thread replies belong on the root's thread cache, never the main room timeline. */
export function isChatThreadReply(message: ChatMessageRecord): boolean {
  return Boolean(message.thread_root_id);
}

export function bumpThreadRootReplyCount(existing: ChatMessageRecord[], reply: ChatMessageRecord): ChatMessageRecord[];
export function bumpThreadRootReplyCount(
  existing: ChatMessageRecord[] | undefined,
  reply: ChatMessageRecord,
): ChatMessageRecord[] | undefined;
export function bumpThreadRootReplyCount(
  existing: ChatMessageRecord[] | undefined,
  reply: ChatMessageRecord,
): ChatMessageRecord[] | undefined {
  const rootId = reply.thread_root_id;
  if (!existing || !rootId) return existing;
  return existing.map((entry) => {
    if (entry.id !== rootId) return entry;
    // A root already past this reply has counted it: later frames for it (an edit, a reaction) bump nothing.
    if (entry.last_reply_at && Date.parse(entry.last_reply_at) >= Date.parse(reply.created_at)) return entry;
    const repliers = entry.thread_participant_ids ?? [];
    return {
      ...entry,
      reply_count: (entry.reply_count ?? 0) + 1,
      last_reply_at: reply.created_at,
      // The pill's faces: the newest replier first, three at most, as the server sends them.
      thread_participant_ids: [reply.sender_id, ...repliers.filter((id) => id !== reply.sender_id)].slice(0, 3),
    };
  });
}

/**
 * The root heads a thread's first page, so the generic "newer than the head's
 * oldest row" test would take any reply. A reply older than the head's oldest
 * reply belongs on an older page (an edit of one not loaded): only a refetch
 * places it without a hole in the cursor chain.
 */
export function placeThreadReply(data: RoomTimeline, message: ChatMessageRecord): RoomTimeline | null {
  if (roomTimelineHas(data, message.id)) return replaceTimelineMessage(data, message);
  const oldestReply = data.pages[0]?.find((entry) => entry.thread_root_id);
  if (oldestReply && compareMessages(message, oldestReply) < 0) return null;
  return insertCreatedTimelineMessage(data, message);
}

/**
 * DM/group/channel also emit `chat.room.activity`, which refetches rooms with
 * the server unread count. Local +1 there races into unread=2 for one message.
 * Only the default channel skips activity, so it still increments locally.
 */
export function shouldIncrementUnreadLocally(room: ChatRoomRecord | undefined): boolean {
  return room !== undefined && isDefaultWorkspaceChannel(room);
}
