// The spec §8 parity table, frame by frame.
import { QueryClient, QueryObserver, type QueryKey } from "@tanstack/react-query";
import type { ChatMessageRecord, ChatRoomRecord } from "@uniwork/core/api/endpoints/chat-schemas";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api", () => ({ api: { request: vi.fn() } }));

import { chatApi } from "../chat-api";
import { flattenRoomTimeline, type RoomTimeline } from "../chat-timeline";
import { chatKeys } from "../queries/chat-keys";
import { createChatRealtime, ROOM_ACTIVITY_DEBOUNCE_MS, type ChatRealtimeDeps } from "./chat-realtime";

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
const frame = (type: string, payload: Record<string, string> = {}) => ({ type, payload });

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
    realtime.handle({ type: "chat.message.created", payload: null });
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
      chatKeys.roomMembers("w1", "r1"),
      chatKeys.discoverableChannels("w1"),
    ]);
    realtime.handle(frame("chat.room.activity"));
    realtime.dispose();
    await vi.advanceTimersByTimeAsync(ROOM_ACTIVITY_DEBOUNCE_MS);
    expect(invalidate).toHaveBeenCalledTimes(3);
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
    realtime.handle(frame("chat.room.read", { room_id: "r1", user_id: "u2" }));
    realtime.handle(frame("chat.room.read", { room_id: "r1", user_id: "u1" }));
    expect(qc.getQueryData<ChatRoomRecord[]>(chatKeys.rooms("w1"))?.[0]).toMatchObject({
      unread_count: 0,
      peer_last_read_at: "2026-10-17T10:00:00Z",
    });
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

  it("after a reconnect refreshes the rooms list, nicknames, threads and the open timelines", async () => {
    vi.useFakeTimers();
    show(qc, timelineKey, { pages: [[msg("m2", 2)], [msg("m1", 1)]], pageParams: [null, { cursor: "c" }] });
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    createChatRealtime(qc, deps).reconnect();
    expect(qc.getQueryData<RoomTimeline>(timelineKey)?.pages).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(ROOM_ACTIVITY_DEBOUNCE_MS);
    const keys = invalidate.mock.calls.map(([filters]) => filters?.queryKey);
    expect(keys).toEqual(
      expect.arrayContaining([chatKeys.rooms("w1"), chatKeys.nicknames("w1"), ["chat", "w1", "thread-messages"], timelineKey]),
    );
  });
});
