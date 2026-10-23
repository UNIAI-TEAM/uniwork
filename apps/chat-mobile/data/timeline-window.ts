// The sliding window of a room's timeline. Scrolling up loads
// older pages until the memory cap (CHAT_MESSAGE_CACHE_MAX, a thousand
// messages), and every frame, receipt or reaction then lays all of them out
// again. Back at the newest message, the reader no longer needs the pages far
// above it: the oldest past KEPT_TIMELINE_PAGES are dropped, and come back by
// cursor if the reader scrolls up again. Not TanStack's maxPages: it drops
// pages[0] when a page is added at the end, and in this cache pages[0] is the
// newest page (core room-timeline-pages), the one every frame patches.
import type { QueryClient } from "@tanstack/react-query";
import type { RoomTimeline } from "@uniwork/core/chat/room-timeline-pages";
import { chatKeys } from "./queries/chat-keys";

/** The newest pages a room keeps once its reader is back at the newest message (50 messages a page). */
export const KEPT_TIMELINE_PAGES = 8;

/**
 * Drop the oldest pages past `keep`. Never while a fetch runs: an infinite
 * query writes back the pages it started from when it ends, so the cut would
 * be undone (and a page appended to it would follow a dropped one). True when
 * pages were dropped.
 */
export function trimRoomTimelineTail(qc: QueryClient, wsId: string, roomId: string, keep = KEPT_TIMELINE_PAGES): boolean {
  const key = chatKeys.roomMessages(wsId, roomId);
  if (qc.getQueryState(key)?.fetchStatus === "fetching") return false;
  const data = qc.getQueryData<RoomTimeline>(key);
  if (!data || data.pages.length <= keep) return false;
  qc.setQueryData<RoomTimeline>(key, { pages: data.pages.slice(0, keep), pageParams: data.pageParams.slice(0, keep) });
  return true;
}
