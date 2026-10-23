// The spec §8 parity table, frame by frame.
import { QueryClient, QueryObserver, type QueryKey } from "@tanstack/react-query";
import type { ChatMessageRecord, ChatRoomRecord } from "@uniwork/core/api/endpoints/chat-schemas";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api", () => ({ api: { request: vi.fn() } }));

import { chatApi } from "../chat-api";
import { flattenRoomTimeline, type RoomTimeline } from "@uniwork/core/chat/room-timeline-pages";
import { chatKeys } from "../queries/chat-keys";
import { onRoomRead } from "../room-read-signal";
import { decodeFrame, type RealtimeFrame } from "./frames";
import {
  BURST_CATCH_UP_MIN,
  createChatRealtime,
  LIVE_CHECK_MAX_MS,
  LIVE_CHECK_MS,
  ROOM_ACTIVITY_DEBOUNCE_MS,
  type ChatRealtimeDeps,
} from "./chat-realtime";
import { installReportSink } from "../report";

const msg = (id: string, minute: number, extra: Partial<ChatMessageRecord> = {}): ChatMessageRecord => ({
  id,
  room_id: "r1",
  workspace_id: "w1",
  sender_id: "u2",
  sender_display_name: "Bình",
  kind: "text",
  body: id,
  created_at: `2026-10-17T10:${String(minute).padStart(2, "0")}:00Z`,
  cursor: `c-${id}`,
  pinned: false,
  mentioned_user_ids: [],
  reactions: {},
  reply_count: 0,
  thread_unread: false,
  ...extra,
});

const room = (id: string, extra: Partial<ChatRoomRecord> = {}): ChatRoomRecord => ({
  id,
  kind: "dm",
  name: id,
  workspace_id: "w1",
  member_user_ids: [],
  member_count: 0,
  unread_count: 0,
  mention_unread_count: 0,
  ...extra,
});

const show = (qc: QueryClient, key: QueryKey, data: unknown) => {
  qc.setQueryData(key, data);
  new QueryObserver(qc, { queryKey: key, enabled: false }).subscribe(() => {});
};
const timelineKey = chatKeys.roomMessages("w1", "r1");
const ids = (qc: QueryClient) => flattenRoomTimeline(qc.getQueryData<RoomTimeline>(timelineKey)!).map((m) => m.id);

let qc: QueryClient;
let deps: ChatRealtimeDeps;
/** What ws-client hands on: the decoded frame, or (dropped there) a frame of a type nothing acts on. */
const frame = (type: string, payload: unknown = {}): RealtimeFrame => decodeFrame({ type, payload }) ?? { type: "dropped.by_decoder", payload };

