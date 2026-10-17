import { QueryClient, QueryObserver } from "@tanstack/react-query";
import type { ChatMessageRecord, ChatRoomRecord } from "@uniwork/core/api/endpoints/chat-schemas";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./api", () => ({ api: { request: vi.fn() } }));

import { chatApi } from "./chat-api";
import {
  deleteMessage,
  editMessage,
  joinChannel,
  leaveRoom,
  markRoomRead,
  markThreadRead,
  refreshMessageMedia,
  resolveDMRoom,
  setRoomMuted,
  toggleReaction,
} from "./chat-actions";
import { flattenRoomTimeline, type RoomTimeline } from "./chat-timeline";
import { chatKeys } from "./queries/chat-keys";

const room = (id: string, extra: Partial<ChatRoomRecord> = {}): ChatRoomRecord => ({
  id,
  kind: "dm",
  name: id,
  workspace_id: "w1",
  member_user_ids: [],
  member_count: 0,
  unread_count: 3,
  mention_unread_count: 1,
  ...extra,
});
const msg = (id: string, extra: Partial<ChatMessageRecord> = {}): ChatMessageRecord => ({
  id,
  room_id: "r1",
  workspace_id: "w1",
  sender_id: "u1",
  sender_display_name: "An",
  kind: "text",
  body: id,
  created_at: "2026-10-17T10:00:00Z",
  pinned: false,
  mentioned_user_ids: [],
  reactions: {},
  reply_count: 0,
  thread_unread: false,
  ...extra,
});
const rooms = (qc: QueryClient) => qc.getQueryData<ChatRoomRecord[]>(chatKeys.rooms("w1"));
const timelineKey = chatKeys.roomMessages("w1", "r1");
const withTimeline = (qc: QueryClient, rows: ChatMessageRecord[]) => {
  qc.setQueryData<RoomTimeline>(timelineKey, { pages: [rows], pageParams: [null] });
  new QueryObserver(qc, { queryKey: timelineKey, enabled: false }).subscribe(() => {});
};

afterEach(() => vi.restoreAllMocks());

