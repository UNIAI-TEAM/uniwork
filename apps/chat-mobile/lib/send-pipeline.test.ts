// The phone's pending sends on a timeline: its one persisted list (a web
// pending entry and a web outbox entry are both a PendingSend here) through
// core's shared merge. When a send retries is core's, tested there
// (packages/core/chat/send-retry.test.ts).
import { shouldHideOptimisticMessage } from "@uniwork/core/chat/optimistic-merge";
import { describe, expect, it } from "vitest";
import { mergeOptimisticChatMessages, pendingToOptimisticChatMessage, type PendingSend } from "./send-pipeline";

const entry = (clientMsgId: string, extra: Partial<PendingSend> = {}): PendingSend => ({
  workspaceId: "ws1",
  roomId: "room1",
  senderId: "u1",
  clientMsgId,
  body: "same text",
  createdAt: Date.parse("2026-09-05T08:00:00.000Z"),
  status: "queued",
  ...extra,
});

describe("mergeOptimisticChatMessages", () => {
  it("appends pending messages after server history", () => {
    const server = [{ id: "m1", sender: "u1", body: "hi", ts: 1000 }];
    const merged = mergeOptimisticChatMessages(server, [entry("cmid-1", { body: "pending hello", createdAt: 2000, status: "sending" })], "u1");
    expect(merged).toHaveLength(2);
    expect(merged[1]).toMatchObject({ id: "pending:cmid-1", body: "pending hello", pending: { status: "sending" } });
  });

  it("hides optimistic rows once the server echoes their client_msg_id", () => {
    const optimistic = pendingToOptimisticChatMessage(entry("cmid-echo"));
    const server = [{ id: "m2", sender: "u1", body: "same text", ts: optimistic.ts + 500, clientMsgId: "cmid-echo" }];
    expect(shouldHideOptimisticMessage(optimistic, server, "u1")).toBe(true);
    const merged = mergeOptimisticChatMessages(server, [entry("cmid-echo")], "u1");
    expect(merged).toHaveLength(1);
    expect(merged[0]?.id).toBe("m2");
  });

  it("hides the echo regardless of how far the timestamps drift apart", () => {
    const server = [
      { id: "m3", sender: "u1", body: "same text", ts: entry("x").createdAt + 6 * 60 * 60 * 1000, clientMsgId: "cmid-drift" },
    ];
    expect(mergeOptimisticChatMessages(server, [entry("cmid-drift")], "u1")).toHaveLength(1);
  });

  it("keeps the optimistic row when the server carries a different send", () => {
    const server = [{ id: "m4", sender: "u1", body: "same text", ts: entry("x").createdAt + 500, clientMsgId: "cmid-other" }];
    const merged = mergeOptimisticChatMessages(server, [entry("cmid-mine")], "u1");
    expect(merged).toHaveLength(2);
    expect(merged.map((message) => message.id)).toContain("pending:cmid-mine");
  });

  it("never hides another sender's optimistic row", () => {
    const optimistic = pendingToOptimisticChatMessage(entry("cmid-x", { senderId: "u2" }));
    expect(shouldHideOptimisticMessage(optimistic, [{ id: "m", sender: "u2", ts: 0, clientMsgId: "cmid-x" }], "u1")).toBe(false);
  });

  it("keeps a queued entry's thread root and reply target", () => {
    const optimistic = pendingToOptimisticChatMessage(entry("cmid-thread", { threadRootId: "root1", replyToMessageId: "m0" }));
    expect(optimistic.threadRootId).toBe("root1");
    expect(optimistic.replyToEventId).toBe("m0");
  });
});
