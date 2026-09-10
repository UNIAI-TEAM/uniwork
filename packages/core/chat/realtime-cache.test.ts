import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatMessageRecord, ChatRoomRecord } from "../api/endpoints/chat";
import * as chatApi from "../api/endpoints/chat";
import { chatKeys } from "./hooks";
import {
  CHAT_MESSAGE_CACHE_MAX,
  bumpThreadRootReplyCount,
  fetchAndPatchChatMessage,
  isChatThreadReply,
  mergeMessageIntoList,
  patchChatMessageDeleted,
  patchRoomSidebarFromMessage,
  removeMessageFromList,
} from "./realtime-cache";

const sampleMessage = (id: string, createdAt: string): ChatMessageRecord => ({
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
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("mergeMessageIntoList", () => {
  it("appends a new message in chronological order", () => {
    const existing = [sampleMessage("m1", "2026-01-01T10:00:00Z")];
    const added = sampleMessage("m2", "2026-01-01T10:01:00Z");
    const next = mergeMessageIntoList(existing, added);
    expect(next.map((m) => m.id)).toEqual(["m1", "m2"]);
  });

  it("replaces an existing message by id", () => {
    const existing = [sampleMessage("m1", "2026-01-01T10:00:00Z")];
    const updated = { ...existing[0]!, body: "edited" };
    const next = mergeMessageIntoList(existing, updated);
    expect(next).toHaveLength(1);
    expect(next[0]?.body).toBe("edited");
  });

  it("trims to CHAT_MESSAGE_CACHE_MAX", () => {
    const existing = Array.from({ length: CHAT_MESSAGE_CACHE_MAX }, (_, index) =>
      sampleMessage(`m${index}`, `2026-01-01T10:${String(index).padStart(2, "0")}:00Z`),
    );
    const added = sampleMessage("new", "2026-01-02T10:00:00Z");
    const next = mergeMessageIntoList(existing, added);
    expect(next).toHaveLength(CHAT_MESSAGE_CACHE_MAX);
    expect(next[next.length - 1]?.id).toBe("new");
  });
});

describe("removeMessageFromList", () => {
  it("removes a message by id", () => {
    const existing = [sampleMessage("m1", "2026-01-01T10:00:00Z"), sampleMessage("m2", "2026-01-01T10:01:00Z")];
    expect(removeMessageFromList(existing, "m1").map((m) => m.id)).toEqual(["m2"]);
  });
});

describe("patchRoomSidebarFromMessage", () => {
  it("updates preview and moves room to top", () => {
    const rooms: ChatRoomRecord[] = [
      {
        id: "room-a",
        kind: "dm",
        name: "A",
        workspace_id: "ws1",
        member_user_ids: [],
        unread_count: 0,
        mention_unread_count: 0,
        last_message_at: "2026-01-01T09:00:00Z",
      },
      {
        id: "room-b",
        kind: "dm",
        name: "B",
        workspace_id: "ws1",
        member_user_ids: [],
        unread_count: 0,
        mention_unread_count: 0,
        last_message_at: "2026-01-01T10:00:00Z",
      },
    ];
    const message = sampleMessage("m1", "2026-01-01T11:00:00Z");
    const next = patchRoomSidebarFromMessage(rooms, "room-a", message, { incrementUnread: true });
    expect(next[0]?.id).toBe("room-a");
    expect(next[0]?.last_message_body).toBe(message.body);
    expect(next[0]?.unread_count).toBe(1);
  });
});

describe("patchChatMessageDeleted", () => {
  it("removes message from room cache", () => {
    const qc = new QueryClient();
    qc.setQueryData(chatKeys.roomMessages("ws1", "room1"), [
      sampleMessage("m1", "2026-01-01T10:00:00Z"),
      sampleMessage("m2", "2026-01-01T10:01:00Z"),
    ]);
    patchChatMessageDeleted(qc, "ws1", "room1", "m1");
    expect(qc.getQueryData<ChatMessageRecord[]>(chatKeys.roomMessages("ws1", "room1"))?.map((m) => m.id)).toEqual([
      "m2",
    ]);
  });
});

describe("thread reply cache patches", () => {
  it("detects thread replies", () => {
    expect(isChatThreadReply(sampleMessage("m1", "2026-01-01T10:00:00Z"))).toBe(false);
    expect(
      isChatThreadReply({
        ...sampleMessage("m2", "2026-01-01T10:00:00Z"),
        thread_root_id: "root1",
      }),
    ).toBe(true);
  });

  it("bumps reply_count on the root", () => {
    const root = sampleMessage("root1", "2026-01-01T10:00:00Z");
    const reply = {
      ...sampleMessage("r1", "2026-01-01T10:01:00Z"),
      thread_root_id: "root1",
    };
    const next = bumpThreadRootReplyCount([root], reply);
    expect(next?.[0]?.reply_count).toBe(1);
    expect(next?.[0]?.last_reply_at).toBe(reply.created_at);
  });

  it("keeps thread replies off the main room list", async () => {
    const reply = {
      ...sampleMessage("r1", "2026-01-01T10:01:00Z"),
      thread_root_id: "root1",
      body: "in thread",
    };
    vi.spyOn(chatApi, "getChatRoomMessage").mockResolvedValue(reply);

    const qc = new QueryClient();
    qc.setQueryData(chatKeys.roomMessages("ws1", "room1"), [
      sampleMessage("root1", "2026-01-01T10:00:00Z"),
      reply,
    ]);

    await fetchAndPatchChatMessage(qc, "ws1", "room1", "r1");

    const main = qc.getQueryData<ChatMessageRecord[]>(chatKeys.roomMessages("ws1", "room1"));
    expect(main?.map((m) => m.id)).toEqual(["root1"]);
    expect(main?.[0]?.reply_count).toBe(1);
    expect(
      qc.getQueryData<ChatMessageRecord[]>(chatKeys.threadMessages("ws1", "room1", "root1"))?.map(
        (m) => m.id,
      ),
    ).toEqual(["r1"]);
  });
});
