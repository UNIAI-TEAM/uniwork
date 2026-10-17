import { QueryClient, QueryObserver } from "@tanstack/react-query";
import type { ChatMessageRecord, ChatRoomRecord } from "@uniwork/core/api/endpoints/chat-schemas";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./api", () => ({ api: { request: vi.fn() } }));

import { chatApi } from "./chat-api";
import {
  createTaskFromMessage,
  deleteMessage,
  followUpCommand,
  editMessage,
  joinChannel,
  leaveRoom,
  markRoomRead,
  markThreadRead,
  refreshMessageMedia,
  resolveDMRoom,
  sendReminder,
  sendVoiceMessage,
  setRoomMuted,
  toggleReaction,
  votePoll,
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

  it("puts a vote's answer in place (M3)", async () => {
    const qc = new QueryClient();
    withTimeline(qc, [msg("m1", { kind: "poll" })]);
    const poll = { question: "Ăn gì?", options: [{ id: "o1", label: "Phở", votes: 1 }], settings: { deadline_at: null, pin_to_top: false, allow_multiple: true, allow_add_options: true, hide_results_until_vote: false, hide_voters: false }, viewer_option_ids: ["o1"] };
    const vote = vi.spyOn(chatApi, "votePoll").mockResolvedValue(msg("m1", { kind: "poll", poll } as Partial<ChatMessageRecord>));
    await votePoll(qc, "w1", "r1", "m1", "o1");
    expect(vote).toHaveBeenCalledWith("w1", "r1", "m1", "o1");
    expect(flattenRoomTimeline(qc.getQueryData<RoomTimeline>(timelineKey)!)[0]?.poll?.viewer_option_ids).toEqual(["o1"]);
  });

  it("sends a voice clip and a reminder like the web, inside the server's bounds, and reports nothing back", async () => {
    const qc = new QueryClient();
    withTimeline(qc, []);
    const voice = vi.spyOn(chatApi, "sendVoiceMessage").mockResolvedValueOnce(msg("v1", { kind: "voice" })).mockResolvedValueOnce(null);
    await sendVoiceMessage(qc, "w1", "r1", { uri: "file:///a.m4a", durationMs: 130_400.6, replyToMessageId: "m0" });
    expect(voice).toHaveBeenCalledWith("w1", "r1", expect.objectContaining({ uri: "file:///a.m4a", duration_ms: 120_000, reply_to_message_id: "m0", client_msg_id: expect.any(String) }));
    await expect(sendVoiceMessage(qc, "w1", "r1", { uri: "file:///b.m4a", durationMs: 0 })).rejects.toThrow("chat_voice_send_failed");
    expect(voice.mock.calls[1]?.[2].duration_ms).toBe(1);

    const send = vi.spyOn(chatApi, "sendMessage").mockResolvedValueOnce(msg("rm", { kind: "reminder", created_at: "2026-10-17T10:01:00Z" })).mockResolvedValueOnce(null);
    const at = new Date("2026-10-18T02:00:00Z");
    await sendReminder(qc, "w1", "r1", { body: "  Gửi báo giá ", remindAt: at, repeat: "daily" });
    expect(send).toHaveBeenCalledWith("w1", "r1", { client_msg_id: expect.any(String), reminder: { body: "Gửi báo giá", remind_at: "2026-10-18T02:00:00.000Z", repeat: "daily" } });
    await expect(sendReminder(qc, "w1", "r1", { body: "x", remindAt: at, repeat: "none" })).rejects.toThrow("chat_reminder_send_failed");
    expect(flattenRoomTimeline(qc.getQueryData<RoomTimeline>(timelineKey)!).map((m) => m.id)).toEqual(["v1", "rm"]);
  });

  it("creates, completes and removes a follow-up, refetching the list each time, and reports a refusal", async () => {
    const qc = new QueryClient();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const create = vi.spyOn(chatApi, "createFollowUp").mockResolvedValue({ id: "f1", message_id: "m1", note: "" });
    const patch = vi.spyOn(chatApi, "patchFollowUp").mockResolvedValue(null);
    const remove = vi.spyOn(chatApi, "deleteFollowUp").mockResolvedValue(true);
    await followUpCommand(qc, "w1", "create", "m1");
    await expect(followUpCommand(qc, "w1", "complete", "f1")).rejects.toThrow("chat_follow_up_failed");
    await followUpCommand(qc, "w1", "remove", "f1");
    expect(create).toHaveBeenCalledWith("w1", "m1");
    expect(patch).toHaveBeenCalledWith("w1", "f1", { completed: true });
    expect(remove).toHaveBeenCalledWith("w1", "f1");
    expect(invalidate.mock.calls.map(([f]) => f?.queryKey)).toEqual([chatKeys.followUps("w1"), chatKeys.followUps("w1")]);
  });

  it("makes a task from a message or its follow-up and refreshes the room's task cards", async () => {
    const qc = new QueryClient();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const task = { id: "t1", title: "Báo giá", identifier: "UNI-9", status: "todo" };
    const direct = vi.spyOn(chatApi, "createTaskFromMessage").mockResolvedValueOnce(task).mockResolvedValueOnce(null);
    const convert = vi.spyOn(chatApi, "convertFollowUpToTask").mockResolvedValue(task);
    expect(await createTaskFromMessage(qc, "w1", "r1", { messageId: "m1", title: "Báo giá" })).toBe(task);
    expect(await createTaskFromMessage(qc, "w1", "r1", { followUpId: "f1" })).toBe(task);
    await expect(createTaskFromMessage(qc, "w1", "r1", { messageId: "m2" })).rejects.toThrow("chat_task_create_failed");
    expect(direct).toHaveBeenCalledWith("w1", "m1", { title: "Báo giá" });
    expect(convert).toHaveBeenCalledWith("w1", "f1");
    expect(invalidate.mock.calls.map(([f]) => f?.queryKey)).toEqual([
      chatKeys.roomLinksRoot("w1", "r1"),
      chatKeys.roomLinksRoot("w1", "r1"),
      chatKeys.followUps("w1"),
      chatKeys.roomLinksRoot("w1", "r1"),
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
