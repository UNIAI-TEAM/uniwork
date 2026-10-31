import { QueryClient, QueryObserver } from "@tanstack/react-query";
import type { ChatMessageRecord, ChatRoomRecord } from "@uniwork/core/api/endpoints/chat-schemas";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./api", () => ({ api: { request: vi.fn() } }));

import { chatApi } from "./chat-api";
import {
  createGroup,
  createTaskFromMessage,
  forwardMessage,
  inviteGroupMembers,
  followUpCommand,
  joinChannel,
  leaveRoom,
  linkMessageToTask,
  markThreadRead,
  resolveDMRoom,
  setChatNickname,
  setRoomMuted,
  setRoomWallpaper,
  shareMessageAsDocument,
  togglePin,
  unlinkMessageTask,
} from "./chat-actions";
import { refreshMessageMedia } from "./chat-cache";
import { flattenRoomTimeline, type RoomTimeline } from "@uniwork/core/chat/room-timeline-pages";
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
    await expect(setRoomMuted(qc, "w1", "r1", false)).rejects.toThrow("offline");
    expect(rooms(qc)?.[0]?.notifications_muted).toBe(true);
    vi.spyOn(chatApi, "setRoomMuted").mockResolvedValue(true);
    await setRoomMuted(new QueryClient(), "w1", "r1", true);
  });

  it("puts a pin's answer in place", async () => {
    const qc = new QueryClient();
    withTimeline(qc, [msg("m1")]);
    const pin = vi.spyOn(chatApi, "togglePin").mockResolvedValue(msg("m1", { pinned: true }));
    await togglePin(qc, "w1", "r1", "m1");
    expect(pin).toHaveBeenCalledWith("w1", "r1", "m1");
    expect(flattenRoomTimeline(qc.getQueryData<RoomTimeline>(timelineKey)!)[0]?.pinned).toBe(true);
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

  it("creates a group and adds people to one, refreshing what they change; no room back is a failure", async () => {
    const qc = new QueryClient();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const create = vi.spyOn(chatApi, "createGroup").mockResolvedValueOnce(room("g1", { kind: "group" })).mockResolvedValueOnce(null);
    const invite = vi.spyOn(chatApi, "inviteGroupMembers").mockResolvedValueOnce(room("g1", { kind: "group" })).mockResolvedValueOnce(null);
    expect(await createGroup(qc, "w1", { name: "Đội", memberUserIds: ["u2", "u3"] })).toMatchObject({ id: "g1" });
    expect(create).toHaveBeenCalledWith("w1", { name: "Đội", member_user_ids: ["u2", "u3"] });
    await expect(createGroup(qc, "w1", { name: "Đội", memberUserIds: ["u2"] })).rejects.toThrow("chat_group_create_failed");
    expect(await inviteGroupMembers(qc, "w1", "g1", ["u4"])).toMatchObject({ id: "g1" });
    expect(invite).toHaveBeenCalledWith("w1", "g1", ["u4"]);
    await expect(inviteGroupMembers(qc, "w1", "g1", ["u4"])).rejects.toThrow("chat_group_invite_failed");
    expect(invalidate.mock.calls.map(([f]) => f?.queryKey)).toEqual([chatKeys.rooms("w1"), chatKeys.roomMembers("w1", "g1"), chatKeys.rooms("w1")]);
  });

  it("forwards a message; no copy made is a failure", async () => {
    const forward = vi.spyOn(chatApi, "forwardMessage").mockResolvedValueOnce(1).mockResolvedValueOnce(0);
    await forwardMessage("w1", "m1", ["r2"]);
    expect(forward).toHaveBeenCalledWith("w1", "m1", ["r2"]);
    await expect(forwardMessage("w1", "m1", ["r2"])).rejects.toThrow("chat_forward_failed");
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

  it("creates, completes and removes a follow-up, refetching the list each time, and reports a refusal", async () => {
    const qc = new QueryClient();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const create = vi.spyOn(chatApi, "createFollowUp").mockResolvedValue({ id: "f1", message_id: "m1", note: "" });
    const patch = vi.spyOn(chatApi, "patchFollowUp").mockResolvedValue(null);
    const remove = vi.spyOn(chatApi, "deleteFollowUp").mockResolvedValue(true);
    await followUpCommand(qc, "w1", "create", "m1");
    await expect(followUpCommand(qc, "w1", "complete", "f1")).rejects.toThrow("chat_follow_up_failed");
    await followUpCommand(qc, "w1", "remove", "f1");
    expect(create).toHaveBeenCalledWith("w1", "m1", { due_at: expect.any(String) });
    const due = Date.parse((create.mock.calls[0]![2] as { due_at: string }).due_at);
    expect(Math.round((due - Date.now()) / 3_600_000)).toBe(2);
    expect(patch).toHaveBeenCalledWith("w1", "f1", { completed: true });
    expect(remove).toHaveBeenCalledWith("w1", "f1");
    expect(invalidate.mock.calls.map(([f]) => f?.queryKey)).toEqual([chatKeys.followUps("w1"), chatKeys.followUps("w1")]);
  });

  it("makes a task from a message or its follow-up and refreshes the room's task cards", async () => {
    const qc = new QueryClient();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const task = { id: "t1", title: "Báo giá", identifier: "UNI-9", status: "todo", priority: "" };
    const direct = vi.spyOn(chatApi, "createTaskFromMessage").mockResolvedValueOnce(task).mockResolvedValueOnce(null);
    const convert = vi.spyOn(chatApi, "convertFollowUpToTask").mockResolvedValue(task);
    expect(
      await createTaskFromMessage(qc, "w1", "r1", {
        messageId: "m1",
        title: "Báo giá",
        description: undefined,
        due_date: "2026-11-01",
        priority: "high",
        status: "todo",
      }),
    ).toBe(task);
    expect(await createTaskFromMessage(qc, "w1", "r1", { followUpId: "f1" })).toBe(task);
    await expect(createTaskFromMessage(qc, "w1", "r1", { messageId: "m2" })).rejects.toThrow("chat_task_create_failed");
    expect(direct).toHaveBeenCalledWith("w1", "m1", { title: "Báo giá", due_date: "2026-11-01", priority: "high", status: "todo" });
    expect(convert).toHaveBeenCalledWith("w1", "f1");
    expect(invalidate.mock.calls.map(([f]) => f?.queryKey)).toEqual([
      chatKeys.roomLinksRoot("w1", "r1"),
      chatKeys.roomLinksRoot("w1", "r1"),
      chatKeys.followUps("w1"),
      chatKeys.roomLinksRoot("w1", "r1"),
    ]);
  });

  it("sets a room's wallpaper and puts the previous list back when the server refuses", async () => {
    const qc = new QueryClient();
    const permissions = {
      allow_change_profile: true,
      allow_pin_content: true,
      allow_create_notes: true,
      allow_create_polls: true,
      allow_send_messages: true,
      allow_forward: true,
    };
    const patch = vi.spyOn(chatApi, "patchRoom").mockResolvedValue(permissions);
    await setRoomWallpaper(qc, "w1", "r1", "sky");
    expect(rooms(qc)).toBeUndefined();
    qc.setQueryData(chatKeys.rooms("w1"), [room("r1"), room("r2")]);
    await setRoomWallpaper(qc, "w1", "r1", "stars");
    expect(rooms(qc)?.map((item) => item.wallpaper)).toEqual([{ preset: "stars" }, undefined]);
    patch.mockRejectedValueOnce(new TypeError("offline"));
    await expect(setRoomWallpaper(qc, "w1", "r1", "mint")).rejects.toThrow("offline");
    expect(rooms(qc)?.map((item) => item.wallpaper)).toEqual([{ preset: "stars" }, undefined]);
    expect(patch).toHaveBeenCalledWith("w1", "r1", { wallpaper: { preset: "mint" } });
  });

  it("saves a nickname and refreshes the list; a refusal throws", async () => {
    const qc = new QueryClient();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const set = vi.spyOn(chatApi, "setNickname").mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await setChatNickname(qc, "w1", "u2", "Bé");
    expect(set).toHaveBeenCalledWith("w1", "u2", "Bé");
    await expect(setChatNickname(qc, "w1", "u2", "")).rejects.toThrow("chat_nickname_failed");
    expect(invalidate.mock.calls.map(([call]) => call?.queryKey)).toEqual([chatKeys.nicknames("w1")]);
  });

  it("links a message to a task and takes the card off; a refusal throws", async () => {
    const qc = new QueryClient();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const link = { id: "l1", message_id: "m1", target_type: "task", target_id: "t1", relation: "created_from" };
    vi.spyOn(chatApi, "linkMessageToTask").mockResolvedValueOnce(link).mockResolvedValueOnce(null);
    vi.spyOn(chatApi, "deleteMessageLink").mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await linkMessageToTask(qc, "w1", "r1", "m1", "t1");
    await expect(linkMessageToTask(qc, "w1", "r1", "m1", "t1")).rejects.toThrow("chat_link_task_failed");
    await unlinkMessageTask(qc, "w1", "r1", "m1", "l1");
    await expect(unlinkMessageTask(qc, "w1", "r1", "m1", "l1")).rejects.toThrow("chat_unlink_failed");
    expect(invalidate.mock.calls.map(([call]) => call?.queryKey)).toEqual([chatKeys.roomLinksRoot("w1", "r1"), chatKeys.roomLinksRoot("w1", "r1")]);
  });

  it("shares a file as a document in the room; no message back is a failure", async () => {
    const qc = new QueryClient();
    withTimeline(qc, []);
    const shared = msg("m2", { kind: "document" });
    vi.spyOn(chatApi, "shareMessageAsDocument").mockResolvedValueOnce(shared).mockResolvedValueOnce(null);
    await shareMessageAsDocument(qc, "w1", "r1", "m1");
    expect(flattenRoomTimeline(qc.getQueryData<RoomTimeline>(timelineKey)!).map((item) => item.id)).toEqual(["m2"]);
    await expect(shareMessageAsDocument(qc, "w1", "r1", "m1")).rejects.toThrow("chat_share_document_failed");
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
