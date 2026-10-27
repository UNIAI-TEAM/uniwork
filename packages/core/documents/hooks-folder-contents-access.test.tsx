import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setAccessToken } from "../api/session";
import { configureRuntime, resetRuntimeConfig } from "../runtime-config";
import {
  backgroundAccepted,
  batchCompleted,
  batchFailed,
  batchRunning,
  dryRunReplace,
  errorBatchRunning,
  syncResult,
} from "./folder-contents-access.fixtures";
import {
  folderContentsAccessKeys,
  useApplyFolderContentsAccess,
  useFolderContentsAccessBatch,
  usePreviewFolderContentsAccess,
} from "./hooks-folder-contents-access";
import { documentKeys } from "./keys";
import { parseFolderAccessBatchRunning } from "../api/endpoints/documents-folder-contents-access";

// UNI-2244: preview (dry run), apply, and the background batch poll. The
// transport is stubbed at fetch, as the sibling hooks tests do.

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const vars = { folderId: "f1", input: { mode: "replace" as const, items: [] } };
const batchPath = `/api/v1/documents/f1/contents-access/${batchRunning.batch_id}`;

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const invalidate = vi.spyOn(qc, "invalidateQueries");
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  return { qc, invalidate, wrapper };
}

// React Query notifies observers through act-wrapped renders, so advance the fake clock inside act.
const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

const requestBody = (call: number) => JSON.parse(String(vi.mocked(fetch).mock.calls[call]![1]?.body)) as unknown;
const pathOf = (call: number) => new URL(String(vi.mocked(fetch).mock.calls[call]![0])).pathname;

beforeEach(() => {
  setAccessToken("tok");
  vi.stubGlobal("fetch", vi.fn());
  configureRuntime({ apiUrl: "http://api.test" });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  resetRuntimeConfig();
  setAccessToken(null);
});

describe("folderContentsAccessKeys", () => {
  it("puts the workspace id in every key and keeps the batch under all()", () => {
    expect(folderContentsAccessKeys.all("w1")).toContain("w1");
    expect(folderContentsAccessKeys.batch("w1", "f1", "b1")).toEqual([...folderContentsAccessKeys.all("w1"), "batch", "f1", "b1"]);
    expect(folderContentsAccessKeys.batch("w1", "f1", "b1")).not.toEqual(folderContentsAccessKeys.batch("w2", "f1", "b1"));
  });
});

describe("usePreviewFolderContentsAccess", () => {
  it("sends dry_run true, resolves the preview and invalidates nothing", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(dryRunReplace));
    const { invalidate, wrapper } = setup();
    const { result } = renderHook(() => usePreviewFolderContentsAccess("w1"), { wrapper });
    let out: unknown;
    await act(async () => {
      out = await result.current.mutateAsync(vars);
    });
    expect(pathOf(0)).toBe("/api/v1/documents/f1/contents-access");
    expect(requestBody(0)).toEqual({ mode: "replace", items: [], dry_run: true });
    expect(out).toEqual({ kind: "dry_run", total: 42, preview: dryRunReplace.preview });
    expect(invalidate).not.toHaveBeenCalled();
  });
});

describe("useApplyFolderContentsAccess", () => {
  it("sends dry_run false and, on a sync write, invalidates the workspace documents", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(syncResult));
    const { invalidate, wrapper } = setup();
    const { result } = renderHook(() => useApplyFolderContentsAccess("w1"), { wrapper });
    let out: unknown;
    await act(async () => {
      out = await result.current.mutateAsync(vars);
    });
    expect(requestBody(0)).toEqual({ mode: "replace", items: [], dry_run: false });
    expect(out).toMatchObject({ kind: "sync", batch_id: syncResult.batch_id, changed: 37 });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: documentKeys.workspace("w1") });
  });

  it("resolves a background batch without invalidating: nothing is written yet", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(backgroundAccepted, 202));
    const { invalidate, wrapper } = setup();
    const { result } = renderHook(() => useApplyFolderContentsAccess("w1"), { wrapper });
    let out: unknown;
    await act(async () => {
      out = await result.current.mutateAsync(vars);
    });
    expect(out).toEqual({ kind: "background", batch_id: backgroundAccepted.batch_id, total: 1800 });
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("rejects with the 409 error and invalidates nothing", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(errorBatchRunning, 409));
    const { invalidate, wrapper } = setup();
    const { result } = renderHook(() => useApplyFolderContentsAccess("w1"), { wrapper });
    let err: unknown;
    await act(async () => {
      err = await result.current.mutateAsync(vars).catch((e: unknown) => e);
    });
    expect(parseFolderAccessBatchRunning(err)).toEqual({ batch_id: batchRunning.batch_id });
    expect(invalidate).not.toHaveBeenCalled();
  });
});

describe("useFolderContentsAccessBatch", () => {
  it("stays disabled while the batch id is null", async () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useFolderContentsAccessBatch("w1", "f1", null), { wrapper });
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.fetchStatus).toBe("idle");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("polls every 2 s while running, then stops on completed and invalidates the workspace documents once", async () => {
    vi.useFakeTimers();
    vi.mocked(fetch)
      .mockResolvedValueOnce(json(batchRunning))
      .mockResolvedValueOnce(json({ ...batchRunning, status: "queued" }))
      .mockResolvedValueOnce(json(batchCompleted));
    const { invalidate, wrapper } = setup();
    const { result } = renderHook(() => useFolderContentsAccessBatch("w1", "f1", batchRunning.batch_id), { wrapper });

    await tick(0);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(pathOf(0)).toBe(batchPath);
    expect(result.current.data?.status).toBe("running");

    await tick(1900);
    expect(fetch).toHaveBeenCalledTimes(1);
    await tick(100);
    expect(fetch).toHaveBeenCalledTimes(2);
    await tick(10);
    expect(result.current.data?.status).toBe("queued");
    expect(invalidate).not.toHaveBeenCalled();

    await tick(2000);
    expect(fetch).toHaveBeenCalledTimes(3);
    await tick(10);
    expect(result.current.data?.status).toBe("completed");
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: documentKeys.workspace("w1") });

    await tick(10_000);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it("stops on failed without invalidating", async () => {
    vi.useFakeTimers();
    vi.mocked(fetch).mockResolvedValueOnce(json(batchFailed));
    const { invalidate, wrapper } = setup();
    const { result } = renderHook(() => useFolderContentsAccessBatch("w1", "f1", batchFailed.batch_id), { wrapper });
    await tick(0);
    expect(result.current.data?.status).toBe("failed");
    await tick(10_000);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("keeps polling when the status is one this client does not know", async () => {
    vi.useFakeTimers();
    vi.mocked(fetch)
      .mockResolvedValueOnce(json({ ...batchRunning, status: "paused" }))
      .mockResolvedValueOnce(json(batchCompleted));
    const { wrapper } = setup();
    const { result } = renderHook(() => useFolderContentsAccessBatch("w1", "f1", batchRunning.batch_id), { wrapper });
    await tick(0);
    expect(result.current.data?.status).toBe("running");
    await tick(2000);
    await tick(10);
    expect(result.current.data?.status).toBe("completed");
  });

  it("reads a batch that is already completed once and invalidates", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(batchCompleted));
    const { invalidate, wrapper } = setup();
    renderHook(() => useFolderContentsAccessBatch("w1", "f1", batchCompleted.batch_id), { wrapper });
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: documentKeys.workspace("w1") }));
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
