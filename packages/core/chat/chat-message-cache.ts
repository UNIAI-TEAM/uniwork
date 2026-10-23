// How a server message, a realtime frame or a delete lands in a host's query
// cache: the wiring the web and the phone share (apps/chat-mobile, ADR 0011:
// on its core allowlist). Each host keys its own cache, reaches the server
// through its own transport and knows who is looking, so all three come in:
// realtime-cache.ts binds the web's, the phone's data/chat-cache.ts its own.
// What a host keeps beside the timelines (the web's shared-media summary, the
// phone's around pages and disk copy) it refreshes
// from the hooks below. What a frame does to one record is
// chat-cache-records.ts; the timeline pages are room-timeline-pages.ts.
import type { QueryClient, QueryKey } from "@tanstack/react-query";
import type { ChatMessageRecord, ChatRoomRecord } from "../api/endpoints/chat-schemas";
import {
  bumpThreadRootReplyCount,
  isChatThreadReply,
  patchRoomSidebarFromMessage,
  placeThreadReply,
  removeMessageFromList,
  shouldIncrementUnreadLocally,
} from "./chat-cache-records";
import { isDefaultWorkspaceChannel } from "./chat-room-helpers";
import { markStaleUnlessObserved, roomTimelineFetchInFlight } from "./room-timeline-cache";
import { stripPendingFromTimeline } from "./optimistic-outbound-message";
import { insertCreatedTimelineMessage, mapRoomTimeline, replaceTimelineMessage, roomTimelineHas, type RoomTimeline } from "./room-timeline-pages";

/**
 * Who is looking: the signed-in user, and the room open on screen in the
 * workspace the call names (null when another workspace's room is open). Read
 * after the wait for a timeline fetch, so a host may pass getters.
 */
export interface ChatViewer {
  readonly userId: string | null;
  readonly activeRoomId: string | null;
}

export interface ChatMessageCacheKeys {
  rooms(wsId: string): QueryKey;
  /** One room's main timeline (`RoomTimeline`). */
  roomMessages(wsId: string, roomId: string): QueryKey;
  threadMessages(wsId: string, roomId: string, rootId: string): QueryKey;
  /** Prefix: every loaded thread of one room. */
  roomThreads(wsId: string, roomId: string): QueryKey;
}

export interface ChatMessageCacheHost {
  keys: ChatMessageCacheKeys;
  getMessage(wsId: string, roomId: string, messageId: string): Promise<ChatMessageRecord | null>;
  /** A message was placed in, or replaced in, this room's caches. */
  onMessagePlaced?(qc: QueryClient, wsId: string, roomId: string, message: ChatMessageRecord, created: boolean): void;
  /** A frame for a room nobody here shows: nothing was fetched. */
  onUnshownFrame?(qc: QueryClient, wsId: string, roomId: string, created: boolean): void;
  /** A message of this room was deleted. */
  onMessageDeleted?(qc: QueryClient, wsId: string, roomId: string): void;
  /** A frame's message was fetched and placed; `knownBefore` when the main timeline already held it. */
  onMessageFetched?(qc: QueryClient, wsId: string, roomId: string, messageId: string, knownBefore: boolean): void;
}

