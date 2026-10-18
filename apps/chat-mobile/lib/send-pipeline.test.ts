// Parity: the cases of packages/core/chat/merge-optimistic-chat-messages.test.ts
// and send-retry.test.ts, on the phone's single pending-send list (a web
// pending entry and a web outbox entry are both a PendingSend here).
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CHAT_SEND_MAX_ATTEMPTS,
  isPermanentChatSendRefusal,
  isRetriableChatSendError,
  mergeOptimisticChatMessages,
  pendingToOptimisticChatMessage,
  runWithChatSendRetry,
  shouldHideOptimisticMessage,
  type PendingSend,
} from "./send-pipeline";

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

/** The shape data/api.ts throws. */
const apiError = (status: number, retryAfterSeconds?: number) =>
  Object.assign(new Error(`status ${status}`), { status, retryAfterSeconds });

afterEach(() => {
  vi.useRealTimers();
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
    expect(shouldHideOptimisticMessage(optimistic, [{ id: "m", sender: "u2", body: "", ts: 0, clientMsgId: "cmid-x" }], "u1")).toBe(false);
  });

  it("keeps a queued entry's thread root and reply target", () => {
    const optimistic = pendingToOptimisticChatMessage(entry("cmid-thread", { threadRootId: "root1", replyToMessageId: "m0" }));
    expect(optimistic.threadRootId).toBe("root1");
    expect(optimistic.replyToEventId).toBe("m0");
  });
});

describe("isRetriableChatSendError", () => {
  it("treats a network TypeError and the client's own timeout as retriable", () => {
    expect(isRetriableChatSendError(new TypeError("Network request failed"))).toBe(true);
    expect(isRetriableChatSendError(apiError(0))).toBe(true);
  });

  it("treats 5xx, 408 and 429 as retriable", () => {
    expect(isRetriableChatSendError(apiError(502))).toBe(true);
    expect(isRetriableChatSendError(apiError(408))).toBe(true);
    expect(isRetriableChatSendError(apiError(429))).toBe(true);
  });

  it("does not retry validation, auth or unknown failures", () => {
    expect(isRetriableChatSendError(apiError(400))).toBe(false);
    expect(isRetriableChatSendError(apiError(403))).toBe(false);
    expect(isRetriableChatSendError(new Error("boom"))).toBe(false);
    expect(isRetriableChatSendError({ status: "500" })).toBe(false);
    expect(isRetriableChatSendError(null)).toBe(false);
  });
});

describe("isPermanentChatSendRefusal", () => {
  it("is a 4xx other than 401, 408 and 429", () => {
    expect(isPermanentChatSendRefusal(apiError(403))).toBe(true);
    expect(isPermanentChatSendRefusal(apiError(422))).toBe(true);
    expect(isPermanentChatSendRefusal(apiError(401))).toBe(false);
    expect(isPermanentChatSendRefusal(apiError(429))).toBe(false);
    expect(isPermanentChatSendRefusal(apiError(500))).toBe(false);
    expect(isPermanentChatSendRefusal(new TypeError("offline"))).toBe(false);
  });
});

describe("runWithChatSendRetry", () => {
  it("retries retriable failures then succeeds", async () => {
    vi.useFakeTimers();
    const fn = vi.fn().mockRejectedValueOnce(apiError(503)).mockResolvedValueOnce("ok");
    const promise = runWithChatSendRetry(fn, { maxAttempts: 2, delaysMs: [100] });
    await vi.advanceTimersByTimeAsync(100);
    await expect(promise).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("waits at least as long as the server's Retry-After", async () => {
    vi.useFakeTimers();
    const fn = vi.fn().mockRejectedValueOnce(apiError(429, 2)).mockResolvedValueOnce("ok");
    const promise = runWithChatSendRetry(fn, { maxAttempts: 2, delaysMs: [100] });
    await vi.advanceTimersByTimeAsync(1_999);
    expect(fn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(promise).resolves.toBe("ok");
  });

  it("hands back a Retry-After longer than a send should hang", async () => {
    const err = apiError(429, 60);
    const fn = vi.fn().mockRejectedValue(err);
    await expect(runWithChatSendRetry(fn, { maxAttempts: 3, delaysMs: [10] })).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("does not repeat a refusal", async () => {
    const err = apiError(403);
    const fn = vi.fn().mockRejectedValue(err);
    await expect(runWithChatSendRetry(fn)).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("stops after max attempts, with the default delays", async () => {
    vi.useFakeTimers();
    const err = apiError(503);
    const fn = vi.fn().mockRejectedValue(err);
    const caught = runWithChatSendRetry(fn).catch((error: unknown) => error);
    await vi.runAllTimersAsync();
    expect(await caught).toBe(err);
    expect(fn).toHaveBeenCalledTimes(CHAT_SEND_MAX_ATTEMPTS);
  });

  it("falls back to 400 ms when given no delays", async () => {
    vi.useFakeTimers();
    const fn = vi.fn().mockRejectedValueOnce(apiError(503)).mockResolvedValueOnce("ok");
    const promise = runWithChatSendRetry(fn, { maxAttempts: 2, delaysMs: [] });
    await vi.advanceTimersByTimeAsync(399);
    expect(fn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(promise).resolves.toBe("ok");
  });
});
