import { describe, expect, it } from "vitest";
import type { ChatMessageRecord } from "../api/endpoints/chat";
import {
  CHAT_HISTORY_PAGE_SIZE,
  CHAT_MESSAGE_CACHE_MAX,
  flattenRoomTimeline,
  insertCreatedTimelineMessage,
  keepRoomTimelineHead,
  olderRoomPageParam,
  replaceTimelineMessage,
  type RoomTimeline,
} from "./room-timeline";

const msg = (id: string, minute: number): ChatMessageRecord => ({
  id,
  room_id: "room1",
  workspace_id: "ws1",
  sender_id: "u2",
  sender_display_name: "Bob",
  kind: "text",
  body: id,
  created_at: `2026-01-01T10:${String(minute).padStart(2, "0")}:00Z`,
  cursor: `c-${id}`,
  pinned: false,
  mentioned_user_ids: [],
  reactions: {},
  reply_count: 0,
  thread_unread: false,
});

const timeline = (...pages: ChatMessageRecord[][]): RoomTimeline => ({
  pages,
  pageParams: pages.map((_, index) => (index === 0 ? null : { cursor: `p${index}` })),
});

const ids = (data: RoomTimeline | null) => (data ? flattenRoomTimeline(data).map((m) => m.id) : null);

describe("room timeline", () => {
  it("flattens newest-first pages into one oldest-first list", () => {
    expect(ids(timeline([msg("c", 3), msg("d", 4)], [msg("a", 1), msg("b", 2)]))).toEqual(["a", "b", "c", "d"]);
  });

  it("appends a created message to the newest page", () => {
    const next = insertCreatedTimelineMessage(timeline([msg("b", 2)], [msg("a", 1)]), msg("c", 3));
    expect(next?.pages[0]?.map((m) => m.id)).toEqual(["b", "c"]);
    expect(ids(next)).toEqual(["a", "b", "c"]);
  });

  // H4: a message older than the newest page cannot be placed without
  // becoming the next page's cursor, which would skip what lies between.
  it("asks for a refetch when a created message is older than the newest page", () => {
    expect(insertCreatedTimelineMessage(timeline([msg("b", 5)], [msg("a", 1)]), msg("x", 3))).toBeNull();
  });

  it("treats a created message already loaded as an update in place", () => {
    const data = timeline([msg("b", 2)], [msg("a", 1)]);
    const next = insertCreatedTimelineMessage(data, { ...msg("a", 1), body: "edited" });
    expect(next?.pages[1]?.[0]?.body).toBe("edited");
    expect(ids(next)).toEqual(["a", "b"]);
  });

  // H4: an update to an old message must never land in the current window.
  it("never inserts an update for a message that is not loaded", () => {
    const data = timeline([msg("b", 2)]);
    expect(replaceTimelineMessage(data, msg("old", 0))).toBe(data);
  });

  it("drops the oldest pages past the memory cap", () => {
    const old = Array.from({ length: CHAT_HISTORY_PAGE_SIZE }, (_, i) => msg(`o${i}`, 0));
    const head = Array.from({ length: CHAT_MESSAGE_CACHE_MAX - CHAT_HISTORY_PAGE_SIZE }, (_, i) => msg(`h${i}`, 1));
    const next = insertCreatedTimelineMessage(timeline(head, old), msg("new", 2));
    expect(next?.pages).toHaveLength(1);
    expect(next?.pageParams).toEqual([null]);
  });

  it("asks for an older page by the oldest row's cursor until history or the cap ends", () => {
    const head = Array.from({ length: 80 }, (_, i) => msg(`m${i}`, 1));
    expect(olderRoomPageParam(head, [head], null, 80)).toEqual({ cursor: "c-m0" });
    expect(olderRoomPageParam(head.slice(1), [head.slice(1)], null, 80)).toBeUndefined();
    const older = head.slice(0, CHAT_HISTORY_PAGE_SIZE);
    const full = Array.from({ length: CHAT_MESSAGE_CACHE_MAX / CHAT_HISTORY_PAGE_SIZE }, () => older);
    expect(olderRoomPageParam(older, full, { cursor: "x" }, 80)).toBeUndefined();
  });

  it("keeps only the newest page", () => {
    const next = keepRoomTimelineHead(timeline([msg("b", 2)], [msg("a", 1)]));
    expect(ids(next)).toEqual(["b"]);
    expect(next.pageParams).toEqual([null]);
  });
});
