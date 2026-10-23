import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import type { ChatMessageRecord } from "../api/endpoints/chat";
import { chatKeys } from "./chat-keys";
import { pendingChatMessageId } from "./pending-message-id";
import {
  buildOptimisticRoomMessageRecord,
  commitOptimisticRoomSend,
  insertOptimisticRoomMessageIfLoaded,
  removeOptimisticRoomMessage,
} from "./optimistic-outbound-message";
import { flattenRoomTimeline, type RoomTimeline } from "./room-timeline";

const row = (id: string, minute: number, extra: Partial<ChatMessageRecord> = {}): ChatMessageRecord => ({
  id,
  room_id: "room1",
  workspace_id: "ws1",
  sender_id: "u1",
  sender_display_name: "An",
  kind: "text",
  body: id,
  created_at: `2026-01-01T10:${String(minute).padStart(2, "0")}:00Z`,
  pinned: false,
  mentioned_user_ids: [],
  reactions: {},
  reply_count: 0,
  thread_unread: false,
  ...extra,
});

const key = chatKeys.roomMessages("ws1", "room1");

describe("optimistic outbound room messages", () => {
  it("inserts a pending row into a loaded timeline", () => {
    const qc = new QueryClient();
    qc.setQueryData<RoomTimeline>(key, { pages: [[row("m1", 1)]], pageParams: [null] });
    const optimistic = buildOptimisticRoomMessageRecord(
      "ws1",
      { roomId: "room1", body: "hi", client_msg_id: "cmid-1" },
      { id: "u1", display_name: "An" },
    );
    expect(optimistic).not.toBeNull();
    expect(insertOptimisticRoomMessageIfLoaded(qc, "ws1", "room1", optimistic!)).toBe(true);
    expect(flattenRoomTimeline(qc.getQueryData<RoomTimeline>(key)!).map((m) => m.id)).toEqual([
      "m1",
      pendingChatMessageId("cmid-1"),
    ]);
  });

  it("commits by replacing the pending id with the server row", () => {
    const qc = new QueryClient();
    const pendingId = pendingChatMessageId("cmid-1");
    qc.setQueryData<RoomTimeline>(key, {
      pages: [[row("m1", 1), row(pendingId, 2, { client_msg_id: "cmid-1", body: "hi" })]],
      pageParams: [null],
    });
    commitOptimisticRoomSend(qc, "ws1", "room1", "cmid-1", row("m2", 2, { client_msg_id: "cmid-1", body: "hi" }));
    expect(flattenRoomTimeline(qc.getQueryData<RoomTimeline>(key)!).map((m) => m.id)).toEqual(["m1", "m2"]);
  });

  it("removes a pending row on rollback", () => {
    const qc = new QueryClient();
    const pendingId = pendingChatMessageId("cmid-1");
    qc.setQueryData<RoomTimeline>(key, {
      pages: [[row("m1", 1), row(pendingId, 2, { client_msg_id: "cmid-1" })]],
      pageParams: [null],
    });
    removeOptimisticRoomMessage(qc, "ws1", "room1", "cmid-1");
    expect(flattenRoomTimeline(qc.getQueryData<RoomTimeline>(key)!).map((m) => m.id)).toEqual(["m1"]);
  });
});
