import { createElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import {
  getEmailHubProviders,
  getEmailHubThread,
  listEmailHubThreads,
  moveEmailHubThread,
  patchEmailHubThread,
  startEmailHubOAuth,
  syncEmailHub,
} from "../api/endpoints/email-hub";
import type { EmailHubThread } from "../types/email-hub";
import {
  emailHubHasReadableBody,
  emailHubKeys,
  flushEmailHubListRefresh,
  invalidateEmailHubReadingCachesForAccount,
  invalidateEmailHubThreadsForAccount,
  prefetchEmailHubThread,
  patchEmailHubThreadInLists,
  setEmailHubListRefreshPaused,
  useEmailHubThread,
  useEmailHubProviders,
  useEmailHubThreads,
  useMarkEmailHubRead,
  useMoveEmailHubThread,
  useSnoozeEmailHubThread,
  useStartEmailHubOAuth,
  useSyncEmailHub,
} from "./hooks";
import { threadDetailKey } from "./query-cache";

vi.mock("../api/endpoints/email-hub", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/endpoints/email-hub")>()),
  getEmailHubProviders: vi.fn(() => Promise.resolve({ google: true, microsoft: false })),
  getEmailHubThread: vi.fn(() => Promise.resolve(null)),
  listEmailHubThreads: vi.fn(() =>
    Promise.resolve({ threads: [], counts: { total: 0, unread: 0 }, next_cursor: "" }),
  ),
  moveEmailHubThread: vi.fn(() => Promise.resolve()),
  patchEmailHubThread: vi.fn(() =>
    Promise.resolve({
      id: "th1",
      account_id: "acc1",
      folder: "INBOX",
      subject: "Subject",
      snippet: "Snippet",
      from_addr: "sender@example.com",
      to_addrs: ["reader@example.com"],
      sent_at: "2026-10-12T00:00:00Z",
      is_read: true,
      is_starred: false,
      has_attachments: false,
      body_cached: false,
      imap_labels: [],
    }),
  ),
  startEmailHubOAuth: vi.fn(() => Promise.resolve("https://accounts.google.com/o/oauth2/auth?state=s1")),
  syncEmailHub: vi.fn(() => Promise.resolve({ synced: true })),
}));

function wrapperFor(qc: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: qc }, children);
  };
}

function expectCountInvalidations(invalidateSpy: ReturnType<typeof vi.spyOn>) {
  expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: emailHubKeys.unread("ws1") });
  expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: emailHubKeys.sidebarCounts("ws1", "acc1") });
}

beforeEach(() => {
  vi.mocked(getEmailHubThread).mockClear();
});

function emailThread(id: string, isRead: boolean): EmailHubThread {
  return {
    id,
    account_id: "acc1",
    folder: "INBOX",
    subject: `Subject ${id}`,
    snippet: `Snippet ${id}`,
    from_addr: "sender@example.com",
    to_addrs: ["recipient@example.com"],
    sent_at: "2026-10-12T00:00:00Z",
    is_read: isRead,
    is_starred: false,
    has_attachments: false,
    body_cached: false,
    imap_labels: [],
  };
}

function seedTwoPageThreadList(qc: QueryClient, secondPageThread: EmailHubThread) {
  const key = emailHubKeys.threads("ws1", "acc1", "INBOX", {});
  qc.setQueryData(key, {
    pages: [
      {
        threads: [emailThread("thread-page-1", true)],
        counts: { total: 120, unread: 30 },
        next_cursor: "page-2",
      },
      {
        threads: [secondPageThread],
        counts: { total: 0, unread: 0 },
      },
    ],
    pageParams: [undefined, "page-2"],
  });
  return key;
}

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

