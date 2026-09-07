import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/http";
import * as chat from "../api/endpoints/chat";
import {
  deliverChatTextMessage,
  flushChatSendOutbox,
  outboxEntryFromPayload,
  payloadFromOutboxEntry,
} from "./deliver-chat-text-message";
import { resetChatSendOutboxForTests, useChatSendOutboxStore } from "./send-outbox-store";
import { resetPendingChatMessagesForTests, usePendingChatMessagesStore } from "./pending-messages-store";

vi.mock("../api/endpoints/chat", () => ({
  sendChatRoomMessage: vi.fn(),
}));

describe("deliverChatTextMessage", () => {
  it("retries transient failures with the same payload", async () => {
    vi.mocked(chat.sendChatRoomMessage)
      .mockRejectedValueOnce(new ApiError("down", "internal", 503))
      .mockResolvedValueOnce(null);

    vi.useFakeTimers();
    const payload = {
      roomId: "room1",
      body: "hello",
      client_msg_id: "cmid-1",
    };
    const promise = deliverChatTextMessage("ws1", payload);
    await vi.advanceTimersByTimeAsync(500);
    await expect(promise).resolves.toBeNull();
    expect(chat.sendChatRoomMessage).toHaveBeenCalledTimes(2);
    expect(chat.sendChatRoomMessage).toHaveBeenNthCalledWith(1, "ws1", "room1", payload);
    expect(chat.sendChatRoomMessage).toHaveBeenNthCalledWith(2, "ws1", "room1", payload);
    vi.useRealTimers();
  });
});

describe("outboxEntryFromPayload", () => {
  it("maps payload fields into an outbox entry", () => {
    const entry = outboxEntryFromPayload("ws1", {
      roomId: "room1",
      body: "hi",
      client_msg_id: "cmid-1",
      reply_to_message_id: "m0",
      priority: "urgent",
    });
    expect(entry).toMatchObject({
      workspaceId: "ws1",
      roomId: "room1",
      body: "hi",
      client_msg_id: "cmid-1",
      reply_to_message_id: "m0",
      priority: "urgent",
    });
    expect(typeof entry.queued_at).toBe("string");
  });

  it("round-trips through payloadFromOutboxEntry", () => {
    const entry = outboxEntryFromPayload("ws1", {
      roomId: "room1",
      body: "hi",
      client_msg_id: "cmid-1",
    });
    expect(payloadFromOutboxEntry(entry)).toEqual({
      roomId: "room1",
      body: "hi",
      client_msg_id: "cmid-1",
      reply_to_message_id: undefined,
      priority: undefined,
    });
  });
});

describe("flushChatSendOutbox", () => {
  it("removes entries after successful delivery", async () => {
    resetChatSendOutboxForTests();
    useChatSendOutboxStore.getState().enqueue({
      workspaceId: "ws1",
      roomId: "room1",
      body: "queued",
      client_msg_id: "cmid-queued",
      queued_at: "2026-09-05T00:00:00Z",
    });

    const deliver = vi.fn().mockResolvedValue({ id: "m1" });
    const result = await flushChatSendOutbox("ws1", "u1", deliver);
    expect(result).toEqual({ sent: 1, failed: 0 });
    expect(useChatSendOutboxStore.getState().listForWorkspace("ws1")).toEqual([]);
  });

  it("counts failed deliveries and clears the pending indicator", async () => {
    resetChatSendOutboxForTests();
    resetPendingChatMessagesForTests();
    useChatSendOutboxStore.getState().enqueue({
      workspaceId: "ws1",
      roomId: "room1",
      body: "queued",
      client_msg_id: "cmid-fail",
      queued_at: "2026-09-05T00:00:00Z",
    });

    const deliver = vi.fn().mockRejectedValue(new Error("down"));
    const result = await flushChatSendOutbox("ws1", "u1", deliver);
    expect(result).toEqual({ sent: 0, failed: 1 });
    expect(useChatSendOutboxStore.getState().listForWorkspace("ws1")).toHaveLength(1);
    expect(usePendingChatMessagesStore.getState().listForRoom("ws1", "room1")).toEqual([]);
  });
});
