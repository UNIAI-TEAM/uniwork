import { describe, expect, it } from "vitest";
import type { ChatMessageRecord, ChatRoomRecord } from "../api/endpoints/chat-schemas";
import {
  bumpThreadRootReplyCount,
  patchRoomSidebarFromMessage,
  placeThreadReply,
  removeMessageFromList,
  replaceMessageInList,
  shouldIncrementUnreadLocally,
} from "./chat-cache-records";
import type { RoomTimeline } from "./room-timeline-pages";

// The record transforms both clients apply frames through (the web's
// realtime-cache.ts, the phone's data/chat-cache.ts); the query-cache wiring
// around them is tested beside each.
const message = (id: string, createdAt: string, extra: Partial<ChatMessageRecord> = {}): ChatMessageRecord => ({
  id,
  room_id: "room1",
  workspace_id: "ws1",
  sender_id: "u2",
  sender_display_name: "Bob",
  kind: "text",
  body: `hello ${id}`,
  created_at: createdAt,
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
  workspace_id: "ws1",
  member_user_ids: [],
  member_count: 0,
  unread_count: 0,
  mention_unread_count: 0,
  ...extra,
});

const timeline = (rows: ChatMessageRecord[]): RoomTimeline => ({ pages: [rows], pageParams: [null] });

describe("chat-cache-records", () => {
  it("reads a missing list as empty and sorts rooms without a message last", () => {
    expect(patchRoomSidebarFromMessage(undefined, "room1", message("m1", "2026-01-01T10:00:00Z"))).toEqual([]);
    expect(removeMessageFromList(undefined, "m1")).toEqual([]);
    const next = patchRoomSidebarFromMessage([room("quiet"), room("room1"), room("quiet2")], "room1", message("m1", "2026-01-01T10:00:00Z"));
    expect(next.map((r) => r.id)).toEqual(["room1", "quiet", "quiet2"]);
  });

  it("counts a mention on the room line when asked", () => {
    const [line] = patchRoomSidebarFromMessage([room("room1")], "room1", message("m1", "2026-01-01T10:00:00Z"), {
      incrementUnread: true,
      incrementMentionUnread: true,
    });
    expect(line).toEqual(expect.objectContaining({ unread_count: 1, mention_unread_count: 1, last_message_kind: "text" }));
  });

  it("bumps only the root of the reply, and leaves a list without the root alone", () => {
    const other = message("m0", "2026-01-01T09:00:00Z");
    const reply = message("r1", "2026-01-01T10:00:00Z", { thread_root_id: "root1" });
    expect(bumpThreadRootReplyCount([other], reply)[0]).toBe(other);
    expect(bumpThreadRootReplyCount(undefined, reply)).toBeUndefined();
    const orphan = message("r2", "2026-01-01T10:00:00Z");
    const list = [other];
    expect(bumpThreadRootReplyCount(list, orphan)).toBe(list);
  });

  it("replaces a message in a flat list in place and never inserts one", () => {
    const list = [message("m1", "2026-01-01T10:00:00Z")];
    const edited = message("m1", "2026-01-01T10:00:00Z", { body: "đã sửa" });
    expect(replaceMessageInList(list, edited)).toEqual([edited]);
    expect(replaceMessageInList(list, message("m9", "2026-01-01T11:00:00Z"))).toBe(list);
  });

  it("places a reply in a loaded thread: replaced when there, appended when newer, refetched when older", () => {
    const root = message("root1", "2026-01-01T09:00:00Z");
    const first = message("r1", "2026-01-01T10:00:00Z", { thread_root_id: "root1" });
    const data = timeline([root, first]);
    const edited = { ...first, body: "đã sửa" };
    expect(placeThreadReply(data, edited)?.pages[0]).toEqual([root, edited]);
    const later = message("r2", "2026-01-01T11:00:00Z", { thread_root_id: "root1" });
    expect(placeThreadReply(data, later)?.pages[0]?.map((m) => m.id)).toEqual(["root1", "r1", "r2"]);
    expect(placeThreadReply(data, message("r0", "2026-01-01T09:30:00Z", { thread_root_id: "root1" }))).toBeNull();
  });

  it("counts unread locally only in the default channel, which sends no room activity", () => {
    expect(shouldIncrementUnreadLocally(room("w", { kind: "workspace" }))).toBe(true);
    expect(shouldIncrementUnreadLocally(room("c", { kind: "channel", is_default: true }))).toBe(true);
    expect(shouldIncrementUnreadLocally(room("d"))).toBe(false);
    expect(shouldIncrementUnreadLocally(undefined)).toBe(false);
  });
});
