import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/http";
import * as chat from "../api/endpoints/chat";
import {
  deliverChatOutboxEntry,
  deliverChatTextMessage,
  flushChatSendOutbox,
  outboxEntryFromPayload,
  payloadFromOutboxEntry,
} from "./deliver-chat-text-message";
import {
  CHAT_SEND_OUTBOX_TTL_MS,
  resetChatSendOutboxForTests,
  useChatSendOutboxStore,
} from "./send-outbox-store";
import { resetPendingChatMessagesForTests, usePendingChatMessagesStore } from "./pending-messages-store";

vi.mock("../api/endpoints/chat", () => ({
  sendChatRoomMessage: vi.fn(),
  sendChatThreadMessage: vi.fn(),
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

// H7: a queued thread reply lost its root and was posted to the channel.
describe("thread replies in the outbox", () => {
  it("keeps the thread root through the outbox and delivers to the thread", async () => {
    vi.mocked(chat.sendChatThreadMessage).mockResolvedValueOnce(null);
    const entry = outboxEntryFromPayload("ws1", "u1", {
      roomId: "room1",
      body: "in thread",
      client_msg_id: "cmid-t",
      thread_root_id: "root1",
    });
    expect(entry.thread_root_id).toBe("root1");

    await deliverChatTextMessage("ws1", payloadFromOutboxEntry(entry));

    expect(chat.sendChatThreadMessage).toHaveBeenCalledWith("ws1", "room1", "root1", {
      body: "in thread",
      client_msg_id: "cmid-t",
      priority: undefined,
    });
    expect(chat.sendChatRoomMessage).not.toHaveBeenCalledWith("ws1", "room1", expect.objectContaining({ body: "in thread" }));
  });
});

describe("outboxEntryFromPayload", () => {
  it("maps payload fields into an outbox entry", () => {
    const entry = outboxEntryFromPayload("ws1", "u1", {
      roomId: "room1",
      body: "hi",
      client_msg_id: "cmid-1",
      reply_to_message_id: "m0",
      priority: "urgent",
    });
    expect(entry).toMatchObject({
      workspaceId: "ws1",
      senderId: "u1",
      roomId: "room1",
      body: "hi",
      client_msg_id: "cmid-1",
      reply_to_message_id: "m0",
      priority: "urgent",
    });
    expect(typeof entry.queued_at).toBe("string");
  });

  it("marks an entry failed from the start when the send reached the server and failed", () => {
    const payload = { roomId: "room1", body: "hi", client_msg_id: "cmid-1" };
    expect(outboxEntryFromPayload("ws1", "u1", payload).failed_at).toBeUndefined();
    expect(outboxEntryFromPayload("ws1", "u1", payload, { failed: true }).failed_at).toEqual(expect.any(String));
  });

  it("round-trips through payloadFromOutboxEntry", () => {
    const entry = outboxEntryFromPayload("ws1", "u1", {
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
      senderId: "u1",
      client_msg_id: "cmid-queued",
      queued_at: new Date().toISOString(),
    });

    const deliver = vi.fn().mockResolvedValue({ id: "m1" });
    const result = await flushChatSendOutbox("ws1", "u1", deliver);
    expect(result).toEqual({ sent: 1, failed: 0, dropped: 0 });
    expect(useChatSendOutboxStore.getState().listForWorkspace("ws1", "u1")).toEqual([]);
  });

  it("counts failed deliveries and clears the pending indicator", async () => {
    resetChatSendOutboxForTests();
    resetPendingChatMessagesForTests();
    useChatSendOutboxStore.getState().enqueue({
      workspaceId: "ws1",
      roomId: "room1",
      body: "queued",
      senderId: "u1",
      client_msg_id: "cmid-fail",
      queued_at: new Date().toISOString(),
    });

    const deliver = vi.fn().mockRejectedValue(new ApiError("down", "internal", 503));
    const result = await flushChatSendOutbox("ws1", "u1", deliver);
    expect(result).toEqual({ sent: 0, failed: 1, dropped: 0 });
    const kept = useChatSendOutboxStore.getState().listForWorkspace("ws1", "u1");
    expect(kept).toHaveLength(1);
    // The server was reached: the bubble offers "Thử lại" instead of waiting for a reconnect.
    expect(kept[0]?.failed_at).toEqual(expect.any(String));
    expect(usePendingChatMessagesStore.getState().listForRoom("ws1", "room1")).toEqual([]);
  });

  it("keeps a send the network stopped queued, not failed", async () => {
    resetChatSendOutboxForTests();
    resetPendingChatMessagesForTests();
    useChatSendOutboxStore.getState().enqueue({
      ...outboxEntryFromPayload("ws1", "u1", { roomId: "room1", body: "offline", client_msg_id: "cmid-net" }, { failed: true }),
    });

    const deliver = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    const result = await flushChatSendOutbox("ws1", "u1", deliver);

    expect(result).toEqual({ sent: 0, failed: 1, dropped: 0 });
    expect(useChatSendOutboxStore.getState().listForWorkspace("ws1", "u1")[0]?.failed_at).toBeUndefined();
  });

  it("drops an entry the server refuses for good and counts it", async () => {
    resetChatSendOutboxForTests();
    resetPendingChatMessagesForTests();
    useChatSendOutboxStore.getState().enqueue({
      workspaceId: "ws1",
      senderId: "u1",
      roomId: "room1",
      body: "removed from room",
      client_msg_id: "cmid-403",
      queued_at: new Date().toISOString(),
    });

    const deliver = vi.fn().mockRejectedValue(new ApiError("forbidden", "forbidden", 403));
    const result = await flushChatSendOutbox("ws1", "u1", deliver);

    expect(result).toEqual({ sent: 0, failed: 0, dropped: 1 });
    expect(useChatSendOutboxStore.getState().listForWorkspace("ws1", "u1")).toEqual([]);
    expect(usePendingChatMessagesStore.getState().listForRoom("ws1", "room1")).toEqual([]);
  });

  it("keeps an entry when the session, not the message, was refused", async () => {
    resetChatSendOutboxForTests();
    resetPendingChatMessagesForTests();
    useChatSendOutboxStore.getState().enqueue({
      workspaceId: "ws1",
      senderId: "u1",
      roomId: "room1",
      body: "signed out",
      client_msg_id: "cmid-401",
      queued_at: new Date().toISOString(),
    });

    const deliver = vi.fn().mockRejectedValue(new ApiError("unauthorized", "unauthorized", 401));
    const result = await flushChatSendOutbox("ws1", "u1", deliver);

    expect(result).toEqual({ sent: 0, failed: 1, dropped: 0 });
    expect(useChatSendOutboxStore.getState().listForWorkspace("ws1", "u1")).toHaveLength(1);
  });

  it("never sends another user's queued entries", async () => {
    resetChatSendOutboxForTests();
    resetPendingChatMessagesForTests();
    const { enqueue } = useChatSendOutboxStore.getState();
    enqueue({
      workspaceId: "ws1",
      senderId: "u-a",
      roomId: "room1",
      body: "from A",
      client_msg_id: "cmid-a",
      queued_at: new Date().toISOString(),
    });

    const deliver = vi.fn().mockResolvedValue({ id: "m1" });
    const result = await flushChatSendOutbox("ws1", "u-b", deliver);

    expect(result).toEqual({ sent: 0, failed: 0, dropped: 0 });
    expect(deliver).not.toHaveBeenCalled();
    expect(usePendingChatMessagesStore.getState().listForRoom("ws1", "room1")).toEqual([]);
    expect(useChatSendOutboxStore.getState().listForWorkspace("ws1", "u-a")).toHaveLength(1);
  });

  it("drops entries older than the TTL instead of sending them", async () => {
    resetChatSendOutboxForTests();
    resetPendingChatMessagesForTests();
    useChatSendOutboxStore.getState().enqueue({
      workspaceId: "ws1",
      senderId: "u1",
      roomId: "room1",
      body: "yesterday",
      client_msg_id: "cmid-stale",
      queued_at: new Date(Date.now() - CHAT_SEND_OUTBOX_TTL_MS - 60_000).toISOString(),
    });

    const deliver = vi.fn().mockResolvedValue({ id: "m1" });
    const result = await flushChatSendOutbox("ws1", "u1", deliver);

    expect(result).toEqual({ sent: 0, failed: 0, dropped: 0 });
    expect(deliver).not.toHaveBeenCalled();
    expect(useChatSendOutboxStore.getState().entries).toEqual([]);
  });
});

describe("deliverChatOutboxEntry", () => {
  it("leaves an entry alone while it is already on its way", async () => {
    resetChatSendOutboxForTests();
    resetPendingChatMessagesForTests();
    const entry = outboxEntryFromPayload("ws1", "u1", { roomId: "room1", body: "hi", client_msg_id: "cmid-busy" });
    useChatSendOutboxStore.getState().enqueue(entry);
    usePendingChatMessagesStore.getState().upsert({
      workspaceId: "ws1",
      roomId: "room1",
      client_msg_id: "cmid-busy",
      body: "hi",
      senderId: "u1",
      createdAt: Date.now(),
      status: "sending",
    });

    const deliver = vi.fn().mockResolvedValue(null);
    await expect(deliverChatOutboxEntry(entry, deliver)).resolves.toBeNull();
    expect(deliver).not.toHaveBeenCalled();
  });

  it("hands back a permanent refusal so the caller can say why", async () => {
    resetChatSendOutboxForTests();
    resetPendingChatMessagesForTests();
    const entry = outboxEntryFromPayload("ws1", "u1", { roomId: "room1", body: "hi", client_msg_id: "cmid-gone" }, { failed: true });
    useChatSendOutboxStore.getState().enqueue(entry);
    const refusal = new ApiError("gone", "not_found", 404);

    await expect(deliverChatOutboxEntry(entry, vi.fn().mockRejectedValue(refusal))).resolves.toEqual({
      outcome: "dropped",
      error: refusal,
    });
    expect(useChatSendOutboxStore.getState().entries).toEqual([]);
  });
});