describe("chat actions", () => {
  it("marks a room read: the badge clears at once and stays cleared", async () => {
    const qc = new QueryClient();
    qc.setQueryData(chatKeys.rooms("w1"), [room("r1"), room("r2")]);
    const mark = vi.spyOn(chatApi, "markRoomRead").mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await markRoomRead(qc, "w1", "r1");
    await markRoomRead(qc, "w1", "r1");
    expect(mark).toHaveBeenCalledWith("w1", "r1");
    expect(rooms(qc)?.map((r) => [r.unread_count, r.mention_unread_count])).toEqual([[0, 0], [3, 1]]);
    await markRoomRead(new QueryClient(), "w1", "r1");
  });

  it("marks a thread read and hands back the pointer it replaced", async () => {
    vi.spyOn(chatApi, "markThreadRead").mockResolvedValue("2026-10-01T00:00:00Z");
    expect(await markThreadRead("w1", "root")).toBe("2026-10-01T00:00:00Z");
  });

  it("mutes optimistically and restores the row when the server refuses or fails", async () => {
    const qc = new QueryClient();
    qc.setQueryData(chatKeys.rooms("w1"), [room("r1"), room("r2")]);
    vi.spyOn(chatApi, "setRoomMuted").mockResolvedValueOnce(true).mockResolvedValueOnce(false).mockRejectedValueOnce(new TypeError("offline"));
    await setRoomMuted(qc, "w1", "r1", true);
    expect(rooms(qc)?.map((r) => r.notifications_muted)).toEqual([true, undefined]);
    await expect(setRoomMuted(qc, "w1", "r1", false)).rejects.toThrow("chat_room_mute_failed");
    await expect(setRoomMuted(qc, "w1", "r1", false)).rejects.toThrow("chat_room_mute_failed");
    expect(rooms(qc)?.[0]?.notifications_muted).toBe(true);
    vi.spyOn(chatApi, "setRoomMuted").mockResolvedValue(true);
    await setRoomMuted(new QueryClient(), "w1", "r1", true);
  });

  it("puts a reaction's and an edit's answer in place", async () => {
    const qc = new QueryClient();
    withTimeline(qc, [msg("m1")]);
    vi.spyOn(chatApi, "toggleReaction").mockResolvedValue(msg("m1", { reactions: { "👍": 1 }, my_reactions: ["👍"] }));
    await toggleReaction(qc, "w1", "r1", "m1", "👍");
    expect(flattenRoomTimeline(qc.getQueryData<RoomTimeline>(timelineKey)!)[0]?.reactions).toEqual({ "👍": 1 });
    vi.spyOn(chatApi, "editMessage").mockResolvedValue(msg("m1", { body: "sửa", edited_at: "2026-10-17T10:05:00Z" }));
    await editMessage(qc, "w1", "r1", "m1", "sửa");
    expect(flattenRoomTimeline(qc.getQueryData<RoomTimeline>(timelineKey)!)[0]).toMatchObject({
      body: "sửa",
      edited_at: "2026-10-17T10:05:00Z",
    });
  });

  it("deletes a message, and reports a delete the server did not confirm", async () => {
    const qc = new QueryClient();
    withTimeline(qc, [msg("m1"), msg("m2")]);
    vi.spyOn(chatApi, "deleteMessage").mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await deleteMessage(qc, "w1", "r1", "m1");
    expect(flattenRoomTimeline(qc.getQueryData<RoomTimeline>(timelineKey)!).map((m) => m.id)).toEqual(["m2"]);
    await expect(deleteMessage(qc, "w1", "r1", "m2")).rejects.toThrow("chat_message_delete_failed");
  });

  it("reloads a message for fresh media URLs, and leaves the cache alone when it is gone", async () => {
    const qc = new QueryClient();
    withTimeline(qc, [msg("m1", { kind: "file" })]);
    const fresh = msg("m1", { kind: "file", file: { filename: "a.png", content_type: "image/png", size_bytes: 1, url: "https://s/new", download_url: "", thumb_url: "", url_expires_at: "" } });
    vi.spyOn(chatApi, "getMessage").mockResolvedValueOnce(fresh).mockResolvedValueOnce(null);
    expect(await refreshMessageMedia(qc, "w1", "r1", "m1")).toBe(fresh);
    expect(flattenRoomTimeline(qc.getQueryData<RoomTimeline>(timelineKey)!)[0]?.file?.url).toBe("https://s/new");
    expect(await refreshMessageMedia(qc, "w1", "r1", "m1")).toBeNull();
  });

  it("opens a DM and joins a channel, refreshing the lists", async () => {
    const qc = new QueryClient();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    vi.spyOn(chatApi, "resolveDMRoom").mockResolvedValue(room("dm1"));
    vi.spyOn(chatApi, "joinChannel").mockResolvedValue(room("c1", { kind: "channel" }));
    expect(await resolveDMRoom(qc, "w1", "u2")).toMatchObject({ id: "dm1" });
    expect(await joinChannel(qc, "w1", "c1")).toMatchObject({ id: "c1" });
    expect(invalidate.mock.calls.map(([f]) => f?.queryKey)).toEqual([
      chatKeys.rooms("w1"),
      chatKeys.rooms("w1"),
      chatKeys.discoverableChannels("w1"),
    ]);
  });

  it("leaves a room: gone from the list and its timeline dropped; a refusal throws", async () => {
    const qc = new QueryClient();
    qc.setQueryData(chatKeys.rooms("w1"), [room("r1"), room("r2")]);
    qc.setQueryData(timelineKey, { pages: [[]], pageParams: [null] });
    vi.spyOn(chatApi, "leaveRoom").mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await leaveRoom(qc, "w1", "r1");
    expect(rooms(qc)?.map((r) => r.id)).toEqual(["r2"]);
    expect(qc.getQueryData(timelineKey)).toBeUndefined();
    await expect(leaveRoom(qc, "w1", "r2")).rejects.toThrow("chat_room_leave_failed");
  });
});