describe("email hub mutation count invalidation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses one canonical sidebar counts key", () => {
    const key = emailHubKeys.sidebarCounts("ws1", "acc1");
    expect(key).toHaveLength(4);
    expect(key[0]).toBe("email-hub");
    expect(key[1]).toBe("ws1");
    expect(key[2]).toBe("sidebar-counts");
    expect(key[3]).toBe("acc1");
  });

  it("invalidates unread and sidebar counts after moving a thread", async () => {
    const qc = new QueryClient();
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useMoveEmailHubThread("ws1"), { wrapper: wrapperFor(qc) });

    await act(() => result.current.mutateAsync({ accountId: "acc1", threadId: "th1", moveTo: "ARCHIVE" }));

    expect(moveEmailHubThread).toHaveBeenCalledWith("ws1", "th1", "acc1", "ARCHIVE");
    expectCountInvalidations(invalidateSpy);
  });

  it("invalidates unread and sidebar counts after snoozing a thread", async () => {
    const qc = new QueryClient();
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useSnoozeEmailHubThread("ws1"), { wrapper: wrapperFor(qc) });

    await act(() =>
      result.current.mutateAsync({
        accountId: "acc1",
        threadId: "th1",
        snoozeUntil: "2026-10-13T00:00:00Z",
      }),
    );

    expect(patchEmailHubThread).toHaveBeenCalledWith("ws1", "th1", {
      accountId: "acc1",
      snoozeUntil: "2026-10-13T00:00:00Z",
      clearSnooze: undefined,
    });
    expectCountInvalidations(invalidateSpy);
  });

  it("invalidates unread and sidebar counts after marking a thread read", async () => {
    const qc = new QueryClient();
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useMarkEmailHubRead("ws1"), { wrapper: wrapperFor(qc) });

    await act(() => result.current.mutateAsync({ accountId: "acc1", threadId: "th1", isRead: true }));

    expect(patchEmailHubThread).toHaveBeenCalledWith("ws1", "th1", {
      accountId: "acc1",
      isRead: true,
    });
    expectCountInvalidations(invalidateSpy);
  });

  it("invalidates unread and sidebar counts after a successful sync", async () => {
    const qc = new QueryClient();
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useSyncEmailHub("ws1"), { wrapper: wrapperFor(qc) });

    await act(() => result.current.mutateAsync({ accountId: "acc1", folder: "INBOX" }));

    expect(syncEmailHub).toHaveBeenCalledWith("ws1", "acc1", "INBOX", undefined, false, undefined);
    expectCountInvalidations(invalidateSpy);
  });
});

describe("patchEmailHubThreadInLists", () => {
  it("decreases the first page unread count when a second page thread becomes read", () => {
    const qc = new QueryClient();
    const key = seedTwoPageThreadList(qc, emailThread("thread-page-2", false));

    patchEmailHubThreadInLists(qc, "ws1", "acc1", "thread-page-2", { is_read: true });

    const cached = qc.getQueryData<{
      pages: Array<{ threads: EmailHubThread[]; counts: { total: number; unread: number } }>;
    }>(key);
    expect(cached?.pages[0]?.counts).toEqual({ total: 120, unread: 29 });
    expect(cached?.pages[1]?.counts).toEqual({ total: 0, unread: 0 });
    expect(cached?.pages[1]?.threads[0]?.is_read).toBe(true);
  });

  it("increases the first page unread count when a thread becomes unread", () => {
    const qc = new QueryClient();
    const key = seedTwoPageThreadList(qc, emailThread("thread-page-2", true));

    patchEmailHubThreadInLists(qc, "ws1", "acc1", "thread-page-2", { is_read: false });

    const cached = qc.getQueryData<{
      pages: Array<{ threads: EmailHubThread[]; counts: { total: number; unread: number } }>;
    }>(key);
    expect(cached?.pages[0]?.counts).toEqual({ total: 120, unread: 31 });
    expect(cached?.pages[1]?.counts).toEqual({ total: 0, unread: 0 });
    expect(cached?.pages[1]?.threads[0]?.is_read).toBe(false);
  });

  it("changes the unread count only once when the same read patch is repeated", () => {
    const qc = new QueryClient();
    const key = seedTwoPageThreadList(qc, emailThread("thread-page-2", false));

    patchEmailHubThreadInLists(qc, "ws1", "acc1", "thread-page-2", { is_read: true });
    patchEmailHubThreadInLists(qc, "ws1", "acc1", "thread-page-2", { is_read: true });

    const cached = qc.getQueryData<{
      pages: Array<{ counts: { total: number; unread: number } }>;
    }>(key);
    expect(cached?.pages[0]?.counts).toEqual({ total: 120, unread: 29 });
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

  it("does not refetch on mount when prefetch already hydrated the body", async () => {
    vi.mocked(getEmailHubThread).mockResolvedValue({
      id: "th1",
      body_text: "Full message body",
      body_cached: true,
      snippet: "snippet",
    } as never);
    const qc = new QueryClient();
    prefetchEmailHubThread(qc, "ws1", "acc1", "th1");
    await waitFor(() =>
      expect(qc.getQueryState(threadDetailKey("ws1", "acc1", "th1"))?.status).toBe("success"),
    );
    vi.mocked(getEmailHubThread).mockClear();

    const { result } = renderHook(() => useEmailHubThread("ws1", "acc1", "th1"), {
      wrapper: wrapperFor(qc),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(getEmailHubThread).not.toHaveBeenCalled();
    expect(emailHubHasReadableBody(result.current.data)).toBe(true);
  });
});

describe("email hub thread hooks", () => {
  it("passes React Query's abort signal to the thread-list endpoint", async () => {
    const qc = new QueryClient();
    const { result } = renderHook(() => useEmailHubThreads("ws1", "acc1"), {
      wrapper: wrapperFor(qc),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const signal = vi.mocked(listEmailHubThreads).mock.calls[0]?.[6];
    expect(signal).toBeInstanceOf(AbortSignal);
  });
});
