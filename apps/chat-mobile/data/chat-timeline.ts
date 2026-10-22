// A room timeline's cache operations (open, catch up, mark stale) are core's
// (@uniwork/core/chat/room-timeline-cache), bound here to the app's keys and
// chatApi; chat-timeline.test.ts runs them against the phone's cache. Only the
// reconnect refresh is the phone's own: it keeps the pages the reader scrolled
// back through, where the web drops them.
import type { QueryClient } from "@tanstack/react-query";
import { createRoomTimelineCache, markStaleUnlessObserved } from "@uniwork/core/chat/room-timeline-cache";
import { chatApi } from "./chat-api";
import { chatKeys } from "./queries/chat-keys";

export const { refreshRoomTimelineOnOpen, catchUpRoomTimeline, catchUpOnChatSubscribeAck } = createRoomTimelineCache({
  roomMessagesKey: chatKeys.roomMessages,
  listMessagesAfter: (wsId, roomId, after, limit) => chatApi.listMessages(wsId, roomId, { after, limit, markRead: false }),
});

/**
 * After a reconnect: a shown timeline refetches, one nobody shows is marked
 * stale. A read `after` the newest message would miss the edits, deletes and
 * reactions made to loaded ones while the socket was down. Unlike
 * reopening a room, the pages the person scrolled back through are kept
 * (every return from the background reconnects, and dropping them lost the
 * reader's place): the infinite query refetches each loaded page in turn,
 * re-chained from the newest, and shows the old ones until the new arrive.
 * (The web also empties its task-link caches here; the phone shows no links
 * yet.)
 */
export function refreshLoadedRoomTimelines(qc: QueryClient, wsId: string): void {
  for (const [queryKey, data] of qc.getQueriesData({ queryKey: chatKeys.roomMessagesRoot(wsId) })) {
    const roomId = queryKey[3];
    if (data === undefined || typeof roomId !== "string" || !roomId) continue;
    const key = chatKeys.roomMessages(wsId, roomId);
    if (markStaleUnlessObserved(qc, key)) void qc.invalidateQueries({ queryKey: key, exact: true });
  }
}
