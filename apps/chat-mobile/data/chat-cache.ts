// How a server message, a realtime frame or a read lands in the query cache.
// What a frame does to a record (the room list line, a thread root's count, a
// reply's place) is core's (@uniwork/core/chat/chat-cache-records), shared with
// the web. The query-cache wiring is copied from packages/core/chat/
// realtime-cache.ts and use-chat-room-read-sync.ts (both read the web's auth
// and active-room stores and keys); the viewer is a parameter here. Left out:
// the legacy workspace message list and the task-link caches, which the phone
// does not show. chat-cache.test.ts runs the core cases.
import type { QueryClient, QueryKey } from "@tanstack/react-query";
import type { ChatMessageRecord, ChatRoomRecord } from "@uniwork/core/api/endpoints/chat-schemas";
import { isDefaultWorkspaceChannel } from "@uniwork/core/chat/chat-room-helpers";
import { chatApi } from "./chat-api";
import {
  bumpThreadRootReplyCount,
  isChatThreadReply,
  patchRoomSidebarFromMessage,
  placeThreadReply,
  removeMessageFromList,
  shouldIncrementUnreadLocally,
} from "@uniwork/core/chat/chat-cache-records";
import {
  insertCreatedTimelineMessage,
  mapRoomTimeline,
  replaceTimelineMessage,
  roomTimelineHas,
  type RoomTimeline,
} from "@uniwork/core/chat/room-timeline-pages";
import { markStaleUnlessObserved, roomTimelineFetchInFlight } from "@uniwork/core/chat/room-timeline-cache";
import { chatKeys } from "./queries/chat-keys";
import { dropCarriedTimeline } from "./query-persister";
import { sameUser } from "@/lib/user-id";

/** Who is looking: the signed-in user and the room open on screen. */
export interface ChatViewer {
  userId: string | null;
  activeRoomId: string | null;
}

/**
 * Patch a loaded room timeline. A patch that cannot keep it contiguous
 * returns null, and so does a timeline not loaded: both refetch.
 * While the timeline fetches, the patch waits for it (patches are idempotent).
 */
