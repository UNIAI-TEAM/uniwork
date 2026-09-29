import { describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import {
  emailHubHasReadableBody,
  flushEmailHubListRefresh,
  invalidateEmailHubReadingCachesForAccount,
  invalidateEmailHubThreadsForAccount,
  setEmailHubListRefreshPaused,
} from "./hooks";

describe("emailHubHasReadableBody", () => {
  it("treats body_cached short sent mail as readable even when body_text equals snippet", () => {
    expect(
      emailHubHasReadableBody({
        snippet: "hehe",
        body_text: "hehe",
        body_cached: true,
      }),
    ).toBe(true);
  });

  it("still rejects inbox snippet placeholders without body_cached", () => {
    expect(
      emailHubHasReadableBody({
        snippet: "Hello team",
        body_text: "Hello team",
        body_cached: false,
      }),
    ).toBe(false);
  });
});

describe("invalidateEmailHubReadingCachesForAccount", () => {
  it("invalidates conversation and thread detail keys for the account", () => {
    const qc = new QueryClient();
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
    invalidateEmailHubReadingCachesForAccount(qc, "ws1", "acc1");
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        predicate: expect.any(Function) as (q: unknown) => boolean,
        refetchType: "active",
      }),
    );
    const options = invalidateSpy.mock.calls[0]?.[0];
    expect(options?.predicate).toEqual(expect.any(Function));
    const predicate = options!.predicate as (q: { queryKey: readonly unknown[] }) => boolean;
    expect(
      predicate({ queryKey: ["email-hub", "ws1", "conversation", "acc1", "th1"] }),
    ).toBe(true);
    expect(
      predicate({ queryKey: ["email-hub", "ws1", "thread", "acc1", "th1", "detail"] }),
    ).toBe(true);
    expect(predicate({ queryKey: ["email-hub", "ws1", "threads", "acc1"] })).toBe(false);
  });
});

describe("email hub list refresh defer", () => {
  it("queues invalidation while reading and flushes after", () => {
    const qc = new QueryClient();
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
    setEmailHubListRefreshPaused("ws1", "acc1", true);
    invalidateEmailHubThreadsForAccount(qc, "ws1", "acc1");
    expect(invalidateSpy).not.toHaveBeenCalled();

    setEmailHubListRefreshPaused("ws1", "acc1", false);
    flushEmailHubListRefresh(qc, "ws1", "acc1");
    expect(invalidateSpy).toHaveBeenCalledTimes(1);
  });
});
