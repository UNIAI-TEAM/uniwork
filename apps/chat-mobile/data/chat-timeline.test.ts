// Parity: packages/core/chat/room-timeline.test.ts, with the app's chat API
// and query keys in place of the web's.
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import type { ChatMessageRecord } from "@uniwork/core/api/endpoints/chat-schemas";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./api", () => ({ api: { request: vi.fn() } }));

import { chatApi } from "./chat-api";
import { chatKeys } from "./queries/chat-keys";
import {
  CHAT_HISTORY_PAGE_SIZE,
  CHAT_MESSAGE_CACHE_MAX,
  catchUpOnChatSubscribeAck,
  catchUpRoomTimeline,
  compareMessages,
  flattenRoomTimeline,
  insertCreatedTimelineMessage,
  keepRoomTimelineHead,
  markStaleUnlessObserved,
  olderRoomPageParam,
  olderThan,
  refreshLoadedRoomTimelines,
  refreshRoomTimelineOnOpen,
  replaceTimelineMessage,
  roomTimelineFetchInFlight,
  type RoomTimeline,
} from "./chat-timeline";

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
    const list = vi.spyOn(chatApi, "listMessages").mockResolvedValue([msg("c", 3), msg("d", 4)]);
    const qc = new QueryClient();
    shown(qc, timeline([msg("b", 2)], [msg("a", 1)]));

    await catchUpRoomTimeline(qc, "ws1", "room1");

    expect(list).toHaveBeenCalledWith("ws1", "room1", { after: "c-b", limit: CHAT_HISTORY_PAGE_SIZE, markRead: false });
    expect(ids(qc.getQueryData<RoomTimeline>(key)!)).toEqual(["a", "b", "c", "d"]);
  });

  it("refetches when more than a page was missed", async () => {
    vi.spyOn(chatApi, "listMessages").mockResolvedValue(
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
    const list = vi.spyOn(chatApi, "listMessages");
    await catchUpRoomTimeline(new QueryClient(), "ws1", "room1");
    expect(list).not.toHaveBeenCalled();
  });

  // UNI-1078: the running read may have started before the scope was
  // admitted, so an ask during it gets one more read after it, never more.
  it("reads once more after a running catch-up, however many ask meanwhile", async () => {
    const list = vi.spyOn(chatApi, "listMessages").mockResolvedValue([]);
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
    vi.spyOn(chatApi, "listMessages").mockResolvedValueOnce([]).mockResolvedValueOnce([msg("c", 3)]);
    const qc = new QueryClient();
    shown(qc, timeline([msg("b", 2)]));
    await Promise.all([catchUpRoomTimeline(qc, "ws1", "room1"), catchUpRoomTimeline(qc, "ws1", "room1")]);
    expect(ids(qc.getQueryData<RoomTimeline>(key)!)).toEqual(["b", "c"]);
  });
});

// UNI-1662: a read `after` the newest message never sees an edit, a delete or
// a reaction made to a loaded one while the socket was down.
describe("refreshLoadedRoomTimelines", () => {
  afterEach(() => vi.restoreAllMocks());
  const key = chatKeys.roomMessages("ws1", "room1");

  it("refreshes the newest page of a shown timeline after a reconnect", async () => {
    const list = vi.spyOn(chatApi, "listMessages").mockResolvedValue([]);
    const qc = new QueryClient();
    qc.setQueryData(key, timeline([msg("b", 2)], [msg("a", 1)]));
    new QueryObserver(qc, { queryKey: key, enabled: false }).subscribe(() => {});

    refreshLoadedRoomTimelines(qc, "ws1");

    expect(qc.getQueryData<RoomTimeline>(key)?.pages).toEqual([[msg("b", 2)]]);
    await vi.waitFor(() => expect(qc.getQueryState(key)?.isInvalidated).toBe(true));
    expect(list).not.toHaveBeenCalledWith("ws1", "room1", expect.objectContaining({ after: expect.anything() }));
  });

  it("only marks stale a loaded timeline nobody shows", async () => {
    const list = vi.spyOn(chatApi, "listMessages");
    const qc = new QueryClient();
    qc.setQueryData(key, timeline([msg("b", 2)]));
    refreshLoadedRoomTimelines(qc, "ws1");
    await vi.waitFor(() => expect(qc.getQueryState(key)?.isInvalidated).toBe(true));
    expect(list).not.toHaveBeenCalled();
  });

  it("skips a timeline entry with no data yet", () => {
    const qc = new QueryClient();
    qc.getQueryCache().build(qc, { queryKey: key });
    expect(() => refreshLoadedRoomTimelines(qc, "ws1")).not.toThrow();
  });
});

