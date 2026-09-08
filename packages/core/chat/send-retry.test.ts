import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/http";
import {
  CHAT_SEND_MAX_ATTEMPTS,
  isRetriableChatSendError,
  runWithChatSendRetry,
} from "./send-retry";

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
