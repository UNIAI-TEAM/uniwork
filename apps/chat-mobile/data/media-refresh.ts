// Signed media URLs past their expiry, renewed per room rather than per photo
// (audit P2 Perf). The server signs chat media for an hour, and the offline
// cache keeps timelines for a week, so a room opened after a cold start can
// hold dozens of expired photos at once. Each used to ask for its own message
// (N requests, N timeline rewrites, N cache saves). Now the asks of one room
// within BATCH_MS are gathered: the photos of the room's timeline on screen
// come back with one refetch of that timeline (one request per loaded page,
// joining a refetch already on the wire, as the room's own on open is), when
// that is no more requests than asking for them one by one; any other (a
// thread's, a jumped-to page's) is asked for alone.
import type { QueryClient } from "@tanstack/react-query";
import { flattenRoomTimeline, type RoomTimeline } from "@uniwork/core/chat/room-timeline-pages";
import { refreshMessageMedia } from "./chat-cache";
import { chatKeys } from "./queries/chat-keys";
import { bestEffort } from "./report";

export const MEDIA_REFRESH_BATCH_MS = 50;

interface Batch {
  qc: QueryClient;
  wsId: string;
  roomId: string;
  ids: Set<string>;
}

const batches = new Map<string, Batch>();

/** Renews the media URLs of `messageIds` in one room: one timeline refetch when it is the cheaper way, else one by one. */
export async function refreshRoomMedia(qc: QueryClient, wsId: string, roomId: string, messageIds: readonly string[]): Promise<void> {
  const queryKey = chatKeys.roomMessages(wsId, roomId);
  const timeline = qc.getQueryData<RoomTimeline>(queryKey);
  // Only a timeline a screen shows knows how to fetch itself (its observer brought the query function).
  const shown = qc.getQueryCache().find({ queryKey, exact: true })?.isActive() ?? false;
  const held = new Set(timeline && shown ? flattenRoomTimeline(timeline).map((message) => message.id) : []);
  const inTimeline = messageIds.filter((id) => held.has(id));
  const pages = timeline?.pages.length ?? 0;
  const byTimeline = inTimeline.length > 0 && inTimeline.length >= pages;
  const alone = byTimeline ? messageIds.filter((id) => !held.has(id)) : messageIds;
  await Promise.all([
    byTimeline ? qc.refetchQueries({ queryKey, exact: true }, { cancelRefetch: false }) : undefined,
    ...alone.map((id) => refreshMessageMedia(qc, wsId, roomId, id)),
  ]);
}

/** A photo of this room shows an expired URL: its renewal goes with the room's other asks of the next BATCH_MS. */
export function requestMediaRefresh(qc: QueryClient, wsId: string, roomId: string, messageId: string): void {
  const key = `${wsId}/${roomId}`;
  const open = batches.get(key);
  if (open?.qc === qc) {
    open.ids.add(messageId);
    return;
  }
  const batch: Batch = { qc, wsId, roomId, ids: new Set([messageId]) };
  batches.set(key, batch);
  setTimeout(() => {
    if (batches.get(key) === batch) batches.delete(key);
    void refreshRoomMedia(batch.qc, batch.wsId, batch.roomId, [...batch.ids]).catch(bestEffort("chat", "media urls not renewed", "report"));
  }, MEDIA_REFRESH_BATCH_MS);
}
