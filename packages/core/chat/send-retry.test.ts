import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/http";
import {
  CHAT_SEND_MAX_ATTEMPTS,
  isChatSendNetworkError,
  isChatSendRateLimited,
  isPermanentChatSendRefusal,
  isRetriableChatSendError,
  runWithChatSendRetry,
} from "./send-retry";

/**
 * The phone's ApiError (apps/chat-mobile/data/api.ts): an Error with a numeric
 * status and no `code`. The policy is shared, so it must read this one too
 * without importing either transport (ADR 0011).
 */
const phoneError = (status: number, retryAfterSeconds?: number) =>
  Object.assign(new Error(`status ${status}`), { status, retryAfterSeconds });

describe("either host's error", () => {
  it("reads the status of an error that is not the web's ApiError", () => {
    expect(isRetriableChatSendError(phoneError(503))).toBe(true);
    expect(isRetriableChatSendError(phoneError(408))).toBe(true);
    expect(isPermanentChatSendRefusal(phoneError(403))).toBe(true);
    expect(isChatSendRateLimited(phoneError(429))).toBe(true);
  });

  it("retries the phone's own timeout and unreachable server (status 0)", () => {
    expect(isRetriableChatSendError(phoneError(0))).toBe(true);
    expect(isPermanentChatSendRefusal(phoneError(0))).toBe(false);
  });

  it("ignores a status that is not a number, or one on something that is not an Error", () => {
    expect(isRetriableChatSendError(Object.assign(new Error("x"), { status: "500" }))).toBe(false);
    expect(isRetriableChatSendError({ status: 500 })).toBe(false);
    expect(isRetriableChatSendError(new Error("boom"))).toBe(false);
    expect(isRetriableChatSendError(null)).toBe(false);
    expect(isChatSendRateLimited(new TypeError("offline"))).toBe(false);
  });

  it("is a permanent refusal only for a 4xx other than 401, 408 and 429", () => {
    expect(isPermanentChatSendRefusal(new ApiError("gone", "not_found", 404))).toBe(true);
    expect(isPermanentChatSendRefusal(phoneError(422))).toBe(true);
    expect(isPermanentChatSendRefusal(phoneError(401))).toBe(false);
    expect(isPermanentChatSendRefusal(phoneError(429))).toBe(false);
    expect(isPermanentChatSendRefusal(phoneError(500))).toBe(false);
    expect(isPermanentChatSendRefusal(new TypeError("offline"))).toBe(false);
  });

  it("waits out the phone's Retry-After too", async () => {
    vi.useFakeTimers();
    const fn = vi.fn().mockRejectedValueOnce(phoneError(429, 2)).mockResolvedValueOnce("ok");
    const promise = runWithChatSendRetry(fn, { maxAttempts: 2, delaysMs: [100] });
    await vi.advanceTimersByTimeAsync(1_999);
    expect(fn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(promise).resolves.toBe("ok");
    vi.useRealTimers();
  });

  it("falls back to 400 ms when given no delays", async () => {
    vi.useFakeTimers();
    const fn = vi.fn().mockRejectedValueOnce(phoneError(503)).mockResolvedValueOnce("ok");
    const promise = runWithChatSendRetry(fn, { maxAttempts: 2, delaysMs: [] });
    await vi.advanceTimersByTimeAsync(399);
    expect(fn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(promise).resolves.toBe("ok");
    vi.useRealTimers();
  });
});

describe("isRetriableChatSendError", () => {
  it("treats network TypeError as retriable", () => {
    expect(isRetriableChatSendError(new TypeError("Failed to fetch"))).toBe(true);
  });

  it("treats 5xx and 429 as retriable", () => {
    expect(isRetriableChatSendError(new ApiError("bad gateway", "internal", 502))).toBe(true);
    expect(isRetriableChatSendError(new ApiError("rate", "rate_limited", 429))).toBe(true);
  });

  it("does not retry validation or auth failures", () => {
    expect(isRetriableChatSendError(new ApiError("bad", "invalid", 400))).toBe(false);
    expect(isRetriableChatSendError(new ApiError("forbidden", "forbidden", 403))).toBe(false);
  });
});

describe("isChatSendNetworkError", () => {
  it("is only the request that never reached the server", () => {
    expect(isChatSendNetworkError(new TypeError("Failed to fetch"))).toBe(true);
    expect(isChatSendNetworkError(new ApiError("down", "internal", 503))).toBe(false);
    expect(isChatSendNetworkError(new ApiError("rate", "rate_limited", 429))).toBe(false);
  });
});

describe("runWithChatSendRetry", () => {
  it("retries retriable failures then succeeds", async () => {
    vi.useFakeTimers();
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new ApiError("down", "internal", 503))
      .mockResolvedValueOnce("ok");

    const promise = runWithChatSendRetry(fn, { maxAttempts: 2, delaysMs: [100] });
    await vi.advanceTimersByTimeAsync(100);
    await expect(promise).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  // H7: the server's Retry-After was parsed, then ignored.
  it("waits at least as long as the server's Retry-After", async () => {
    vi.useFakeTimers();
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new ApiError("slow down", "rate_limited", 429, undefined, undefined, undefined, 2))
      .mockResolvedValueOnce("ok");

    const promise = runWithChatSendRetry(fn, { maxAttempts: 2, delaysMs: [100] });
    await vi.advanceTimersByTimeAsync(1_999);
    expect(fn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(promise).resolves.toBe("ok");
    vi.useRealTimers();
  });

  it("hands back a Retry-After longer than a send should hang", async () => {
    const err = new ApiError("slow down", "rate_limited", 429, undefined, undefined, undefined, 60);
    const fn = vi.fn().mockRejectedValue(err);
    await expect(runWithChatSendRetry(fn, { maxAttempts: 3, delaysMs: [10] })).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("stops after max attempts", async () => {
    vi.useFakeTimers();
    const err = new ApiError("down", "internal", 503);
    const fn = vi.fn().mockRejectedValue(err);

    let caught: unknown;
    const promise = runWithChatSendRetry(fn, {
      maxAttempts: CHAT_SEND_MAX_ATTEMPTS,
      delaysMs: [10, 10],
    }).catch((error: unknown) => {
      caught = error;
    });
    await vi.runAllTimersAsync();
    await promise;
    expect(caught).toBe(err);
    expect(fn).toHaveBeenCalledTimes(CHAT_SEND_MAX_ATTEMPTS);
    vi.useRealTimers();
  });
});
