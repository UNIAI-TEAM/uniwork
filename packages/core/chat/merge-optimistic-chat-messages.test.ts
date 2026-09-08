import { describe, expect, it } from "vitest";
import {
  mergeOptimisticChatMessages,
  outboxToOptimisticChatMessage,
  shouldHideOptimisticMessage,
} from "./merge-optimistic-chat-messages";
import type { PendingChatMessage } from "./pending-messages-store";

describe("mergeOptimisticChatMessages", () => {
  it("appends pending messages after server history", () => {
    const server = [{ id: "m1", sender: "u1", body: "hi", ts: 1000 }];
    const pending: PendingChatMessage[] = [
      {
        workspaceId: "ws1",
        roomId: "room1",
        client_msg_id: "cmid-1",
        body: "pending hello",
        senderId: "u1",
        createdAt: 2000,
        status: "sending",
      },
    ];

    const merged = mergeOptimisticChatMessages(server, pending, [], "u1");
    expect(merged).toHaveLength(2);
    expect(merged[1]).toMatchObject({
      id: "pending:cmid-1",
      body: "pending hello",
      deliveryStatus: "sending",
    });
  });

  it("hides optimistic rows once the server echo arrives", () => {
    const optimistic = outboxToOptimisticChatMessage(
      {
        workspaceId: "ws1",
        roomId: "room1",
        body: "same text",
        client_msg_id: "cmid-echo",
        queued_at: "2026-09-05T08:00:00.000Z",
      },
      "u1",
    );
    const server = [{ id: "m2", sender: "u1", body: "same text", ts: optimistic.ts + 500 }];

    expect(shouldHideOptimisticMessage(optimistic, server, "u1")).toBe(true);
    const merged = mergeOptimisticChatMessages(server, [], [
      {
        workspaceId: "ws1",
        roomId: "room1",
        body: "same text",
        client_msg_id: "cmid-echo",
        queued_at: "2026-09-05T08:00:00.000Z",
      },
    ], "u1");
    expect(merged).toHaveLength(1);
    expect(merged[0]?.id).toBe("m2");
  });
});
