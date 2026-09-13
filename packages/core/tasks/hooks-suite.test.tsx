import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../runtime-config";
import { setAccessToken } from "../api/session";
import type { Task } from "../types/task";
import { taskKeys } from "./keys";
import {
  useInfiniteMyTasks,
  useInfiniteQueryTasks,
  useMyTasks,
  useQueryTasks,
} from "./hooks-suite";

const WS = "ws1";
const QUERY_PATH = `/api/v1/workspaces/${WS}/tasks/query`;
const MY_TASKS_PATH = `/api/v1/workspaces/${WS}/my-tasks`;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function wrapperFor(qc: QueryClient) {
  function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  }
  return Wrapper;
}

function newClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function taskRow(i: number) {
  return {
    id: `t${String(i).padStart(3, "0")}`,
    workspace_id: WS,
    title: `Task ${i}`,
    description: "",
    status: "todo",
    priority: "medium",
    position: i,
    created_by: "u1",
    created_at: "2026-09-13T00:00:00Z",
    updated_at: "2026-09-13T00:00:00Z",
  };
}

interface SeenRequest {
  path: string;
  /** Paging and filter parameters, from the JSON body (query) or the query string (my-tasks). */
  params: Record<string, unknown>;
}

/**
 * A fake task-page server behind the real transport. `rows` tasks exist;
 * `total` is what the server claims, which defaults to `rows` and can be set
 * higher to simulate a count that drifted from the rows it can still serve.
 */
function serveTaskPages({ rows, total = rows }: { rows: number; total?: number }): SeenRequest[] {
  const all = Array.from({ length: rows }, (_, i) => taskRow(i));
  const seen: SeenRequest[] = [];
  vi.mocked(fetch).mockImplementation((input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const params: Record<string, unknown> =
      typeof init?.body === "string"
        ? (JSON.parse(init.body) as Record<string, unknown>)
        : Object.fromEntries(url.searchParams);
    seen.push({ path: url.pathname, params });
    // Mirrors the server defaults when a caller sends no paging (task_query.go).
    const limit = params.limit === undefined ? 50 : Number(params.limit);
    const offset = params.offset === undefined ? 0 : Number(params.offset);
    return Promise.resolve(json({ tasks: all.slice(offset, offset + limit), total, limit, offset }));
  });
  return seen;
}

interface Pager {
  hasNextPage: boolean;
  fetchNextPage: () => Promise<{ hasNextPage: boolean }>;
}

/**
 * Load pages until the hook says there are none, bounded so a paging bug shows
 * as extra requests rather than a hang. The loop reads `hasNextPage` from what
 * `fetchNextPage` resolves with: TanStack notifies React on a later tick, so
 * `result.current` can still be the render from before the page landed. Tests
 * read the rendered result afterwards through `waitFor` for the same reason.
 */
async function drain(result: { current: Pager }, maxPages = 6) {
  let hasNext = result.current.hasNextPage;
  for (let i = 0; i < maxPages && hasNext; i++) {
    await act(async () => {
      hasNext = (await result.current.fetchNextPage()).hasNextPage;
    });
  }
}

function loadedIds(pages: { tasks: Task[] }[] | undefined): string[] {
  return (pages ?? []).flatMap((p) => p.tasks.map((t) => t.id));
}

