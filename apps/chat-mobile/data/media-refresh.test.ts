// Expired media URLs renewed per room, not per photo (audit P2 Perf).
import { InfiniteQueryObserver, QueryClient } from "@tanstack/react-query";
import type { ChatMessageRecord } from "@uniwork/core/api/endpoints/chat-schemas";
import type { RoomTimeline } from "@uniwork/core/chat/room-timeline-pages";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

// The transport reaches React Native; chatApi.getMessage is spied on below.
vi.mock("./api", () => ({ api: { request: vi.fn() } }));
import { chatApi } from "./chat-api";
import { MEDIA_REFRESH_BATCH_MS, refreshRoomMedia, requestMediaRefresh } from "./media-refresh";
import { chatKeys } from "./queries/chat-keys";
import { installReportSink } from "./report";

const msg = (id: string): ChatMessageRecord => ({
  id,
  room_id: "r1",
  workspace_id: "w1",
  sender_id: "u1",
  sender_display_name: "An",
  kind: "file",
  body: id,
  created_at: "2026-10-17T10:00:00Z",
  pinned: false,
  mentioned_user_ids: [],
  reactions: {},
  reply_count: 0,
  thread_unread: false,
});
const timelineKey = chatKeys.roomMessages("w1", "r1");

/** A room timeline a screen shows: its observer brings the query function, as roomTimelineOptions does. */
function shown(qc: QueryClient, pages: ChatMessageRecord[][], queryFn = vi.fn(async () => pages[0] ?? [])) {
  qc.setQueryData<RoomTimeline>(timelineKey, { pages, pageParams: pages.map((_, n) => (n === 0 ? null : { cursor: `c${n}` })) });
  new InfiniteQueryObserver(qc, {
    queryKey: timelineKey,
    queryFn,
    staleTime: Infinity,
    initialPageParam: null as { cursor: string } | null,
    getNextPageParam: () => undefined,
  }).subscribe(() => undefined);
  return queryFn;
}

let getMessage: MockInstance<typeof chatApi.getMessage>;

beforeEach(() => {
  getMessage = vi.spyOn(chatApi, "getMessage").mockImplementation(async (_ws, _room, id) => msg(id));
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const asked = (): string[] => getMessage.mock.calls.map((call) => call[2]);

describe("refreshRoomMedia", () => {
  it("renews many photos of a shown timeline with one refetch, and the rest one by one", async () => {
    const qc = new QueryClient();
    const fetchPage = shown(qc, [[msg("a"), msg("b"), msg("c")]]);
    await refreshRoomMedia(qc, "w1", "r1", ["a", "b", "thread-reply"]);
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(asked()).toEqual(["thread-reply"]);
  });

  it("asks one by one when that is fewer requests than refetching every loaded page", async () => {
    const qc = new QueryClient();
    const fetchPage = shown(qc, [[msg("a")], [msg("b")], [msg("c")]]);
    await refreshRoomMedia(qc, "w1", "r1", ["c"]);
    expect(fetchPage).not.toHaveBeenCalled();
    expect(asked()).toEqual(["c"]);
  });

  it("asks one by one for a timeline no screen shows, or none at all", async () => {
    const qc = new QueryClient();
    await refreshRoomMedia(qc, "w1", "r1", ["a"]);
    qc.setQueryData<RoomTimeline>(timelineKey, { pages: [[msg("a")]], pageParams: [null] });
    await refreshRoomMedia(qc, "w1", "r1", ["a"]);
    expect(asked()).toEqual(["a", "a"]);
  });

  it("joins a refetch already on the wire instead of asking again", async () => {
    const qc = new QueryClient();
    let answer: (rows: ChatMessageRecord[]) => void = () => undefined;
    const fetchPage = vi.fn(() => new Promise<ChatMessageRecord[]>((resolve) => (answer = resolve)));
    shown(qc, [[msg("a"), msg("b")]], fetchPage);
    const opening = qc.refetchQueries({ queryKey: timelineKey, exact: true });
    const renewing = refreshRoomMedia(qc, "w1", "r1", ["a", "b"]);
    answer([msg("a"), msg("b")]);
    await Promise.all([opening, renewing]);
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(getMessage).not.toHaveBeenCalled();
  });
});

describe("requestMediaRefresh", () => {
  it("gathers one room's asks within the batch window into one renewal", async () => {
    vi.useFakeTimers();
    const qc = new QueryClient();
    const fetchPage = shown(qc, [[msg("a"), msg("b"), msg("c")]]);
    requestMediaRefresh(qc, "w1", "r1", "a");
    requestMediaRefresh(qc, "w1", "r1", "b");
    requestMediaRefresh(qc, "w1", "r1", "c");
    await vi.advanceTimersByTimeAsync(MEDIA_REFRESH_BATCH_MS);
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(getMessage).not.toHaveBeenCalled();
    // The window closed: the next ask opens a new one.
    requestMediaRefresh(qc, "w1", "r1", "a");
    await vi.advanceTimersByTimeAsync(MEDIA_REFRESH_BATCH_MS);
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it("keeps two query clients' asks apart, and reports a renewal that fails", async () => {
    vi.useFakeTimers();
    const captured: unknown[] = [];
    installReportSink({ captureException: (error) => void captured.push(error), addBreadcrumb: vi.fn(), setUser: vi.fn(), setTag: vi.fn() });
    getMessage.mockRejectedValue(new Error("down"));
    const first = new QueryClient();
    const second = new QueryClient();
    requestMediaRefresh(first, "w1", "r1", "a");
    requestMediaRefresh(second, "w1", "r1", "b");
    await vi.advanceTimersByTimeAsync(MEDIA_REFRESH_BATCH_MS);
    expect(asked().sort()).toEqual(["a", "b"]);
    expect(captured).toHaveLength(2);
    installReportSink(null);
  });
});
