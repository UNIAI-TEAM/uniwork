"use client";

import type { QueryClient, QueryKey } from "@tanstack/react-query";
import type { ChatMessageRecord, ChatRoomRecord } from "../api/endpoints/chat";
import { getChatRoomMessage } from "../api/endpoints/chat";
import { useAuthStore } from "../auth/store";
import { chatKeys } from "./chat-keys";
import { isDefaultWorkspaceChannel } from "./chat-room-helpers";
import { useActiveChatRoomStore } from "./active-chat-room-store";
import {
  CHAT_MESSAGE_CACHE_MAX,
  insertCreatedTimelineMessage,
  mapRoomTimeline,
  markStaleUnlessObserved,
  replaceTimelineMessage,
  roomTimelineFetchInFlight,
  roomTimelineHas,
  type RoomTimeline,
} from "./room-timeline";

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
function replaceMessageInList(existing: ChatMessageRecord[], message: ChatMessageRecord): ChatMessageRecord[] {
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

export function bumpThreadRootReplyCount(
  existing: ChatMessageRecord[] | undefined,
  reply: ChatMessageRecord,
): ChatMessageRecord[] | undefined {
  const rootId = reply.thread_root_id;
  if (!existing || !rootId) return existing;
  return existing.map((entry) => {
    if (entry.id !== rootId) return entry;
    return {
      ...entry,
      reply_count: (entry.reply_count ?? 0) + 1,
      last_reply_at: reply.created_at,
    };
  });
}

/**
 * Patch a loaded room timeline. A patch that cannot keep it contiguous
 * returns null, and so does a timeline not loaded: both refetch (UNI-950).
 * While the timeline fetches, the patch waits for it (patches are idempotent).
 */
function patchRoomTimelineIfLoaded(
  qc: QueryClient,
  wsId: string,
  roomId: string,
  patch: (existing: RoomTimeline) => RoomTimeline | null,
): void {
  const key = chatKeys.roomMessages(wsId, roomId);
  const inFlight = roomTimelineFetchInFlight(qc, key);
  if (inFlight) {
    void inFlight.then(() => patchRoomTimelineIfLoaded(qc, wsId, roomId, patch));
    return;
  }
  const existing = qc.getQueryData<RoomTimeline>(key);
  const next = existing === undefined ? null : patch(existing);
  if (next === null) {
    void qc.invalidateQueries({ queryKey: key });
    return;
  }
  if (next !== existing) qc.setQueryData<RoomTimeline>(key, next);
}

/** A message this client just sent or learned was created: onto the newest page. */
export function insertCreatedRoomMessage(
  qc: QueryClient,
  wsId: string,
  roomId: string,
  message: ChatMessageRecord,
): void {
  patchRoomTimelineIfLoaded(qc, wsId, roomId, (existing) => insertCreatedTimelineMessage(existing, message));
}

function patchWorkspaceMessageListIfLoaded(
  qc: QueryClient,
  wsId: string,
  roomId: string,
  patch: (existing: ChatMessageRecord[]) => ChatMessageRecord[],
): void {
  const wsRoom = qc.getQueryData<{ room_id?: string }>(chatKeys.room(wsId));
  if (wsRoom?.room_id !== roomId) return;
  const key = chatKeys.messages(wsId);
  const existing = qc.getQueryData<ChatMessageRecord[]>(key);
  if (existing === undefined) return;
  qc.setQueryData<ChatMessageRecord[]>(key, patch(existing));
}
function patchThreadReplyCaches(
  qc: QueryClient,
  wsId: string,
  roomId: string,
  message: ChatMessageRecord,
): void {
  const rootId = message.thread_root_id;
  if (!rootId) return;

  const threadKey = chatKeys.threadMessages(wsId, roomId, rootId);
  const prior = qc.getQueryData<ChatMessageRecord[]>(threadKey);
  const alreadyPresent = prior?.some((entry) => entry.id === message.id) ?? false;

  qc.setQueryData<ChatMessageRecord[]>(threadKey, (old) => mergeMessageIntoList(old, message));

  const patchMainList = (existing: ChatMessageRecord[]) => {
    const withoutReply = removeMessageFromList(existing, message.id);
    if (alreadyPresent) return withoutReply;
    return bumpThreadRootReplyCount(withoutReply, message) ?? withoutReply;
  };

  patchRoomTimelineIfLoaded(qc, wsId, roomId, (existing) => mapRoomTimeline(existing, patchMainList));
  patchWorkspaceMessageListIfLoaded(qc, wsId, roomId, patchMainList);
}

/** `created` places a new message; anything else only replaces a loaded one (H4). */
function patchMessageCaches(
  qc: QueryClient,
  wsId: string,
  roomId: string,
  message: ChatMessageRecord,
  created: boolean,
): void {
  if (isChatThreadReply(message)) {
    patchThreadReplyCaches(qc, wsId, roomId, message);
    return;
  }
  if (created) insertCreatedRoomMessage(qc, wsId, roomId, message);
  else patchRoomTimelineIfLoaded(qc, wsId, roomId, (existing) => replaceTimelineMessage(existing, message));
  patchWorkspaceMessageListIfLoaded(qc, wsId, roomId, (existing) =>
    created ? mergeMessageIntoList(existing, message) : replaceMessageInList(existing, message),
  );
}

/**
 * A chat mutation's answer: the server's copy of the message it sent or
 * changed goes into the caches, so the room is not refetched page by page
 * (UNI-1077). Without one, the room refetches.
 */
export function applyChatMessageResponse(
  qc: QueryClient,
  wsId: string,
  roomId: string,
  message: ChatMessageRecord | null,
  created: boolean,
): void {
  if (message) patchMessageCaches(qc, wsId, roomId, message, created);
  else void qc.invalidateQueries({ queryKey: chatKeys.roomMessages(wsId, roomId) });
}

function isViewingRoom(wsId: string, roomId: string): boolean {
  const active = useActiveChatRoomStore.getState();
  return active.workspaceId === wsId && active.roomId === roomId;
}

function currentUserId(): string | null {
  return useAuthStore.getState().user?.id ?? null;
}

/**
 * DM/group/channel also emit `chat.room.activity`, which refetches rooms with
 * the server unread count. Local +1 there races into unread=2 for one message.
 * Only the default channel skips activity, so it still increments locally.
 */
function shouldIncrementUnreadLocally(room: ChatRoomRecord | undefined): boolean {
  return room !== undefined && isDefaultWorkspaceChannel(room);
}

/**
 * A shown timeline of this room, or of one of its threads: the only reason to
 * GET a message. One loaded but not shown is marked stale instead (UNI-1078).
 */
function isRoomTimelineShown(qc: QueryClient, wsId: string, roomId: string): boolean {
  const wsRoom = qc.getQueryData<{ room_id?: string }>(chatKeys.room(wsId));
  const keys: QueryKey[] = [
    chatKeys.roomMessages(wsId, roomId),
    ...(wsRoom?.room_id === roomId ? [chatKeys.messages(wsId)] : []),
    ...qc.getQueriesData({ queryKey: ["chat", "thread-messages", wsId, roomId] }).map(([key]) => key),
  ];
  let shown = false;
  for (const key of keys) {
    if (qc.getQueryData(key) !== undefined && markStaleUnlessObserved(qc, key)) shown = true;
  }
  return shown;
}

/**
 * A message that just arrived cannot have task/doc links yet; a later link
 * sends `chat.message.linked`. Recording it as linkless keeps the open room
 * from asking the server for links on every frame.
 */
function recordNoLinksYet(qc: QueryClient, wsId: string, roomId: string, messageId: string): void {
  const key = chatKeys.roomMessageLinksRoom(wsId, roomId);
  const links = qc.getQueryData<Map<string, unknown[]>>(key);
  if (!links || links.has(messageId)) return;
  qc.setQueryData(key, new Map(links).set(messageId, []));
}

function bumpUnreadLocally(qc: QueryClient, wsId: string, roomId: string): void {
  qc.setQueryData<ChatRoomRecord[]>(chatKeys.rooms(wsId), (old) =>
    old?.map((room) =>
      room.id === roomId && shouldIncrementUnreadLocally(room)
        ? { ...room, unread_count: (room.unread_count ?? 0) + 1 }
        : room,
    ),
  );
}

/**
 * Apply one `chat.message.*` frame. `created` is true only for
 * `chat.message.created`: edits and reactions are not unread. `senderId` is
 * that frame's `sender_id`, when it carries one.
 */
export async function fetchAndPatchChatMessage(
  qc: QueryClient,
  wsId: string,
  roomId: string,
  messageId: string,
  created = false,
  senderId?: string,
): Promise<void> {
  // A frame during the room's first load is applied after it.
  await roomTimelineFetchInFlight(qc, chatKeys.roomMessages(wsId, roomId));
  const viewing = isViewingRoom(wsId, roomId);
  if (!isRoomTimelineShown(qc, wsId, roomId)) {
    // Nobody here shows this room: the next open loads it. The preview of a
    // non-default room follows `chat.room.activity`; the default channel has
    // none, so its badge counts here (preview catches up on the next refetch).
    // The frame names the sender: one's own message (another tab or device) is not unread.
    if (created && !viewing && senderId !== currentUserId()) bumpUnreadLocally(qc, wsId, roomId);
    return;
  }
  const knownBefore = roomTimelineHas(
    qc.getQueryData<RoomTimeline>(chatKeys.roomMessages(wsId, roomId)),
    messageId,
  );
  const message = await getChatRoomMessage(wsId, roomId, messageId);
  if (!message) return;
  patchMessageCaches(qc, wsId, roomId, message, created);
  if (!knownBefore) recordNoLinksYet(qc, wsId, roomId, message.id);
  // Thread replies stay off the channel preview; followers get chat.thread.replied.
  if (isChatThreadReply(message)) return;
  const viewerId = currentUserId();
  const isOwn = viewerId != null && message.sender_id === viewerId;
  qc.setQueryData<ChatRoomRecord[]>(chatKeys.rooms(wsId), (old) => {
    const room = old?.find((entry) => entry.id === roomId);
    return patchRoomSidebarFromMessage(old, roomId, message, {
      incrementUnread: created && !isOwn && !viewing && shouldIncrementUnreadLocally(room),
    });
  });
}

export function patchChatMessageDeleted(
  qc: QueryClient,
  wsId: string,
  roomId: string,
  messageId: string,
): void {
  patchRoomTimelineIfLoaded(qc, wsId, roomId, (existing) =>
    roomTimelineHas(existing, messageId)
      ? mapRoomTimeline(existing, (page) => removeMessageFromList(page, messageId))
      : existing,
  );
  patchWorkspaceMessageListIfLoaded(qc, wsId, roomId, (existing) =>
    removeMessageFromList(existing, messageId),
  );
  // Thread message caches are keyed by root; drop the id from any cached thread list.
  qc.setQueriesData<ChatMessageRecord[]>(
    { queryKey: ["chat", "thread-messages", wsId, roomId] },
    (old) => removeMessageFromList(old, messageId),
  );
}

export function patchChatMentionCreated(
  qc: QueryClient,
  wsId: string,
  roomId: string,
  senderId: string,
): void {
  const viewerId = currentUserId();
  if (viewerId == null || senderId === viewerId) return;
  if (isViewingRoom(wsId, roomId)) return;
  qc.setQueryData<ChatRoomRecord[]>(chatKeys.rooms(wsId), (old) => {
    if (!old) return old;
    return old.map((room) => {
      if (room.id !== roomId) return room;
      // Same race as unread: DM/group/channel unread badges come from
      // `chat.room.activity` refetch; only the default channel bumps locally.
      if (!shouldIncrementUnreadLocally(room)) return room;
      return { ...room, mention_unread_count: (room.mention_unread_count ?? 0) + 1 };
    });
  });
}

/**
 * Invalidate message↔task link queries. Does not touch message list caches so
 * optimistic / pending sends stay put.
 */
export function invalidateChatMessageLinks(
  qc: QueryClient,
  wsId: string,
  messageId: string,
): void {
  if (!messageId) return;
  void qc.invalidateQueries({ queryKey: chatKeys.messageLinks(wsId, messageId) });
  // The room cache only fetches ids it lacks: forget this one so the open
  // timeline asks for its links, and nothing else, again.
  qc.setQueriesData<Map<string, unknown[]>>(
    { queryKey: chatKeys.roomMessageLinksRoot(wsId) },
    (links) => {
      if (!links?.has(messageId)) return links;
      const next = new Map(links);
      next.delete(messageId);
      return next;
    },
  );
}

/** `chat.message.linked` — refresh links for the message; leave message lists alone. */
export function patchChatMessageLinked(
  qc: QueryClient,
  wsId: string,
  _roomId: string,
  messageId: string,
): void {
  invalidateChatMessageLinks(qc, wsId, messageId);
}

/** `chat.thread.linked` — links hang off the thread root message id. */
export function patchChatThreadLinked(
  qc: QueryClient,
  wsId: string,
  _roomId: string,
  threadRootId: string,
): void {
  invalidateChatMessageLinks(qc, wsId, threadRootId);
}