describe("timeline edges the core suite leaves out", () => {
  afterEach(() => vi.restoreAllMocks());
  const key = chatKeys.roomMessages("ws1", "room1");
  const shown = (qc: QueryClient, data: RoomTimeline) => {
    qc.setQueryData(key, data);
    new QueryObserver(qc, { queryKey: key, enabled: false }).subscribe(() => {});
  };

  it("pages older by cursor, or by time from a server without cursors", () => {
    expect(olderThan({ cursor: "c1", created_at: "t" })).toEqual({ cursor: "c1" });
    expect(olderThan({ created_at: "2026-01-01T10:00:00Z" })).toEqual({ before: "2026-01-01T10:00:00Z" });
  });

  it("orders messages of the same second by id, and lists a message on two pages once", () => {
    const a = msg("a", 1);
    const b = msg("b", 1);
    expect(compareMessages(a, b)).toBeLessThan(0);
    expect(compareMessages(b, a)).toBeGreaterThan(0);
    expect(compareMessages(a, a)).toBe(0);
    expect(ids(timeline([a, b], [a]))).toEqual(["a", "b"]);
  });

  it("places a created message between head rows, refuses one with no head, and trims a head past the cap", () => {
    expect(ids(insertCreatedTimelineMessage(timeline([msg("a", 1), msg("c", 3)]), msg("b", 2)))).toEqual(["a", "b", "c"]);
    expect(insertCreatedTimelineMessage({ pages: [], pageParams: [] }, msg("a", 1))).toBeNull();
    const head = Array.from({ length: CHAT_MESSAGE_CACHE_MAX }, (_, i) => msg(`h${i}`, 1));
    const next = insertCreatedTimelineMessage(timeline(head), msg("new", 2));
    expect(next?.pages[0]).toHaveLength(CHAT_MESSAGE_CACHE_MAX);
    expect(next?.pages[0]?.at(-1)?.id).toBe("new");
  });

  it("keeps a one-page timeline as it is, and reopening an unloaded room just fetches it", () => {
    const one = timeline([msg("a", 1)]);
    expect(keepRoomTimelineHead(one)).toBe(one);
    const qc = new QueryClient();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    refreshRoomTimelineOnOpen(qc, "ws1", "room1");
    expect(qc.getQueryData(key)).toBeUndefined();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: key });
  });

  it("waits out a failing fetch in flight without throwing (the query reports it)", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const fetching = qc.fetchQuery({ queryKey: key, queryFn: () => Promise.reject(new Error("down")) }).catch(() => "reported");
    await expect(roomTimelineFetchInFlight(qc, key)).resolves.toBeUndefined();
    await expect(fetching).resolves.toBe("reported");
    expect(roomTimelineFetchInFlight(qc, key)).toBeUndefined();
  });

  it("treats a key with no query as not shown", () => {
    const qc = new QueryClient();
    expect(markStaleUnlessObserved(qc, key)).toBe(false);
  });

  it("refetches the head when the newest message has no cursor or the read fails", async () => {
    const list = vi.spyOn(chatApi, "listMessages").mockRejectedValue(new TypeError("offline"));
    const qc = new QueryClient();
    shown(qc, timeline([{ ...msg("b", 2), cursor: undefined }]));
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    await catchUpRoomTimeline(qc, "ws1", "room1");
    expect(list).not.toHaveBeenCalled();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: key });

    shown(qc, timeline([msg("b", 2)]));
    invalidate.mockClear();
    await catchUpRoomTimeline(qc, "ws1", "room1");
    expect(invalidate).toHaveBeenCalledWith({ queryKey: key });
  });

  it("refetches when the timeline was dropped while the catch-up read ran", async () => {
    const qc = new QueryClient();
    shown(qc, timeline([msg("b", 2)]));
    vi.spyOn(chatApi, "listMessages").mockImplementation(async () => {
      qc.removeQueries({ queryKey: key });
      return [msg("c", 3)];
    });
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    await catchUpRoomTimeline(qc, "ws1", "room1");
    expect(invalidate).toHaveBeenCalledWith({ queryKey: key });
  });

  it("catches up only on a chat scope's subscribe_ack", async () => {
    const list = vi.spyOn(chatApi, "listMessages").mockResolvedValue([]);
    const qc = new QueryClient();
    shown(qc, timeline([msg("b", 2)]));
    expect(catchUpOnChatSubscribeAck(qc, "ws1", "subscribe_error", { scope: "chat", id: "room1" })).toBe(false);
    expect(catchUpOnChatSubscribeAck(qc, "ws1", "subscribe_ack", { scope: "workspace", id: "room1" })).toBe(false);
    expect(catchUpOnChatSubscribeAck(qc, "ws1", "subscribe_ack", { scope: "chat", id: "" })).toBe(false);
    expect(catchUpOnChatSubscribeAck(qc, "ws1", "subscribe_ack", { scope: "chat", id: "room1" })).toBe(true);
    await vi.waitFor(() => expect(list).toHaveBeenCalledTimes(1));
  });
});
