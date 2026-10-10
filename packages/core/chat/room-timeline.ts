import type { InfiniteData, QueryClient } from "@tanstack/react-query";
import { olderThan, type ChatMessageRecord } from "../api/endpoints/chat";
import { chatKeys } from "./chat-keys";

/** Most messages one room timeline keeps in memory across its pages. */
export const CHAT_MESSAGE_CACHE_MAX = 1000;
/** Size of each older page after the newest one. */
export const CHAT_HISTORY_PAGE_SIZE = 50;

/** `null` is the newest page; an older page is asked for by its cursor. */
export type RoomMessagesPageParam = ReturnType<typeof olderThan> | null;

/**
 * One room's main timeline: `pages[0]` is the newest page, each later page is
 * the one just older than it, and every page is oldest-first. Pages are only
 * ever chained from the newest one by cursor, so the timeline has no holes.
 */
export type RoomTimeline = InfiniteData<ChatMessageRecord[], RoomMessagesPageParam>;

function compareMessages(a: ChatMessageRecord, b: ChatMessageRecord): number {
  const byTime = Date.parse(a.created_at) - Date.parse(b.created_at);
  if (byTime !== 0) return byTime;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function countMessages(data: RoomTimeline): number {
  return data.pages.reduce((total, page) => total + page.length, 0);
}

/** The loaded timeline, oldest first. */
export function flattenRoomTimeline(data: RoomTimeline): ChatMessageRecord[] {
  const seen = new Set<string>();
  const out: ChatMessageRecord[] = [];
  for (let index = data.pages.length - 1; index >= 0; index -= 1) {
    for (const message of data.pages[index] ?? []) {
      if (seen.has(message.id)) continue;
      seen.add(message.id);
      out.push(message);
    }
  }
  return out;
}

export function roomTimelineHas(data: RoomTimeline | undefined, messageId: string): boolean {
  return data?.pages.some((page) => page.some((entry) => entry.id === messageId)) ?? false;
}

/** The newest loaded message, the point a catch-up reads after. */
export function newestTimelineMessage(data: RoomTimeline | undefined): ChatMessageRecord | undefined {
  const head = data?.pages[0];
  return head?.[head.length - 1];
}

/** Next (older) page param, or undefined once history or the memory cap is reached. */
export function olderRoomPageParam(
  lastPage: ChatMessageRecord[],
  allPages: ChatMessageRecord[][],
  lastPageParam: RoomMessagesPageParam,
  headLimit: number,
): RoomMessagesPageParam | undefined {
  const pageSize = lastPageParam === null ? headLimit : CHAT_HISTORY_PAGE_SIZE;
  const oldest = lastPage[0];
  if (!oldest || lastPage.length < pageSize) return undefined;
  if (allPages.reduce((total, page) => total + page.length, 0) >= CHAT_MESSAGE_CACHE_MAX) return undefined;
  return olderThan(oldest);
}

/** Apply `patch` to every page; the same object back when nothing changed. */
export function mapRoomTimeline(
  data: RoomTimeline,
  patch: (page: ChatMessageRecord[]) => ChatMessageRecord[],
): RoomTimeline {
  let changed = false;
  const pages = data.pages.map((page) => {
    const next = patch(page);
    if (next !== page) changed = true;
    return next;
  });
  return changed ? { ...data, pages } : data;
}

/** An update: replace the message wherever it is loaded, never insert it. */
export function replaceTimelineMessage(data: RoomTimeline, message: ChatMessageRecord): RoomTimeline {
  return mapRoomTimeline(data, (page) => {
    const index = page.findIndex((entry) => entry.id === message.id);
    if (index < 0) return page;
    return [...page.slice(0, index), message, ...page.slice(index + 1)];
  });
}

/** Drop the oldest pages (then the oldest rows of the newest one) past the cap. */
function capRoomTimeline(data: RoomTimeline): RoomTimeline {
  let pages = data.pages;
  let pageParams = data.pageParams;
  let total = countMessages(data);
  while (total > CHAT_MESSAGE_CACHE_MAX && pages.length > 1) {
    total -= pages[pages.length - 1]?.length ?? 0;
    pages = pages.slice(0, -1);
    pageParams = pageParams.slice(0, -1);
  }
  const head = pages[0] ?? [];
  if (head.length > CHAT_MESSAGE_CACHE_MAX) {
    pages = [head.slice(head.length - CHAT_MESSAGE_CACHE_MAX), ...pages.slice(1)];
  }
  return pages === data.pages ? data : { pages, pageParams };
}

/**
 * A new message. The newest page holds everything from its oldest row up to
 * now, so a message newer than that row belongs in it. One older than that
 * cannot be placed without a hole (it would become the next page's cursor):
 * null tells the caller to refetch instead.
 */
export function insertCreatedTimelineMessage(
  data: RoomTimeline,
  message: ChatMessageRecord,
): RoomTimeline | null {
  if (roomTimelineHas(data, message.id)) return replaceTimelineMessage(data, message);
  const head = data.pages[0];
  if (!head) return null;
  const oldest = head[0];
  if (oldest && compareMessages(message, oldest) < 0) return null;
  const at = head.findIndex((entry) => compareMessages(message, entry) < 0);
  const nextHead = at < 0 ? [...head, message] : [...head.slice(0, at), message, ...head.slice(at)];
  return capRoomTimeline({ ...data, pages: [nextHead, ...data.pages.slice(1)] });
}

/** Only the newest page, so reopening a room refetches one page, not its whole history. */
export function keepRoomTimelineHead(data: RoomTimeline): RoomTimeline {
  if (data.pages.length <= 1) return data;
  return { pages: data.pages.slice(0, 1), pageParams: data.pageParams.slice(0, 1) };
}

/** Opening a room: forget the older pages scrolled in last time and refresh the newest. */
export function refreshRoomTimelineOnOpen(qc: QueryClient, wsId: string, roomId: string): void {
  const key = chatKeys.roomMessages(wsId, roomId);
  const data = qc.getQueryData<RoomTimeline>(key);
  if (data) qc.setQueryData<RoomTimeline>(key, keepRoomTimelineHead(data));
  void qc.invalidateQueries({ queryKey: key });
}
