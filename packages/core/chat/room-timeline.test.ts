import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as chatApi from "../api/endpoints/chat";
import type { ChatMessageRecord } from "../api/endpoints/chat";
import { chatKeys } from "./chat-keys";
import {
  CHAT_HISTORY_PAGE_SIZE,
  CHAT_MESSAGE_CACHE_MAX,
  catchUpLoadedRoomTimelines,
  catchUpRoomTimeline,
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

// H5: after a resubscribe or a reconnect the room reads what it missed,
// instead of refetching every loaded page.
describe("catchUpRoomTimeline", () => {
  afterEach(() => vi.restoreAllMocks());
  const key = chatKeys.roomMessages("ws1", "room1");
  /** A timeline a screen shows: only those catch up (UNI-1078). */
  const shown = (qc: QueryClient, data: RoomTimeline) => {
    qc.setQueryData(key, data);
    new QueryObserver(qc, { queryKey: key, enabled: false }).subscribe(() => {});
  };

  it("appends what arrived after the newest loaded message", async () => {
    const list = vi.spyOn(chatApi, "listChatRoomMessages").mockResolvedValue([msg("c", 3), msg("d", 4)]);
    const qc = new QueryClient();
    shown(qc, timeline([msg("b", 2)], [msg("a", 1)]));

    await catchUpRoomTimeline(qc, "ws1", "room1");

    expect(list).toHaveBeenCalledWith("ws1", "room1", { after: "c-b", limit: CHAT_HISTORY_PAGE_SIZE, mark_read: false });
    expect(ids(qc.getQueryData<RoomTimeline>(key)!)).toEqual(["a", "b", "c", "d"]);
  });

  it("refetches when more than a page was missed", async () => {
    vi.spyOn(chatApi, "listChatRoomMessages").mockResolvedValue(
      Array.from({ length: CHAT_HISTORY_PAGE_SIZE }, (_, i) => msg(`n${i}`, 3)),
    );
    const qc = new QueryClient();
    shown(qc, timeline([msg("b", 2)]));
    const invalidate = vi.spyOn(qc, "invalidateQueries");

    await catchUpRoomTimeline(qc, "ws1", "room1");

    expect(invalidate).toHaveBeenCalledWith({ queryKey: key });
    expect(ids(qc.getQueryData<RoomTimeline>(key)!)).toEqual(["b"]);
  });

  it("asks nothing for a room whose timeline is not loaded", async () => {
    const list = vi.spyOn(chatApi, "listChatRoomMessages");
    await catchUpRoomTimeline(new QueryClient(), "ws1", "room1");
    expect(list).not.toHaveBeenCalled();
  });

  // UNI-1078: the running read may have started before the scope was
  // admitted, so an ask during it gets one more read after it, never more.
  it("reads once more after a running catch-up, however many ask meanwhile", async () => {
    const list = vi.spyOn(chatApi, "listChatRoomMessages").mockResolvedValue([]);
    const qc = new QueryClient();
    shown(qc, timeline([msg("b", 2)]));
    await Promise.all([
      catchUpRoomTimeline(qc, "ws1", "room1"),
      catchUpRoomTimeline(qc, "ws1", "room1"),
      catchUpRoomTimeline(qc, "ws1", "room1"),
    ]);
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("keeps what the follow-up read found", async () => {
    vi.spyOn(chatApi, "listChatRoomMessages").mockResolvedValueOnce([]).mockResolvedValueOnce([msg("c", 3)]);
    const qc = new QueryClient();
    shown(qc, timeline([msg("b", 2)]));
    await Promise.all([catchUpRoomTimeline(qc, "ws1", "room1"), catchUpRoomTimeline(qc, "ws1", "room1")]);
    expect(ids(qc.getQueryData<RoomTimeline>(key)!)).toEqual(["b", "c"]);
  });

  it("only marks stale a loaded timeline nobody shows", async () => {
    const list = vi.spyOn(chatApi, "listChatRoomMessages");
    const qc = new QueryClient();
    qc.setQueryData(key, timeline([msg("b", 2)]));
    catchUpLoadedRoomTimelines(qc, "ws1");
    await vi.waitFor(() => expect(qc.getQueryState(key)?.isInvalidated).toBe(true));
    expect(list).not.toHaveBeenCalled();
  });
});
