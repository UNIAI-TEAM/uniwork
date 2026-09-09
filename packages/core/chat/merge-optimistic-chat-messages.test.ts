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

  it("hides optimistic rows once the server echoes their client_msg_id", () => {
    const entry = {
      workspaceId: "ws1",
      roomId: "room1",
      body: "same text",
      client_msg_id: "cmid-echo",
      queued_at: "2026-09-05T08:00:00.000Z",
    };
    const optimistic = outboxToOptimisticChatMessage(entry, "u1");
    const server = [
      {
        id: "m2",
        sender: "u1",
        body: "same text",
        ts: optimistic.ts + 500,
        clientMsgId: "cmid-echo",
      },
    ];

    expect(shouldHideOptimisticMessage(optimistic, server, "u1")).toBe(true);
    const merged = mergeOptimisticChatMessages(server, [], [entry], "u1");
    expect(merged).toHaveLength(1);
    expect(merged[0]?.id).toBe("m2");
  });

  // The echo is the only signal: a machine whose clock drifts from the server,
  // or an entry older than any window, used to keep a duplicate bubble forever.
  it("hides the echo regardless of how far the timestamps drift apart", () => {
    const entry = {
      workspaceId: "ws1",
      roomId: "room1",
      body: "same text",
      client_msg_id: "cmid-drift",
      queued_at: "2026-09-05T08:00:00.000Z",
    };
    const optimistic = outboxToOptimisticChatMessage(entry, "u1");
    const server = [
      {
        id: "m3",
        sender: "u1",
        body: "same text",
        ts: optimistic.ts + 6 * 60 * 60 * 1000,
        clientMsgId: "cmid-drift",
      },
    ];

    expect(mergeOptimisticChatMessages(server, [], [entry], "u1")).toHaveLength(1);
  });

  it("keeps the optimistic row when the server carries a different send", () => {
    const entry = {
      workspaceId: "ws1",
      roomId: "room1",
      body: "same text",
      client_msg_id: "cmid-mine",
      queued_at: "2026-09-05T08:00:00.000Z",
    };
    const server = [
      {
        id: "m4",
        sender: "u1",
        body: "same text",
        ts: Date.parse(entry.queued_at) + 500,
        clientMsgId: "cmid-other",
      },
    ];

    const merged = mergeOptimisticChatMessages(server, [], [entry], "u1");
    expect(merged).toHaveLength(2);
    expect(merged.map((message) => message.id)).toContain("pending:cmid-mine");
  });
});