export function createChatMessageCache(host: ChatMessageCacheHost) {
  const { keys } = host;

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
    const key = keys.roomMessages(wsId, roomId);
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

  function patchThreadReplyCaches(qc: QueryClient, wsId: string, roomId: string, message: ChatMessageRecord, rootId: string): void {
    const threadKey = keys.threadMessages(wsId, roomId, rootId);
    const prior = qc.getQueryData<RoomTimeline>(threadKey);
    const alreadyPresent = roomTimelineHas(prior, message.id);
    // Only a loaded thread is patched; the next open fetches one that is not.
    if (prior) {
      const next = placeThreadReply(prior, message);
      if (next) qc.setQueryData<RoomTimeline>(threadKey, next);
      else void qc.invalidateQueries({ queryKey: threadKey, exact: true });
    }
    const patchMainList = (existing: ChatMessageRecord[]) => {
      const withoutReply = removeMessageFromList(existing, message.id);
      return alreadyPresent ? withoutReply : bumpThreadRootReplyCount(withoutReply, message);
    };
    patchRoomTimelineIfLoaded(qc, wsId, roomId, (existing) => mapRoomTimeline(existing, patchMainList));
  }

  /** `created` places a new message; anything else only replaces a loaded one (H4). */
  function patchMessageCaches(qc: QueryClient, wsId: string, roomId: string, message: ChatMessageRecord, created: boolean): void {
    host.onMessagePlaced?.(qc, wsId, roomId, message, created);
    const rootId = message.thread_root_id;
    if (rootId) {
      patchThreadReplyCaches(qc, wsId, roomId, message, rootId);
      return;
    }
    patchRoomTimelineIfLoaded(qc, wsId, roomId, (existing) => {
      const base =
        created && message.client_msg_id ? stripPendingFromTimeline(existing, message.client_msg_id) : existing;
      return created ? insertCreatedTimelineMessage(base, message) : replaceTimelineMessage(base, message);
    });
  }

  /**
   * A shown timeline of this room, or of one of its threads: the only reason to
   * GET a message. One loaded but not shown is marked stale instead (UNI-1078).
   */
  function isRoomTimelineShown(qc: QueryClient, wsId: string, roomId: string): boolean {
    const shownKeys: QueryKey[] = [
      keys.roomMessages(wsId, roomId),
      ...qc.getQueriesData({ queryKey: keys.roomThreads(wsId, roomId) }).map(([key]) => key),
    ];
    let shown = false;
    for (const key of shownKeys) {
      if (qc.getQueryData(key) !== undefined && markStaleUnlessObserved(qc, key)) shown = true;
    }
    return shown;
  }

  function bumpUnreadLocally(qc: QueryClient, wsId: string, roomId: string): void {
    qc.setQueryData<ChatRoomRecord[]>(keys.rooms(wsId), (old) =>
      old?.map((room) => (room.id === roomId && shouldIncrementUnreadLocally(room) ? { ...room, unread_count: room.unread_count + 1 } : room)),
    );
  }

  function isRoomsListShown(qc: QueryClient, wsId: string): boolean {
    return (qc.getQueryCache().find({ queryKey: keys.rooms(wsId), exact: true })?.getObserversCount() ?? 0) > 0;
  }

  /**
   * The default channel has no `chat.room.activity`, so a message that arrives
   * while another room is open never reaches the list preview. One GET, only
   * while that list is on screen, fills the preview and leaves the timeline
   * for the next open.
   */
  async function refreshUnshownDefaultChannelPreview(qc: QueryClient, wsId: string, roomId: string, messageId: string): Promise<void> {
    if (!isRoomsListShown(qc, wsId)) return;
    const room = qc.getQueryData<ChatRoomRecord[]>(keys.rooms(wsId))?.find((entry) => entry.id === roomId);
    if (!room || !isDefaultWorkspaceChannel(room)) return;
    const message = await host.getMessage(wsId, roomId, messageId);
    if (!message || isChatThreadReply(message)) return;
    qc.setQueryData<ChatRoomRecord[]>(keys.rooms(wsId), (old) => patchRoomSidebarFromMessage(old, roomId, message));
  }

  return {
    /** A message this client just sent or learned was created: onto the newest page. */
    insertCreatedRoomMessage(qc: QueryClient, wsId: string, roomId: string, message: ChatMessageRecord): void {
      host.onMessagePlaced?.(qc, wsId, roomId, message, true);
      patchRoomTimelineIfLoaded(qc, wsId, roomId, (existing) => insertCreatedTimelineMessage(existing, message));
    },

    /**
     * A chat mutation's answer: the server's copy of the message it sent or
     * changed goes into the caches, so the room is not refetched page by page
     * (UNI-1077). Without one, the room refetches.
     */
    applyChatMessageResponse(qc: QueryClient, wsId: string, roomId: string, message: ChatMessageRecord | null, created: boolean): void {
      if (message) patchMessageCaches(qc, wsId, roomId, message, created);
      else void qc.invalidateQueries({ queryKey: keys.roomMessages(wsId, roomId) });
    },

    /**
     * Apply one `chat.message.*` frame. `created` is true only for a new main
     * timeline message: edits and reactions are not unread. `senderId` is that
     * frame's `sender_id`, when it carries one.
     */
    async fetchAndPatchChatMessage(
      qc: QueryClient,
      wsId: string,
      viewer: ChatViewer,
      frame: { roomId: string; messageId: string; created?: boolean; senderId?: string },
    ): Promise<void> {
      const { roomId, messageId, created = false, senderId } = frame;
      // A frame during the room's first load is applied after it.
      await roomTimelineFetchInFlight(qc, keys.roomMessages(wsId, roomId));
      const viewing = viewer.activeRoomId === roomId;
      if (!isRoomTimelineShown(qc, wsId, roomId)) {
        // Nobody here shows this room: the next open loads it. The preview of a
        // non-default room follows `chat.room.activity`; the default channel has
        // none, so its badge counts here and, while the room list is open, one
        // GET fills the preview. One's own message (another tab or device) is not unread.
        if (created && !viewing && senderId !== viewer.userId) bumpUnreadLocally(qc, wsId, roomId);
        host.onUnshownFrame?.(qc, wsId, roomId, created);
        if (created) await refreshUnshownDefaultChannelPreview(qc, wsId, roomId, messageId);
        return;
      }
      const knownBefore = roomTimelineHas(qc.getQueryData<RoomTimeline>(keys.roomMessages(wsId, roomId)), messageId);
      // The send path already inserted this id; the WS echo need not GET it again.
      if (knownBefore && created) return;
      const message = await host.getMessage(wsId, roomId, messageId);
      if (!message) return;
      patchMessageCaches(qc, wsId, roomId, message, created);
      host.onMessageFetched?.(qc, wsId, roomId, message.id, knownBefore);
      // Thread replies stay off the room preview; followers get chat.thread.replied.
      if (isChatThreadReply(message)) return;
      const isOwn = viewer.userId != null && message.sender_id === viewer.userId;
      qc.setQueryData<ChatRoomRecord[]>(keys.rooms(wsId), (old) => {
        const room = old?.find((entry) => entry.id === roomId);
        // An edit, reaction or vote on an older message is not the room's latest.
        const isLatest = room?.last_message_at != null && Date.parse(message.created_at) >= Date.parse(room.last_message_at);
        if (!created && !isLatest) return old;
        return patchRoomSidebarFromMessage(old, roomId, message, {
          incrementUnread: created && !isOwn && !viewing && shouldIncrementUnreadLocally(room),
        });
      });
    },

    patchChatMessageDeleted(qc: QueryClient, wsId: string, roomId: string, messageId: string): void {
      host.onMessageDeleted?.(qc, wsId, roomId);
      patchRoomTimelineIfLoaded(qc, wsId, roomId, (existing) =>
        roomTimelineHas(existing, messageId) ? mapRoomTimeline(existing, (page) => removeMessageFromList(page, messageId)) : existing,
      );
      // Thread caches are keyed by root; drop the id from every loaded page of each.
      qc.setQueriesData<RoomTimeline>({ queryKey: keys.roomThreads(wsId, roomId) }, (old) =>
        old && roomTimelineHas(old, messageId) ? mapRoomTimeline(old, (page) => removeMessageFromList(page, messageId)) : old,
      );
    },

    /**
     * Same race as unread: DM/group/channel badges come from the
     * `chat.room.activity` refetch; only the default channel counts a mention locally.
     */
    patchChatMentionCreated(qc: QueryClient, wsId: string, viewer: ChatViewer, roomId: string, senderId: string): void {
      if (viewer.userId == null || senderId === viewer.userId || viewer.activeRoomId === roomId) return;
      qc.setQueryData<ChatRoomRecord[]>(keys.rooms(wsId), (old) =>
        old?.map((room) =>
          room.id === roomId && shouldIncrementUnreadLocally(room) ? { ...room, mention_unread_count: room.mention_unread_count + 1 } : room,
        ),
      );
    },
  };
}