beforeEach(() => {
  qc = new QueryClient();
  deps = {
    wsId: "w1",
    viewer: () => ({ userId: "u1", activeRoomId: null }),
    typing: { bump: vi.fn<ChatRealtimeDeps["typing"]["bump"]>() },
    presence: { bump: vi.fn<ChatRealtimeDeps["presence"]["bump"]>(), markOffline: vi.fn<ChatRealtimeDeps["presence"]["markOffline"]>() },
  };
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("message frames on an open room", () => {
  it("fetches a new message by id and appends it right away (no debounce)", async () => {
    const get = vi.spyOn(chatApi, "getMessage").mockResolvedValue(msg("m2", 2));
    show(qc, timelineKey, { pages: [[msg("m1", 1)]], pageParams: [null] });
    createChatRealtime(qc, deps).handle(frame("chat.message.created", { room_id: "r1", message_id: "m2", sender_id: "u2" }));
    await vi.waitFor(() => expect(ids(qc)).toEqual(["m1", "m2"]));
    expect(get).toHaveBeenCalledWith("w1", "r1", "m2");
  });

  // Audit P3 "ids-only-frame-fanout": the echo of one's own send costs no GET when the POST's answer is already shown.
  it("skips the GET for the echo of a message this phone sent; another device's send, or one not yet shown, is read", async () => {
    const get = vi.spyOn(chatApi, "getMessage").mockResolvedValue(msg("m3", 3, { sender_id: "U1" }));
    const threadKey = chatKeys.threadMessages("w1", "r1", "m1");
    show(qc, timelineKey, { pages: [[msg("m1", 1), msg("m2", 2, { sender_id: "U1" })]], pageParams: [null] });
    show(qc, threadKey, { pages: [[msg("m1", 1), msg("t1", 3, { thread_root_id: "m1", sender_id: "u1" })]], pageParams: [null] });
    const realtime = createChatRealtime(qc, deps);
    // Ids compare without case (lib/user-id.ts).
    realtime.handle(frame("chat.message.created", { room_id: "r1", message_id: "m2", sender_id: "u1" }));
    realtime.handle(frame("chat.message.created", { room_id: "r1", message_id: "t1", sender_id: "u1", thread_root_id: "m1" }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(get).not.toHaveBeenCalled();

    // Sent from another device (not in this cache yet), or someone else's.
    realtime.handle(frame("chat.message.created", { room_id: "r1", message_id: "m3", sender_id: "u1" }));
    await vi.waitFor(() => expect(ids(qc)).toEqual(["m1", "m2", "m3"]));
    expect(get).toHaveBeenCalledTimes(1);
    // A "created" frame for a message already on the timeline costs no GET whoever the viewer is (core's
    // chat-message-cache, f9cdc3c68): the cached row is the server's answer, and an edit arrives as "updated".
    deps.viewer = () => ({ userId: null, activeRoomId: null });
    realtime.handle(frame("chat.message.created", { room_id: "r1", message_id: "m2", sender_id: "u1" }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("patches an edit and a thread reply's root, and drops a deleted message", async () => {
    show(qc, timelineKey, { pages: [[msg("m1", 1), msg("m2", 2)]], pageParams: [null] });
    const realtime = createChatRealtime(qc, deps);
    vi.spyOn(chatApi, "getMessage").mockResolvedValueOnce({ ...msg("m1", 1), body: "đã sửa" });
    realtime.handle(frame("chat.message.updated", { room_id: "r1", message_id: "m1" }));
    await vi.waitFor(() => expect(flattenRoomTimeline(qc.getQueryData<RoomTimeline>(timelineKey)!)[0]?.body).toBe("đã sửa"));

    vi.spyOn(chatApi, "getMessage").mockResolvedValueOnce(msg("t1", 3, { thread_root_id: "m2" }));
    realtime.handle(frame("chat.thread.replied", { room_id: "r1", message_id: "t1", thread_root_id: "m2" }));
    await vi.waitFor(() => expect(flattenRoomTimeline(qc.getQueryData<RoomTimeline>(timelineKey)!)[1]?.reply_count).toBe(1));
    expect(ids(qc)).toEqual(["m1", "m2"]);

    realtime.handle(frame("chat.message.deleted", { room_id: "r1", message_id: "m1" }));
    expect(ids(qc)).toEqual(["m2"]);
  });

  it("ignores frames without the ids they need, and frames it does not know", () => {
    const get = vi.spyOn(chatApi, "getMessage");
    const realtime = createChatRealtime(qc, deps);
    for (const type of ["chat.message.created", "chat.message.deleted", "chat.mention.created", "chat.room.read", "chat.typing", "user.presence", "user.offline", "task.updated"]) {
      realtime.handle(frame(type));
    }
    realtime.handle(frame("chat.message.created", null));
    // Decoded frames this table does not act on: the call engine's, the subscription errors, the workspace's.
    realtime.handle(frame("chat.voice.invite", { room_id: "r1", call_id: "c1", caller_id: "u2" }));
    realtime.handle(frame("subscribe_error", { scope: "chat", id: "r1", error: "forbidden" }));
    realtime.handle(frame("workspace.updated", { workspace_id: "w1" }));
    expect(get).not.toHaveBeenCalled();
    expect(deps.typing.bump).not.toHaveBeenCalled();
    expect(deps.presence.markOffline).not.toHaveBeenCalled();
  });
});

describe("list-level frames", () => {
  it("counts a mention in the default channel and refreshes the message; a thread mention only refreshes", async () => {
    vi.spyOn(chatApi, "getMessage").mockResolvedValue(null);
    qc.setQueryData(chatKeys.rooms("w1"), [room("ws-room", { kind: "channel", is_default: true })]);
    const realtime = createChatRealtime(qc, deps);
    realtime.handle(frame("chat.mention.created", { room_id: "ws-room", sender_id: "u2" }));
    realtime.handle(frame("chat.mention.created", { room_id: "ws-room", sender_id: "u2", thread_root_id: "t", message_id: "m" }));
    realtime.handle(frame("chat.mention.created", { room_id: "ws-room", message_id: "m" }));
    expect(qc.getQueryData<ChatRoomRecord[]>(chatKeys.rooms("w1"))?.[0]?.mention_unread_count).toBe(2);
  });

  it("refetches the rooms list once per burst, with the members and channels the frame names", async () => {
    vi.useFakeTimers();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const realtime = createChatRealtime(qc, deps);
    realtime.handle(frame("chat.room.activity", { room_id: "r1" }));
    realtime.handle(frame("chat.room.activity", { room_id: "r2" }));
    realtime.handle(frame("chat.room.member_added", { room_id: "r1" }));
    realtime.handle(frame("chat.room.updated"));
    for (const type of ["chat.room.created", "chat.room.members_added", "chat.room.member_removed"]) realtime.handle(frame(type));
    realtime.handle(frame("chat.channel.created", { room_id: "c1" }));
    realtime.handle(frame("chat.channel.updated"));
    realtime.handle(frame("chat.channel.archived"));
    expect(invalidate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(ROOM_ACTIVITY_DEBOUNCE_MS);
    expect(invalidate.mock.calls.map(([filters]) => filters?.queryKey)).toEqual([
      chatKeys.rooms("w1"),
      chatKeys.unreadSummary(),
      chatKeys.roomMembers("w1", "r1"),
      chatKeys.discoverableChannels("w1"),
    ]);
    realtime.handle(frame("chat.room.activity"));
    realtime.dispose();
    await vi.advanceTimersByTimeAsync(ROOM_ACTIVITY_DEBOUNCE_MS);
    expect(invalidate).toHaveBeenCalledTimes(4);
    realtime.dispose();
  });

  it("refetches the follow-up list once per burst of follow-up frames (M3)", async () => {
    vi.useFakeTimers();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const realtime = createChatRealtime(qc, deps);
    for (const verb of ["created", "updated", "completed", "deleted"]) realtime.handle(frame(`chat.follow_up.${verb}`, { follow_up_id: "f1" }));
    await vi.advanceTimersByTimeAsync(ROOM_ACTIVITY_DEBOUNCE_MS);
    expect(invalidate.mock.calls.map(([filters]) => filters?.queryKey)).toEqual([chatKeys.followUps("w1")]);
    realtime.dispose();
  });

  it("clears my badges on my read anywhere, and moves a DM's Seen on the peer's", () => {
    qc.setQueryData(chatKeys.rooms("w1"), [room("r1", { unread_count: 2, last_message_at: "2026-10-17T10:00:00Z" })]);
    const realtime = createChatRealtime(qc, deps);
    const heard = vi.fn();
    const stop = onRoomRead(heard);
    realtime.handle(frame("chat.room.read", { room_id: "r1", user_id: "u2" }));
    expect(heard).not.toHaveBeenCalled();
    realtime.handle(frame("chat.room.read", { room_id: "r1", user_id: "u1" }));
    stop();
    expect(qc.getQueryData<ChatRoomRecord[]>(chatKeys.rooms("w1"))?.[0]).toMatchObject({
      unread_count: 0,
      peer_last_read_at: "2026-10-17T10:00:00Z",
    });
    // Read on another of my devices: its notifications come down on this one too.
    expect(heard).toHaveBeenCalledWith("r1");
  });

  it("feeds typing and presence into their stores, once signed in", () => {
    const realtime = createChatRealtime(qc, deps);
    realtime.handle(frame("chat.typing", { room_id: "r1", user_id: "u2" }));
    realtime.handle(frame("user.presence", { user_id: "u2" }));
    realtime.handle(frame("user.offline", { user_id: "u3" }));
    expect(deps.typing.bump).toHaveBeenCalledWith("r1", "u2", "u1");
    expect(deps.presence.bump).toHaveBeenCalledWith("u2", "u1");
    expect(deps.presence.markOffline).toHaveBeenCalledWith("u3");

    const signedOut = createChatRealtime(qc, { ...deps, viewer: () => ({ userId: null, activeRoomId: null }) });
    signedOut.handle(frame("chat.typing", { room_id: "r1", user_id: "u2" }));
    signedOut.handle(frame("user.presence", { user_id: "u2" }));
    signedOut.handle(frame("chat.room.read", { room_id: "r1", user_id: "u2" }));
    expect(deps.typing.bump).toHaveBeenCalledTimes(1);
    expect(deps.presence.bump).toHaveBeenCalledTimes(1);
  });
});

describe("socket lifecycle", () => {
  it("reads what a room missed when its scope is admitted again", async () => {
    const list = vi.spyOn(chatApi, "listMessages").mockResolvedValue([msg("m2", 2)]);
    show(qc, timelineKey, { pages: [[msg("m1", 1)]], pageParams: [null] });
    createChatRealtime(qc, deps).handle(frame("subscribe_ack", { scope: "chat", id: "r1" }));
    await vi.waitFor(() => expect(ids(qc)).toEqual(["m1", "m2"]));
    expect(list).toHaveBeenCalledWith("w1", "r1", { after: "c-m1", limit: 50, markRead: false });
  });

  it("after a reconnect refreshes the rooms list, nicknames, members, call logs, threads and the open timelines", async () => {
    vi.useFakeTimers();
    show(qc, timelineKey, { pages: [[msg("m2", 2)], [msg("m1", 1)]], pageParams: [null, { cursor: "c" }] });
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    createChatRealtime(qc, deps).reconnect();
    // The pages scrolled back through stay (chat-timeline.ts › refreshLoadedRoomTimelines).
    expect(qc.getQueryData<RoomTimeline>(timelineKey)?.pages).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(ROOM_ACTIVITY_DEBOUNCE_MS);
    const keys = invalidate.mock.calls.map(([filters]) => filters?.queryKey);
    expect(keys).toEqual(
      expect.arrayContaining([
        chatKeys.rooms("w1"),
        chatKeys.nicknames("w1"),
        chatKeys.members("w1"),
        chatKeys.callLogs("w1"),
        ["chat", "w1", "thread-messages"],
        timelineKey,
      ]),
    );
  });

  // ADR 0039 phase 1: the change log answers a reconnect with one request; only when it cannot does every page refetch.
  it("after a reconnect reads the change log, and refetches the open timelines only when the log cannot answer", async () => {
    show(qc, timelineKey, { pages: [[msg("m2", 2)], [msg("m1", 1)]], pageParams: [null, { cursor: "c" }] });
    const timelineInvalidated = (spy: { mock: { calls: Array<[{ queryKey?: unknown }?, ...unknown[]]> } }) =>
      spy.mock.calls.some(([filters]) => JSON.stringify(filters?.queryKey) === JSON.stringify(timelineKey));
    for (const [outcome, refetched] of [
      ["synced", false],
      ["reset", true],
      ["unavailable", true],
    ] as const) {
      const invalidate = vi.spyOn(qc, "invalidateQueries");
      const sync = vi.fn(async () => outcome);
      const realtime = createChatRealtime(qc, { ...deps, sync });
      realtime.reconnect();
      await vi.waitFor(() => expect(sync).toHaveBeenCalledTimes(1));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(timelineInvalidated(invalidate)).toBe(refetched);
      realtime.dispose();
      invalidate.mockRestore();
    }
    // A sync that throws is reported, and the old path runs.
    const captured = vi.fn();
    installReportSink({ captureException: captured, addBreadcrumb: vi.fn(), setUser: vi.fn(), setTag: vi.fn() });
    try {
      const invalidate = vi.spyOn(qc, "invalidateQueries");
      createChatRealtime(qc, { ...deps, sync: vi.fn(async () => Promise.reject(new Error("bug"))) }).reconnect();
      await vi.waitFor(() => expect(timelineInvalidated(invalidate)).toBe(true));
      expect(captured).toHaveBeenCalled();
    } finally {
      installReportSink(null);
    }
  });

  it("checks the live socket every minute: the log when it answers, a reload on reset, a catch-up of shown rooms without it", async () => {
    vi.useFakeTimers();
    show(qc, timelineKey, { pages: [[msg("m2", 2)]], pageParams: [null] });
    qc.setQueryData(chatKeys.roomMessages("w1", "r9"), { pages: [[]], pageParams: [null] });
    const list = vi.spyOn(chatApi, "listMessages").mockResolvedValue([]);
    let live = false;
    const sync = vi.fn<NonNullable<ChatRealtimeDeps["sync"]>>(async () => "synced");
    const realtime = createChatRealtime(qc, { ...deps, sync, isLive: () => live });
    // Not live (the app behind, the socket down): nothing is asked.
    await vi.advanceTimersByTimeAsync(LIVE_CHECK_MS);
    expect(sync).not.toHaveBeenCalled();
    live = true;
    await vi.advanceTimersByTimeAsync(LIVE_CHECK_MS);
    expect(sync).toHaveBeenCalledTimes(1);
    expect(list).not.toHaveBeenCalled();

    const invalidate = vi.spyOn(qc, "invalidateQueries");
    sync.mockResolvedValueOnce("reset");
    await vi.advanceTimersByTimeAsync(LIVE_CHECK_MS);
    expect(invalidate.mock.calls.map(([filters]) => filters?.queryKey)).toContainEqual(timelineKey);

    // Without the log: the shown room reads what it missed after its newest message; the unshown one waits.
    sync.mockResolvedValueOnce("unavailable");
    await vi.advanceTimersByTimeAsync(LIVE_CHECK_MS);
    expect(list).toHaveBeenCalledTimes(1);
    expect(list).toHaveBeenCalledWith("w1", "r1", expect.objectContaining({ after: "c-m2" }));
    realtime.dispose();
    await vi.advanceTimersByTimeAsync(LIVE_CHECK_MS * 3);
    expect(sync).toHaveBeenCalledTimes(3);

    // No log wired at all: the same catch-up; a failed one is a breadcrumb, not a throw.
    list.mockRejectedValueOnce(new TypeError("Network request failed"));
    const bare = createChatRealtime(qc, { ...deps, isLive: () => true });
    await vi.advanceTimersByTimeAsync(LIVE_CHECK_MS);
    expect(list).toHaveBeenCalledTimes(2);
    bare.dispose();
  });

  // Review P2 (a log row lost to a failed write is in no sync): a reconnect that syncs still catches the open room up,
  // through the subscribe_ack of its replayed chat scope, not through a second read here.
  it("after a reconnect the log answers, the open room reads what it got after its newest message once, on its scope's ack", async () => {
    show(qc, timelineKey, { pages: [[msg("m2", 2)]], pageParams: [null] });
    const list = vi.spyOn(chatApi, "listMessages").mockResolvedValue([msg("m3", 3)]);
    const sync = vi.fn(async () => "synced" as const);
    const realtime = createChatRealtime(qc, { ...deps, sync });
    realtime.reconnect();
    await vi.waitFor(() => expect(sync).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(list).not.toHaveBeenCalled();
    realtime.handle(frame("subscribe_ack", { scope: "chat", id: "r1" }));
    await vi.waitFor(() => expect(ids(qc)).toEqual(["m2", "m3"]));
    expect(list).toHaveBeenCalledTimes(1);
    realtime.dispose();
  });

  // Review P2: the check ran on a fixed minute even on a socket busy with frames; the flag and the ADR say a quiet minute.
  it("waits for a quiet minute while message frames flow, but checks at least every few minutes", async () => {
    vi.useFakeTimers();
    vi.spyOn(chatApi, "getMessage").mockResolvedValue(msg("m9", 9));
    const sync = vi.fn<NonNullable<ChatRealtimeDeps["sync"]>>(async () => "synced");
    const realtime = createChatRealtime(qc, { ...deps, sync, isLive: () => true });
    const busy = async (ms: number) => {
      for (let at = 0; at < ms; at += LIVE_CHECK_MS / 2) {
        realtime.handle(frame("chat.message.updated", { room_id: "r1", message_id: "m9" }));
        await vi.advanceTimersByTimeAsync(LIVE_CHECK_MS / 2);
      }
    };
    await busy(LIVE_CHECK_MS * 3);
    expect(sync).not.toHaveBeenCalled();
    // However busy, a frame the relay lost is looked for at the latest every LIVE_CHECK_MAX_MS.
    await busy(LIVE_CHECK_MAX_MS - LIVE_CHECK_MS * 3);
    expect(sync).toHaveBeenCalledTimes(1);
    // Quiet again: the next minute checks.
    await vi.advanceTimersByTimeAsync(LIVE_CHECK_MS);
    expect(sync).toHaveBeenCalledTimes(2);
    realtime.dispose();
  });

  it("refetches the call logs once a call hangs up (the server wrote the log before the frame)", async () => {
    vi.useFakeTimers();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    createChatRealtime(qc, deps).handle(frame("chat.voice.hangup", { room_id: "r1", call_id: "c1", user_id: "u2" }));
    await vi.advanceTimersByTimeAsync(ROOM_ACTIVITY_DEBOUNCE_MS);
    expect(invalidate.mock.calls.map(([filters]) => filters?.queryKey)).toEqual([chatKeys.callLogs("w1")]);
  });

  it("does not drop a frame whose GET failed (audit R4): a new message is read by a catch-up, the list follows", async () => {
    vi.spyOn(chatApi, "getMessage").mockRejectedValue(new TypeError("Network request failed"));
    const list = vi.spyOn(chatApi, "listMessages").mockResolvedValue([msg("m2", 2)]);
    show(qc, timelineKey, { pages: [[msg("m1", 1)]], pageParams: [null] });
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    createChatRealtime(qc, deps).handle(frame("chat.message.created", { room_id: "r1", message_id: "m2", sender_id: "u2" }));
    await vi.waitFor(() => expect(ids(qc)).toEqual(["m1", "m2"]));
    expect(list).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: chatKeys.rooms("w1") }));
  });

  it("an edit or a thread reply whose GET failed refetches the room and the thread", async () => {
    vi.spyOn(chatApi, "getMessage").mockRejectedValue(new Error("500"));
    show(qc, timelineKey, { pages: [[msg("m1", 1)]], pageParams: [null] });
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const realtime = createChatRealtime(qc, deps);
    realtime.handle(frame("chat.message.updated", { room_id: "r1", message_id: "m1" }));
    realtime.handle(frame("chat.thread.replied", { room_id: "r2", message_id: "t1", thread_root_id: "root" }));
    show(qc, chatKeys.threadMessages("w1", "r2", "root"), { pages: [[msg("root", 0)]], pageParams: [null] });
    await vi.waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: chatKeys.threadMessages("w1", "r2", "root") }));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: timelineKey });
  });

  it("reads a burst of new messages behind a GET as one catch-up, and still GETs an edit in it once", async () => {
    let answer: (m: ChatMessageRecord) => void = () => undefined;
    const get = vi
      .spyOn(chatApi, "getMessage")
      .mockReturnValueOnce(new Promise((resolve) => (answer = resolve)))
      .mockResolvedValue({ ...msg("m1", 1), body: "đã sửa" });
    const list = vi.spyOn(chatApi, "listMessages").mockResolvedValue([msg("m3", 3), msg("m4", 4), msg("m5", 5)]);
    show(qc, timelineKey, { pages: [[msg("m1", 1)]], pageParams: [null] });
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const realtime = createChatRealtime(qc, deps);
    realtime.handle(frame("chat.message.created", { room_id: "r1", message_id: "m2", sender_id: "u2" }));
    for (const id of ["m3", "m4", "m5", "m5"]) realtime.handle(frame("chat.message.created", { room_id: "r1", message_id: id, sender_id: "u2" }));
    realtime.handle(frame("chat.message.updated", { room_id: "r1", message_id: "m1" }));
    realtime.handle(frame("chat.message.updated", { room_id: "r1", message_id: "m1" }));
    expect(BURST_CATCH_UP_MIN).toBe(2);
    answer(msg("m2", 2));
    await vi.waitFor(() => expect(ids(qc)).toEqual(["m1", "m2", "m3", "m4", "m5"]));
    await vi.waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    expect(get.mock.calls.map((call) => call[2])).toEqual(["m2", "m1"]);
    expect(list).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(flattenRoomTimeline(qc.getQueryData<RoomTimeline>(timelineKey)!)[0]?.body).toBe("đã sửa"));
    await vi.waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: chatKeys.rooms("w1") }));
  });

  it("a burst in a room nobody shows is counted frame by frame, without a catch-up", async () => {
    const list = vi.spyOn(chatApi, "listMessages");
    const get = vi.spyOn(chatApi, "getMessage");
    qc.setQueryData(chatKeys.rooms("w1"), [room("r9")]);
    const realtime = createChatRealtime(qc, deps);
    for (const id of ["a", "b", "c"]) realtime.handle(frame("chat.message.created", { room_id: "r9", message_id: id, sender_id: "u2" }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(list).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
  });
});
