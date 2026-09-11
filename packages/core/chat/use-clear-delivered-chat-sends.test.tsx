import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import {
  resetPendingChatMessagesForTests,
  usePendingChatMessagesStore,
} from "./pending-messages-store";
import {
  resetChatSendOutboxForTests,
  useChatSendOutboxStore,
} from "./send-outbox-store";
import { useClearDeliveredChatSends } from "./use-clear-delivered-chat-sends";

const outboxEntry = (clientMsgId: string) => ({
  workspaceId: "ws1",
  roomId: "room1",
  body: "hello",
  client_msg_id: clientMsgId,
  queued_at: "2026-09-05T00:00:00Z",
});

describe("useClearDeliveredChatSends", () => {
  beforeEach(() => {
    resetChatSendOutboxForTests();
    resetPendingChatMessagesForTests();
  });

  it("drops the queued copy the room history already carries", () => {
    useChatSendOutboxStore.getState().enqueue(outboxEntry("cmid-delivered"));
    usePendingChatMessagesStore.getState().upsert({
      workspaceId: "ws1",
      roomId: "room1",
      client_msg_id: "cmid-delivered",
      body: "hello",
      senderId: "u1",
      createdAt: 1000,
      status: "sending",
    });

    renderHook(() => useClearDeliveredChatSends([{ client_msg_id: "cmid-delivered" }]));

    expect(useChatSendOutboxStore.getState().listForWorkspace("ws1")).toEqual([]);
    expect(usePendingChatMessagesStore.getState().listForRoom("ws1", "room1")).toEqual([]);
  });

  it("keeps a send the server has not acknowledged", () => {
    useChatSendOutboxStore.getState().enqueue(outboxEntry("cmid-queued"));

    renderHook(() => useClearDeliveredChatSends([{ client_msg_id: "cmid-other" }, {}]));

    expect(useChatSendOutboxStore.getState().listForWorkspace("ws1")).toHaveLength(1);
  });
});
