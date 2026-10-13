import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/http";
import { useEmailHubLazyFolderSync, useEmailHubLiveSync } from "./hooks-sync";

vi.mock("../api/endpoints/email-hub", () => ({
  subscribeEmailHubInboxWatch: vi.fn(() => Promise.resolve({ subscribed: true })),
  unsubscribeEmailHubInboxWatch: vi.fn(() => Promise.resolve({ subscribed: false })),
  syncEmailHub: vi.fn(() => Promise.resolve({ synced: false })),
}));

const api = await import("../api/endpoints/email-hub");

function wrapperFor(qc: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => vi.clearAllMocks());

describe("useEmailHubLazyFolderSync", () => {
  it.each([
    ["SPAM", "SPAM"],
    ["SNOOZED", "INBOX"],
  ])("clears syncing for %s when filters skip an in-flight request", async (folder, syncedFolder) => {
    const pending = deferred<{ synced: boolean }>();
    vi.mocked(api.syncEmailHub).mockReturnValueOnce(pending.promise);
    const qc = new QueryClient();
    const { result, rerender } = renderHook(
      ({ skip }: { skip: boolean }) =>
        useEmailHubLazyFolderSync("ws1", "acc1", folder, { listFetched: true, listTotal: 1, skip }),
      { wrapper: wrapperFor(qc), initialProps: { skip: false } },
    );

    expect(result.current).toBe(true);
    expect(api.syncEmailHub).toHaveBeenCalledWith("ws1", "acc1", syncedFolder, false, false, false);

    rerender({ skip: true });
    await act(async () => {
      pending.resolve({ synced: false });
      await pending.promise;
    });

    expect(result.current).toBe(false);
  });

  it("clears syncing when a pending empty-folder force sync is no longer needed", async () => {
    const initial = deferred<{ synced: boolean }>();
    vi.mocked(api.syncEmailHub).mockReturnValueOnce(initial.promise);
    const qc = new QueryClient();
    const { result, rerender } = renderHook(
      ({ listFetched, listTotal }: { listFetched: boolean; listTotal: number }) =>
        useEmailHubLazyFolderSync("ws1", "acc1", "SENT", { listFetched, listTotal }),
      { wrapper: wrapperFor(qc), initialProps: { listFetched: false, listTotal: 0 } },
    );

    expect(result.current).toBe(true);
    await act(async () => {
      initial.resolve({ synced: false });
      await initial.promise;
    });
    await waitFor(() => expect(result.current).toBe(false));

    const forced = deferred<{ synced: boolean }>();
    vi.mocked(api.syncEmailHub).mockReturnValueOnce(forced.promise);
    rerender({ listFetched: true, listTotal: 0 });
    expect(result.current).toBe(true);
    expect(api.syncEmailHub).toHaveBeenLastCalledWith("ws1", "acc1", "SENT", true, false, false);

    rerender({ listFetched: true, listTotal: 1 });
    await act(async () => {
      forced.resolve({ synced: false });
      await forced.promise;
    });

    expect(result.current).toBe(false);
  });
});

describe("useEmailHubLiveSync", () => {
  it("keeps the server watch when the reader opens a message, and drops it on unmount", () => {
    const qc = new QueryClient();
    const { rerender, unmount } = renderHook(
      ({ reading }: { reading: boolean }) => useEmailHubLiveSync("ws1", "acc1", true, reading),
      { wrapper: wrapperFor(qc), initialProps: { reading: false } },
    );
    rerender({ reading: true });
    // The server stops the watch on DELETE, so a toggle must not send one.
    expect(api.unsubscribeEmailHubInboxWatch).not.toHaveBeenCalled();
    expect(api.subscribeEmailHubInboxWatch).toHaveBeenCalledTimes(1);

    unmount();
    expect(api.unsubscribeEmailHubInboxWatch).toHaveBeenCalledTimes(1);
  });

  it("sends neither a watch nor a pull while disabled", () => {
    const qc = new QueryClient();
    renderHook(() => useEmailHubLiveSync("ws1", "acc1", false), { wrapper: wrapperFor(qc) });
    expect(api.subscribeEmailHubInboxWatch).not.toHaveBeenCalled();
    expect(api.syncEmailHub).not.toHaveBeenCalled();
  });

  it("refetches the account list once when the mailbox needs reconnecting", async () => {
    const reauth = () => new ApiError("needs reconnect", "email_hub_reauth_required", 409);
    vi.mocked(api.subscribeEmailHubInboxWatch).mockRejectedValueOnce(reauth());
    vi.mocked(api.syncEmailHub).mockRejectedValueOnce(reauth());
    const qc = new QueryClient();
    const invalidate = vi.spyOn(qc, "invalidateQueries");

    renderHook(() => useEmailHubLiveSync("ws1", "acc1"), { wrapper: wrapperFor(qc) });

    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ["email-hub", "ws1", "accounts"] }));
    await waitFor(() => expect(api.syncEmailHub).toHaveBeenCalled());
    // Both the watch and the pull answered 409; one refetch is enough to bring needs_reconnect.
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it("does not touch the account list on an ordinary failure", async () => {
    vi.mocked(api.subscribeEmailHubInboxWatch).mockRejectedValueOnce(new Error("offline"));
    vi.mocked(api.syncEmailHub).mockRejectedValueOnce(new ApiError("boom", "internal", 500));
    const qc = new QueryClient();
    const invalidate = vi.spyOn(qc, "invalidateQueries");

    renderHook(() => useEmailHubLiveSync("ws1", "acc1"), { wrapper: wrapperFor(qc) });

    await waitFor(() => expect(api.syncEmailHub).toHaveBeenCalled());
    // Wait until both rejections have reached the hook's catch blocks, then one more task for anything they queue.
    const calls = [api.subscribeEmailHubInboxWatch, api.syncEmailHub].map((fn) => vi.mocked(fn).mock.results[0]?.value);
    expect(calls.every((call) => call instanceof Promise)).toBe(true);
    await Promise.allSettled(calls);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(invalidate).not.toHaveBeenCalled();
  });
});
