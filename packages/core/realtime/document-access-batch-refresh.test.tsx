import { QueryClient, QueryClientProvider, QueryObserver } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setAccessToken } from "../api/session";
import { resetAccessBatchRefreshClaims } from "../documents/access-batch-refresh";
import {
  backgroundAccepted,
  batchCompleted,
  batchRunning,
  syncResult,
} from "../documents/folder-contents-access.fixtures";
import {
  folderContentsAccessKeys,
  useApplyFolderContentsAccess,
  useFolderContentsAccessBatch,
} from "../documents/hooks-folder-contents-access";
import { documentKeys } from "../documents/keys";
import { configureRuntime, resetRuntimeConfig } from "../runtime-config";
import { documentFrameKeys } from "./document-events";

// UNI-2244: the tab that applied a folder access change refreshes the
// workspace documents once, whichever of the apply result, the batch poll and
// the document_access_batch.completed frame (ids only) reports it first.

const ws = "ws1";
const vars = { folderId: "f1", input: { mode: "replace" as const, items: [] } };
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const frame = (batchId: string, workspaceId = ws) => ({ batch_id: batchId, folder_id: "f1", workspace_id: workspaceId });
const tick = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

// A mounted workspace-documents query counts how often it is fetched; the
// frame handler is what use-realtime-sync does with documentFrameKeys.
function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  const fetches = vi.fn(() => Promise.resolve("docs"));
  const observer = new QueryObserver(qc, { queryKey: documentKeys.workspace(ws), queryFn: fetches, staleTime: Infinity });
  const unsubscribe = observer.subscribe(() => {});
  const emit = async (batchId: string, workspaceId = ws) => {
    const keys = documentFrameKeys(ws, "document_access_batch.completed", frame(batchId, workspaceId)) ?? [];
    await act(async () => {
      await Promise.all(keys.map((queryKey) => qc.invalidateQueries({ queryKey })));
    });
  };
  return { qc, wrapper, fetches, emit, unsubscribe };
}

beforeEach(() => {
  resetAccessBatchRefreshClaims();
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

describe("one workspace documents refresh per folder access batch", () => {
  it("sync apply, then the completed frame: fetched once", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(syncResult));
    const { wrapper, fetches, emit, unsubscribe } = setup();
    await act(async () => {});
    expect(fetches).toHaveBeenCalledTimes(1);
    const { result } = renderHook(() => useApplyFolderContentsAccess(ws), { wrapper });
    await act(async () => {
      await result.current.mutateAsync(vars);
    });
    expect(fetches).toHaveBeenCalledTimes(2);
    await emit(syncResult.batch_id);
    expect(fetches).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it("the completed frame before the apply result: fetched once", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(syncResult));
    const { wrapper, fetches, emit, unsubscribe } = setup();
    await act(async () => {});
    await emit(syncResult.batch_id);
    expect(fetches).toHaveBeenCalledTimes(2);
    const { result } = renderHook(() => useApplyFolderContentsAccess(ws), { wrapper });
    await act(async () => {
      await result.current.mutateAsync(vars);
    });
    expect(fetches).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it("a background batch polled to completed, then the frame: fetched once", async () => {
    vi.useFakeTimers();
    vi.mocked(fetch).mockResolvedValueOnce(json(batchRunning)).mockResolvedValueOnce(json(batchCompleted));
    const { wrapper, fetches, emit, unsubscribe } = setup();
    await tick(0);
    expect(fetches).toHaveBeenCalledTimes(1);
    const { result } = renderHook(() => useFolderContentsAccessBatch(ws, "f1", backgroundAccepted.batch_id), { wrapper });
    await tick(0);
    await tick(2010);
    expect(result.current.data?.status).toBe("completed");
    expect(fetches).toHaveBeenCalledTimes(2);
    await emit(backgroundAccepted.batch_id);
    expect(fetches).toHaveBeenCalledTimes(2);
    // The poll reached completed, so the status query is not refetched either.
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it("the frame before the poll sees completed: fetched once, status query refreshed", async () => {
    vi.useFakeTimers();
    vi.mocked(fetch).mockResolvedValueOnce(json(batchRunning)).mockResolvedValueOnce(json(batchCompleted));
    const { wrapper, fetches, emit, unsubscribe } = setup();
    await tick(0);
    const { result } = renderHook(() => useFolderContentsAccessBatch(ws, "f1", backgroundAccepted.batch_id), { wrapper });
    await tick(0);
    expect(result.current.data?.status).toBe("running");
    await emit(backgroundAccepted.batch_id);
    await tick(10);
    expect(result.current.data?.status).toBe("completed");
    expect(fetches).toHaveBeenCalledTimes(2);
    await tick(10_000);
    expect(fetches).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it("a frame for a batch this tab never applied invalidates in full", async () => {
    const { qc, emit, fetches, unsubscribe } = setup();
    await act(async () => {});
    const statusKey = folderContentsAccessKeys.batch(ws, "f1", "other-tab");
    qc.setQueryData(statusKey, { batch_id: "other-tab", status: "running" });
    await emit("other-tab");
    expect(fetches).toHaveBeenCalledTimes(2);
    expect(qc.getQueryState(statusKey)?.isInvalidated).toBe(true);
    unsubscribe();
  });

  it("a replayed frame for the same batch does not refetch again", async () => {
    const { emit, fetches, unsubscribe } = setup();
    await act(async () => {});
    await emit("replayed");
    await emit("replayed");
    expect(fetches).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it("a claim is per workspace and expires after five minutes", async () => {
    vi.useFakeTimers();
    const { emit, fetches, unsubscribe } = setup();
    await tick(0);
    await emit("expiring");
    expect(fetches).toHaveBeenCalledTimes(2);
    await tick(5 * 60 * 1000 + 1);
    await emit("expiring");
    expect(fetches).toHaveBeenCalledTimes(3);
    unsubscribe();
  });

  it("a frame stamped for another workspace refreshes nothing and claims nothing", () => {
    expect(documentFrameKeys(ws, "document_access_batch.completed", frame("b9", "ws2"))).toEqual([]);
    expect(documentFrameKeys(ws, "document_access_batch.completed", frame("b9"))).toEqual([
      folderContentsAccessKeys.all(ws),
      documentKeys.workspace(ws),
    ]);
  });
});