describe("infinite task queries", () => {
  beforeEach(() => {
    setAccessToken("tok");
    vi.stubGlobal("fetch", vi.fn());
    configureRuntime({ apiUrl: "http://api.test" });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    resetRuntimeConfig();
    setAccessToken(null);
  });

  describe("useInfiniteQueryTasks", () => {
    it("asks for the first page with an explicit limit 50 at offset 0, keeping the filter", async () => {
      const seen = serveTaskPages({ rows: 120 });
      const { result } = renderHook(() => useInfiniteQueryTasks(WS, { project_id: "p1" }), {
        wrapper: wrapperFor(newClient()),
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(seen).toEqual([{ path: QUERY_PATH, params: { project_id: "p1", limit: 50, offset: 0 } }]);
      expect(result.current.data?.pages[0]?.tasks).toHaveLength(50);
      expect(result.current.hasNextPage).toBe(true);
    });

    it("fetchNextPage asks for offset 50, then offset 100", async () => {
      const seen = serveTaskPages({ rows: 120 });
      const { result } = renderHook(() => useInfiniteQueryTasks(WS, { project_id: "p1" }), {
        wrapper: wrapperFor(newClient()),
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      await act(async () => {
        await result.current.fetchNextPage();
      });
      expect(seen.map((r) => r.params.offset)).toEqual([0, 50]);
      await act(async () => {
        await result.current.fetchNextPage();
      });
      expect(seen.map((r) => r.params.offset)).toEqual([0, 50, 100]);
      expect(seen.every((r) => r.params.limit === 50 && r.params.project_id === "p1")).toBe(true);
    });

    it("after the third page of 120 there is no next page and all 120 tasks are loaded once", async () => {
      const seen = serveTaskPages({ rows: 120 });
      const { result } = renderHook(() => useInfiniteQueryTasks(WS, {}), {
        wrapper: wrapperFor(newClient()),
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      await drain(result);

      expect(seen).toHaveLength(3);
      await waitFor(() => expect(result.current.hasNextPage).toBe(false));
      const ids = loadedIds(result.current.data?.pages);
      expect(ids).toHaveLength(120);
      expect(new Set(ids).size).toBe(120);
    });

    it("an empty result (total 0) has no next page and never asks for a second page", async () => {
      const seen = serveTaskPages({ rows: 0 });
      const { result } = renderHook(() => useInfiniteQueryTasks(WS, { status: "todo" }), {
        wrapper: wrapperFor(newClient()),
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      await drain(result);

      await waitFor(() => expect(result.current.hasNextPage).toBe(false));
      expect(seen).toHaveLength(1);
    });

    it("stops at a short page even when the server's total still claims more (drifted count)", async () => {
      // 70 rows really exist but the count says 120: page 2 comes back with 20 of 50.
      const seen = serveTaskPages({ rows: 70, total: 120 });
      const { result } = renderHook(() => useInfiniteQueryTasks(WS, {}), {
        wrapper: wrapperFor(newClient()),
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      await drain(result);

      expect(seen.map((r) => r.params.offset)).toEqual([0, 50]);
      await waitFor(() => expect(result.current.hasNextPage).toBe(false));
      expect(loadedIds(result.current.data?.pages)).toHaveLength(70);
    });

    it("stops without an extra request when a full page brings the loaded count exactly to total", async () => {
      const seen = serveTaskPages({ rows: 100 });
      const { result } = renderHook(() => useInfiniteQueryTasks(WS, {}), {
        wrapper: wrapperFor(newClient()),
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      await drain(result);

      expect(seen.map((r) => r.params.offset)).toEqual([0, 50]);
      await waitFor(() => expect(result.current.hasNextPage).toBe(false));
      expect(new Set(loadedIds(result.current.data?.pages)).size).toBe(100);
    });

    it("invalidating taskKeys.queryRoot refetches it (the key sits under the root)", async () => {
      const seen = serveTaskPages({ rows: 120 });
      const qc = newClient();
      const { result } = renderHook(() => useInfiniteQueryTasks(WS, {}), { wrapper: wrapperFor(qc) });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(seen).toHaveLength(1);

      await act(async () => {
        await qc.invalidateQueries({ queryKey: taskKeys.queryRoot(WS) });
      });
      expect(seen).toHaveLength(2);
      expect(seen[1]?.params).toEqual({ limit: 50, offset: 0 });
    });

    it("mounted beside useQueryTasks with the same body, each hook reads its own shape", async () => {
      serveTaskPages({ rows: 120 });
      const { result } = renderHook(
        () => ({
          plain: useQueryTasks(WS, { project_id: "p1" }),
          infinite: useInfiniteQueryTasks(WS, { project_id: "p1" }),
        }),
        { wrapper: wrapperFor(newClient()) },
      );
      await waitFor(() => {
        expect(result.current.plain.isSuccess).toBe(true);
        expect(result.current.infinite.isSuccess).toBe(true);
      });

      expect(result.current.plain.data?.tasks).toHaveLength(50);
      expect(result.current.plain.data?.total).toBe(120);
      expect(result.current.infinite.data?.pages).toHaveLength(1);
      expect(result.current.infinite.data?.pages[0]?.tasks).toHaveLength(50);
      expect(result.current.infinite.data?.pageParams).toEqual([0]);
    });
  });

  describe("useInfiniteMyTasks", () => {
    it("sends the relation with limit 50 and walks offsets until the total is loaded", async () => {
      const seen = serveTaskPages({ rows: 120 });
      const { result } = renderHook(() => useInfiniteMyTasks(WS, { relation: "assigned" }), {
        wrapper: wrapperFor(newClient()),
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      await drain(result);

      expect(seen).toEqual([
        { path: MY_TASKS_PATH, params: { relation: "assigned", limit: "50", offset: "0" } },
        { path: MY_TASKS_PATH, params: { relation: "assigned", limit: "50", offset: "50" } },
        { path: MY_TASKS_PATH, params: { relation: "assigned", limit: "50", offset: "100" } },
      ]);
      await waitFor(() => expect(result.current.hasNextPage).toBe(false));
      expect(new Set(loadedIds(result.current.data?.pages)).size).toBe(120);
    });

    it("stops at a short page even when the server's total still claims more", async () => {
      const seen = serveTaskPages({ rows: 70, total: 120 });
      const { result } = renderHook(() => useInfiniteMyTasks(WS, { relation: "all" }), {
        wrapper: wrapperFor(newClient()),
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      await drain(result);

      expect(seen.map((r) => r.params.offset)).toEqual(["0", "50"]);
      await waitFor(() => expect(result.current.hasNextPage).toBe(false));
    });

    it("invalidating taskKeys.myTasks refetches it (the key sits under the root)", async () => {
      const seen = serveTaskPages({ rows: 10 });
      const qc = newClient();
      const { result } = renderHook(() => useInfiniteMyTasks(WS, { relation: "created" }), {
        wrapper: wrapperFor(qc),
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(seen).toHaveLength(1);

      await act(async () => {
        await qc.invalidateQueries({ queryKey: taskKeys.myTasks(WS) });
      });
      expect(seen).toHaveLength(2);
    });

    it("mounted beside useMyTasks with the same relation, each hook reads its own shape", async () => {
      serveTaskPages({ rows: 120 });
      const { result } = renderHook(
        () => ({
          plain: useMyTasks(WS, { relation: "involved" }),
          infinite: useInfiniteMyTasks(WS, { relation: "involved" }),
        }),
        { wrapper: wrapperFor(newClient()) },
      );
      await waitFor(() => {
        expect(result.current.plain.isSuccess).toBe(true);
        expect(result.current.infinite.isSuccess).toBe(true);
      });

      expect(result.current.plain.data?.tasks).toHaveLength(50);
      expect(result.current.infinite.data?.pages[0]?.tasks).toHaveLength(50);
      expect(result.current.infinite.data?.pageParams).toEqual([0]);
    });
  });

  it("both infinite hooks stay idle without a workspace id", () => {
    const wrapper = wrapperFor(newClient());
    const query = renderHook(() => useInfiniteQueryTasks("", {}), { wrapper });
    const mine = renderHook(() => useInfiniteMyTasks("", { relation: "all" }), { wrapper });
    expect(query.result.current.fetchStatus).toBe("idle");
    expect(mine.result.current.fetchStatus).toBe("idle");
    expect(fetch).not.toHaveBeenCalled();
  });
});
