import { describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import {
  emailHubHasReadableBody,
  flushEmailHubListRefresh,
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
