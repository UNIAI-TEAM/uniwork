// A room timeline's cache operations over a QueryClient: open, catch up, mark
// stale, refresh. The pages themselves and the pure operations on them are
// room-timeline-pages.ts.
import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { listChatRoomMessages, type ChatMessageRecord } from "../api/endpoints/chat";
import { WS_SCOPE_CHAT } from "../realtime/scopes";
import { chatKeys } from "./chat-keys";
import { CHAT_HISTORY_PAGE_SIZE, type RoomTimeline, newestTimelineMessage, insertCreatedTimelineMessage, keepRoomTimelineHead } from "./room-timeline-pages";

/** Opening a room: forget the older pages scrolled in last time and refresh the newest. */
export function refreshRoomTimelineOnOpen(qc: QueryClient, wsId: string, roomId: string): void {
  const key = chatKeys.roomMessages(wsId, roomId);
  const data = qc.getQueryData<RoomTimeline>(key);
  if (data) qc.setQueryData<RoomTimeline>(key, keepRoomTimelineHead(data));
  void qc.invalidateQueries({ queryKey: key });
}

/**
 * An infinite query writes back the pages it started from when a fetch ends,
 * so a patch made meanwhile (a frame during the first load or a
 * fetchNextPage) is lost. The fetch in flight, settled, to patch after
 * (UNI-1077); undefined when none is. Its error is the query's to report.
 */
export function roomTimelineFetchInFlight(qc: QueryClient, key: QueryKey): Promise<unknown> | undefined {
  if (qc.getQueryState(key)?.fetchStatus !== "fetching") return undefined;
  return qc.getQueryCache().find({ queryKey: key, exact: true })?.promise?.catch(() => undefined);
}

/**
 * True when a screen shows this cache entry. One nobody shows is not worth a
 * request: it is marked stale instead, so its next open refetches (UNI-1078).
 */
export function markStaleUnlessObserved(qc: QueryClient, key: QueryKey): boolean {
  if ((qc.getQueryCache().find({ queryKey: key, exact: true })?.getObserversCount() ?? 0) > 0) return true;
  void qc.invalidateQueries({ queryKey: key, exact: true, refetchType: "none" });
  return false;
}

const catchUpsInFlight = new Map<string, Promise<void>>();
const catchUpsQueued = new Map<string, Promise<void>>();

async function readMissedMessages(qc: QueryClient, wsId: string, roomId: string): Promise<void> {
  const key = chatKeys.roomMessages(wsId, roomId);
  const data = qc.getQueryData<RoomTimeline>(key);
  if (!data || !markStaleUnlessObserved(qc, key)) return;
  const newest = newestTimelineMessage(data);
  // An empty room or a server without cursors: the newest page is the catch-up.
  if (!newest?.cursor) {
    void qc.invalidateQueries({ queryKey: key });
    return;
  }
  let rows: ChatMessageRecord[];
  try {
    rows = await listChatRoomMessages(wsId, roomId, {
      after: newest.cursor,
      limit: CHAT_HISTORY_PAGE_SIZE,
      mark_read: false,
    });
  } catch {
    void qc.invalidateQueries({ queryKey: key });
    return;
  }
  await roomTimelineFetchInFlight(qc, key);
  // A full page may not be all that was missed: refetch rather than guess.
  let next = rows.length >= CHAT_HISTORY_PAGE_SIZE ? null : (qc.getQueryData<RoomTimeline>(key) ?? null);
  for (const row of rows) {
    if (!next) break;
    next = insertCreatedTimelineMessage(next, row);
  }
  if (next) qc.setQueryData<RoomTimeline>(key, next);
  else void qc.invalidateQueries({ queryKey: key });
}

/**
 * After a (re)subscribe, read the messages newer than the
 * newest loaded one and append them (H5). Frames sent while the socket was
 * down are gone; this closes that gap without refetching every loaded page.
 * An ask while one runs gets one read after it, shared by every ask made
 * meanwhile: the running one may have started before the scope was
 * admitted, and so missed what came between (UNI-1078).
 */
export function catchUpRoomTimeline(qc: QueryClient, wsId: string, roomId: string): Promise<void> {
  const id = `${wsId}/${roomId}`;
  const running = catchUpsInFlight.get(id);
  if (running) {
    const queued = catchUpsQueued.get(id);
    if (queued) return queued;
    const followUp = () => {
      catchUpsQueued.delete(id);
      return catchUpRoomTimeline(qc, wsId, roomId);
    };
    const next = running.then(followUp, followUp);
    catchUpsQueued.set(id, next);
    return next;
  }
  const run = readMissedMessages(qc, wsId, roomId).finally(() => catchUpsInFlight.delete(id));
  catchUpsInFlight.set(id, run);
  return run;
}

/** A room scope (re)admitted reads what it missed while it was not; true when the frame was that ack. */
export function catchUpOnChatSubscribeAck(
  qc: QueryClient,
  wsId: string,
  type: string,
  payload: Record<string, string>,
): boolean {
  if (type !== "subscribe_ack" || payload.scope !== WS_SCOPE_CHAT || !payload.id) return false;
  void catchUpRoomTimeline(qc, wsId, payload.id);
  return true;
}

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
    if (markStaleUnlessObserved(qc, chatKeys.roomMessages(wsId, roomId))) refreshRoomTimelineOnOpen(qc, wsId, roomId);
  }
}