function patchRoomTimelineIfLoaded(qc: QueryClient, wsId: string, roomId: string, patch: (existing: RoomTimeline) => RoomTimeline | null): void {
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

function patchThreadReplyCaches(qc: QueryClient, wsId: string, roomId: string, message: ChatMessageRecord): void {
  const rootId = message.thread_root_id as string;
  const threadKey = chatKeys.threadMessages(wsId, roomId, rootId);
  const prior = qc.getQueryData<RoomTimeline>(threadKey);
  const alreadyPresent = roomTimelineHas(prior, message.id);
  // Only a loaded thread is patched; the next open fetches one that is not.
  if (prior) {
    const next = placeThreadReply(prior, message);
    if (next) qc.setQueryData<RoomTimeline>(threadKey, next);
    else void qc.invalidateQueries({ queryKey: threadKey, exact: true });
  }
  patchRoomTimelineIfLoaded(qc, wsId, roomId, (existing) =>
    mapRoomTimeline(existing, (page) => {
      const withoutReply = removeMessageFromList(page, message.id);
      return alreadyPresent ? withoutReply : bumpThreadRootReplyCount(withoutReply, message);
    }),
  );
}

/** The page around a jumped-to message is read once and never patched: a change refetches it if shown. */
function refreshAroundPages(qc: QueryClient, wsId: string, roomId: string): void {
  void qc.invalidateQueries({ queryKey: chatKeys.roomAroundRoot(wsId, roomId) });
}

/** `created` places a new message; anything else only replaces a loaded one (H4). */
function patchMessageCaches(qc: QueryClient, wsId: string, roomId: string, message: ChatMessageRecord, created: boolean): void {
  refreshAroundPages(qc, wsId, roomId);
  if (isChatThreadReply(message)) {
    patchThreadReplyCaches(qc, wsId, roomId, message);
    return;
  }
  patchRoomTimelineIfLoaded(qc, wsId, roomId, (existing) =>
    created ? insertCreatedTimelineMessage(existing, message) : replaceTimelineMessage(existing, message),
  );
}

/**
 * A chat mutation's answer: the server's copy of the message it sent or
 * changed goes into the caches, so the room is not refetched page by page
 *. Without one, the room refetches. A send also moves the room's
 * preview in the list.
 */
export function applyChatMessageResponse(qc: QueryClient, wsId: string, roomId: string, message: ChatMessageRecord | null, created: boolean): void {
  if (!message) {
    void qc.invalidateQueries({ queryKey: chatKeys.roomMessages(wsId, roomId) });
    return;
  }
  patchMessageCaches(qc, wsId, roomId, message, created);
  if (created && !isChatThreadReply(message)) {
    qc.setQueryData<ChatRoomRecord[]>(chatKeys.rooms(wsId), (old) => old && patchRoomSidebarFromMessage(old, roomId, message));
  }
}

/**
 * A shown timeline of this room, or of one of its threads: the only reason to
 * GET a message. One loaded but not shown is marked stale instead.
 */
function isRoomTimelineShown(qc: QueryClient, wsId: string, roomId: string): boolean {
  const keys: QueryKey[] = [
    chatKeys.roomMessages(wsId, roomId),
    ...qc.getQueriesData({ queryKey: chatKeys.roomThreads(wsId, roomId) }).map(([key]) => key),
  ];
  let shown = false;
  for (const key of keys) {
    if (qc.getQueryData(key) !== undefined && markStaleUnlessObserved(qc, key)) shown = true;
  }
  return shown;
}

function bumpUnreadLocally(qc: QueryClient, wsId: string, roomId: string): void {
  qc.setQueryData<ChatRoomRecord[]>(chatKeys.rooms(wsId), (old) =>
    old?.map((room) => (room.id === roomId && shouldIncrementUnreadLocally(room) ? { ...room, unread_count: room.unread_count + 1 } : room)),
  );
}

function isRoomsListShown(qc: QueryClient, wsId: string): boolean {
  return (
    (qc
      .getQueryCache()
      .find({ queryKey: chatKeys.rooms(wsId), exact: true })
      ?.getObserversCount() ?? 0) > 0
  );
}

/**
 * The default channel has no `chat.room.activity`, so a message that arrives
 * while another room is open never reaches the list preview. One GET, only
 * while that list is on screen, fills the preview.
 */
async function refreshUnshownDefaultChannelPreview(qc: QueryClient, wsId: string, roomId: string, messageId: string): Promise<void> {
  if (!isRoomsListShown(qc, wsId)) return;
  const room = qc.getQueryData<ChatRoomRecord[]>(chatKeys.rooms(wsId))?.find((entry) => entry.id === roomId);
  if (!room || !isDefaultWorkspaceChannel(room)) return;
  const message = await chatApi.getMessage(wsId, roomId, messageId);
  if (!message || isChatThreadReply(message)) return;
  qc.setQueryData<ChatRoomRecord[]>(chatKeys.rooms(wsId), (old) => patchRoomSidebarFromMessage(old, roomId, message));
}

/**
 * Apply one `chat.message.*` frame. `created` is true only for a new main
 * timeline message: edits and reactions are not unread. `senderId` is that
 * frame's `sender_id`, when it carries one.
 */
export async function fetchAndPatchChatMessage(
  qc: QueryClient,
  wsId: string,
  viewer: ChatViewer,
  frame: { roomId: string; messageId: string; created?: boolean; senderId?: string },
): Promise<void> {
  const { roomId, messageId, created = false, senderId } = frame;
  // A frame during the room's first load is applied after it.
  await roomTimelineFetchInFlight(qc, chatKeys.roomMessages(wsId, roomId));
  const viewing = viewer.activeRoomId === roomId;
  if (!isRoomTimelineShown(qc, wsId, roomId)) {
    // Nobody here shows this room: the next open loads it. One's own message
    // (another device) is not unread.
    if (created && !viewing && senderId !== viewer.userId) bumpUnreadLocally(qc, wsId, roomId);
    if (created) await refreshUnshownDefaultChannelPreview(qc, wsId, roomId, messageId);
    // An edit or a reaction: a copy of this room only the disk holds would keep the old one.
    else dropCarriedTimeline(wsId, roomId);
    return;
  }
  const message = await chatApi.getMessage(wsId, roomId, messageId);
  if (!message) return;
  patchMessageCaches(qc, wsId, roomId, message, created);
  // Thread replies stay off the room preview; followers get chat.thread.replied.
  if (isChatThreadReply(message)) return;
  const isOwn = viewer.userId != null && message.sender_id === viewer.userId;
  qc.setQueryData<ChatRoomRecord[]>(chatKeys.rooms(wsId), (old) => {
    const room = old?.find((entry) => entry.id === roomId);
    // An edit, reaction or vote on an older message is not the room's latest.
    const isLatest = room?.last_message_at != null && Date.parse(message.created_at) >= Date.parse(room.last_message_at);
    if (!created && !isLatest) return old;
    return patchRoomSidebarFromMessage(old, roomId, message, {
      incrementUnread: created && !isOwn && !viewing && shouldIncrementUnreadLocally(room),
    });
  });
}

export function patchChatMessageDeleted(qc: QueryClient, wsId: string, roomId: string, messageId: string): void {
  refreshAroundPages(qc, wsId, roomId);
  // A copy of this room only the disk holds would show the deleted message on the next offline start.
  dropCarriedTimeline(wsId, roomId);
  patchRoomTimelineIfLoaded(qc, wsId, roomId, (existing) =>
    roomTimelineHas(existing, messageId) ? mapRoomTimeline(existing, (page) => removeMessageFromList(page, messageId)) : existing,
  );
  qc.setQueriesData<RoomTimeline>({ queryKey: chatKeys.roomThreads(wsId, roomId) }, (old) =>
    old && roomTimelineHas(old, messageId) ? mapRoomTimeline(old, (page) => removeMessageFromList(page, messageId)) : old,
  );
}

/** Same race as unread: only the default channel counts a mention locally. */
export function patchChatMentionCreated(qc: QueryClient, wsId: string, viewer: ChatViewer, roomId: string, senderId: string): void {
  if (viewer.userId == null || senderId === viewer.userId || viewer.activeRoomId === roomId) return;
  qc.setQueryData<ChatRoomRecord[]>(chatKeys.rooms(wsId), (old) =>
    old?.map((room) =>
      room.id === roomId && shouldIncrementUnreadLocally(room) ? { ...room, mention_unread_count: room.mention_unread_count + 1 } : room,
    ),
  );
}

/** A read pointer set to the room's latest message, which is our last_message_at. */
function withPeerRead(room: ChatRoomRecord): ChatRoomRecord {
  const readAt = room.last_message_at;
  if (room.kind !== "dm" || !readAt) return room;
  const prior = room.peer_last_read_at ? Date.parse(room.peer_last_read_at) : Number.NEGATIVE_INFINITY;
  if (Date.parse(readAt) <= prior) return room;
  return { ...room, peer_last_read_at: readAt };
}

/**
 * `chat.room.read`: my own read (on any device) clears the room's badges; a
 * peer's read moves a DM's "Seen" locally instead of refetching the list (C3).
 */
export function patchChatRoomRead(qc: QueryClient, wsId: string, viewerId: string, roomId: string, userId: string): void {
  const isSelf = sameUser(userId, viewerId);
  qc.setQueryData<ChatRoomRecord[]>(chatKeys.rooms(wsId), (old) =>
    old?.map((room) => {
      if (room.id !== roomId) return room;
      return isSelf ? { ...room, unread_count: 0, mention_unread_count: 0 } : withPeerRead(room);
    }),
  );
}

/** A signed media URL past its expiry: load the message again; its fresh URLs flow back through the cache. */
export async function refreshMessageMedia(qc: QueryClient, wsId: string, roomId: string, messageId: string): Promise<ChatMessageRecord | null> {
  const fresh = await chatApi.getMessage(wsId, roomId, messageId);
  if (fresh) applyChatMessageResponse(qc, wsId, roomId, fresh, false);
  return fresh;
}
