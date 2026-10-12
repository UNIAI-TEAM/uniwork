import { createElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import {
  getEmailHubProviders,
  getEmailHubThread,
  startEmailHubOAuth,
} from "../api/endpoints/email-hub";
import {
  emailHubHasReadableBody,
  emailHubKeys,
  flushEmailHubListRefresh,
  invalidateEmailHubReadingCachesForAccount,
  invalidateEmailHubThreadsForAccount,
  prefetchEmailHubThread,
  setEmailHubListRefreshPaused,
  useEmailHubThread,
  useEmailHubProviders,
  useStartEmailHubOAuth,
} from "./hooks";
import { threadDetailKey } from "./query-cache";

// Only transport calls exercised by these hook tests are faked; cache-helper cases never reach transport.
vi.mock("../api/endpoints/email-hub", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/endpoints/email-hub")>()),
  getEmailHubProviders: vi.fn(() => Promise.resolve({ google: true, microsoft: false })),
  getEmailHubThread: vi.fn(() => Promise.resolve(null)),
  startEmailHubOAuth: vi.fn(() => Promise.resolve("https://accounts.google.com/o/oauth2/auth?state=s1")),
}));

function wrapperFor(qc: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: qc }, children);
  };
}

beforeEach(() => {
  vi.mocked(getEmailHubThread).mockClear();
});

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

describe("email hub OAuth hooks", () => {
  it("useEmailHubProviders caches under emailHubKeys.providers(wsId)", async () => {
    const qc = new QueryClient();
    const { result } = renderHook(() => useEmailHubProviders("ws1"), { wrapper: wrapperFor(qc) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(getEmailHubProviders).toHaveBeenCalledWith("ws1");
    expect(emailHubKeys.providers("ws1")).toEqual(["email-hub", "ws1", "providers"]);
    expect(qc.getQueryData(emailHubKeys.providers("ws1"))).toEqual({ google: true, microsoft: false });
  });

  it("useStartEmailHubOAuth resolves the authorization URL for the provider and hint", async () => {
    const qc = new QueryClient();
    const { result } = renderHook(() => useStartEmailHubOAuth("ws1"), { wrapper: wrapperFor(qc) });
    await expect(result.current.mutateAsync({ provider: "google", loginHint: "an@gmail.com" })).resolves.toBe(
      "https://accounts.google.com/o/oauth2/auth?state=s1",
    );
    expect(startEmailHubOAuth).toHaveBeenCalledWith("ws1", "google", "an@gmail.com");
  });
});

describe("email hub thread detail cache", () => {
  it("reuses a resolved prefetch for the same thread for 30 seconds", async () => {
    const qc = new QueryClient();

    prefetchEmailHubThread(qc, "ws1", "acc1", "th1");
    await waitFor(() =>
      expect(qc.getQueryState(threadDetailKey("ws1", "acc1", "th1"))?.status).toBe("success"),
    );

    prefetchEmailHubThread(qc, "ws1", "acc1", "th1");
    await waitFor(() => expect(qc.isFetching()).toBe(0));

    expect(getEmailHubThread).toHaveBeenCalledTimes(1);
    expect(getEmailHubThread).toHaveBeenCalledWith(
      "ws1",
      "acc1",
      "th1",
      true,
      false,
      expect.any(AbortSignal),
    );
  });

  it("still marks the thread read when the detail hook is opened", async () => {
    const qc = new QueryClient();

    const { result } = renderHook(() => useEmailHubThread("ws1", "acc1", "th1"), {
      wrapper: wrapperFor(qc),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(getEmailHubThread).toHaveBeenCalledTimes(1);
    expect(getEmailHubThread).toHaveBeenCalledWith(
      "ws1",
      "acc1",
      "th1",
      true,
      true,
      expect.any(AbortSignal),
    );
  });
});
