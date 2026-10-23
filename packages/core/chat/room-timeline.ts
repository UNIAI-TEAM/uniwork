// A room timeline's cache operations over a QueryClient: open, catch up, mark
// stale, refresh. The pages themselves and the pure operations on them are
// room-timeline-pages.ts.
import type { QueryClient } from "@tanstack/react-query";
import { listChatRoomMessages } from "../api/endpoints/chat";
import { chatKeys } from "./chat-keys";
import { createRoomTimelineCache, markStaleUnlessObserved, ROOM_TIMELINE_STALE_MS } from "./room-timeline-cache";

export { ROOM_TIMELINE_STALE_MS };
export type { RoomMessagesPageParam, RoomTimeline } from "./room-timeline-pages";
export {
  CHAT_HISTORY_PAGE_SIZE,
  CHAT_MESSAGE_CACHE_MAX,
  compareMessages,
  flattenRoomTimeline,
  insertCreatedTimelineMessage,
  keepRoomTimelineHead,
  mapRoomTimeline,
  newerRoomPageParam,
  replaceTimelineMessage,
  roomTimelineHas,
} from "./room-timeline-pages";

const cache = createRoomTimelineCache({
  roomMessagesKey: chatKeys.roomMessages,
  listMessagesAfter: (wsId, roomId, after, limit) => listChatRoomMessages(wsId, roomId, { after, limit, mark_read: false }),
});

// The web's binding of the shared timeline cache operations (room-timeline-cache.ts) to its keys and transport.
export const { refreshRoomTimelineOnOpen, catchUpRoomTimeline, catchUpOnChatSubscribeAck } = cache;

/**
 * After a reconnect: a shown timeline refreshes its newest page, one nobody
 * shows is marked stale. A read `after` the newest message would miss the
 * edits, deletes and reactions made to loaded ones while the socket was down
 * (UNI-1662); older pages are dropped as on reopening the room. Room link
 * caches are emptied too: they only fetch ids they lack, so invalidating them
 * would hand back the same stale links.
 */
export function refreshLoadedRoomTimelines(qc: QueryClient, wsId: string): void {
  qc.setQueriesData<Map<string, unknown[]>>({ queryKey: chatKeys.roomMessageLinksRoot(wsId) }, (links) =>
    links?.size ? new Map() : links,
  );
  for (const [queryKey, data] of qc.getQueriesData({ queryKey: chatKeys.roomMessagesRoot(wsId) })) {
    const roomId = queryKey[3];
    if (data === undefined || typeof roomId !== "string" || !roomId) continue;
    if (markStaleUnlessObserved(qc, chatKeys.roomMessages(wsId, roomId))) {
      refreshRoomTimelineOnOpen(qc, wsId, roomId, { force: true });
    }
  }
}
