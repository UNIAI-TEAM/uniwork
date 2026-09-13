import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { taskKeys } from "@uniwork/core/tasks";
import { requestMock } from "../../test/api-mock";
import { useTaskSurfaceData } from "./use-task-surface-data";

const row = (index: number) => ({
  id: `t${index}`,
  workspace_id: "w1",
  title: `Task ${index}`,
  description: "",
  status: "todo",
  priority: "medium",
  position: index,
  created_by: "u1",
  created_at: "2026-09-06T00:00:00Z",
  updated_at: "2026-09-06T00:00:00Z",
});

/**
 * `/tasks/query` keeps serving full pages of 50 from `rows` tasks while every
 * page claims `claimedTotal`, as a count that lags rows inserted mid-paging.
 */
function serveLaggingCount(rows: number, claimedTotal: number) {
  requestMock.mockReset();
  requestMock.mockImplementation(async (path: string, init?: { body?: unknown }) => {
    if (typeof path !== "string" || !path.includes("/tasks/query")) {
      return { tasks: [], total: 0, limit: 50, offset: 0 };
    }
    const body = (init?.body ?? {}) as { offset?: number; limit?: number };
    const offset = Number(body.offset ?? 0);
    const limit = Number(body.limit ?? 50);
    const count = Math.max(0, Math.min(limit, rows - offset));
    return {
      tasks: Array.from({ length: count }, (_, k) => row(offset + k)),
      total: claimedTotal,
      limit,
      offset,
    };
  });
}

function renderData() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return renderHook(
    () =>
      useTaskSurfaceData({
        workspaceId: "w1",
        queryPlan: { kind: "workspace_query", queryBody: {} },
        enabled: true,
      }),
    { wrapper: Wrapper },
  );
}

describe("useTaskSurfaceData pagination total", () => {
  it("is the largest page total while that is above the loaded count, and never below the loaded count", async () => {
    // 100 tasks exist, every page says 60: after page 2 the claim is below what is on screen.
    serveLaggingCount(100, 60);
    const { result } = renderData();

    await waitFor(() => expect(result.current.pagination.loaded).toBe(50));
    expect(result.current.pagination.total).toBe(60);
    expect(result.current.pagination.hasMore).toBe(true);

    act(() => result.current.pagination.loadMore());

    await waitFor(() => expect(result.current.pagination.loaded).toBe(100));
    expect(result.current.pagination.hasMore).toBe(false);
    // Reads "100 / 100", not "100 / 60".
    expect(result.current.pagination.total).toBe(100);
  });
});

/**
 * `/tasks/query` serving 120 tasks per project, 50 per page. Request number
 * `holdNth` (counting every request from 1) waits for `release()`.
 */
function serveHeldRequest(holdNth: number) {
  const seen: Array<{ project: unknown; offset: number }> = [];
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  requestMock.mockReset();
  requestMock.mockImplementation(async (path: string, init?: { body?: unknown }) => {
    if (typeof path !== "string" || !path.includes("/tasks/query")) {
      return { tasks: [], total: 0, limit: 50, offset: 0 };
    }
    const body = (init?.body ?? {}) as { offset?: number; limit?: number; project_id?: string };
    const offset = Number(body.offset ?? 0);
    const limit = Number(body.limit ?? 50);
    seen.push({ project: body.project_id, offset });
    if (seen.length === holdNth) await held;
    const count = Math.max(0, Math.min(limit, 120 - offset));
    return {
      tasks: Array.from({ length: count }, (_, k) => row(offset + k)),
      total: 120,
      limit,
      offset,
    };
  });
  return { seen, release: () => release() };
}

describe("useTaskSurfaceData load more behind a refetch", () => {
  it("asks for no page of a filter that replaced the one it was clicked for", async () => {
    // Request 3 is the refetch of p1's first page; the click waits behind it.
    const server = serveHeldRequest(3);
    // The app's stale time (core/query-client.ts), so switching back to a
    // cached filter within it does not refetch.
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: 15_000 } },
    });
    function Wrapper({ children }: { children: React.ReactNode }) {
      return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    }
    const { result, rerender } = renderHook(
      ({ projectId }: { projectId: string }) =>
        useTaskSurfaceData({
          workspaceId: "w1",
          queryPlan: { kind: "workspace_query", queryBody: { project_id: projectId } },
          enabled: true,
        }),
      { wrapper: Wrapper, initialProps: { projectId: "p1" } },
    );
    await waitFor(() => expect(result.current.pagination.loaded).toBe(50));
    // p2 gets a cached first page, so it has data the moment the hook returns to it.
    rerender({ projectId: "p2" });
    await waitFor(() => expect(server.seen).toHaveLength(2));
    await waitFor(() => expect(result.current.pagination.loaded).toBe(50));
    rerender({ projectId: "p1" });
    await waitFor(() => expect(result.current.pagination.loaded).toBe(50));

    act(() => {
      void client.invalidateQueries({ queryKey: taskKeys.queryRoot("w1") });
    });
    await waitFor(() => expect(server.seen).toHaveLength(3));
    act(() => result.current.pagination.loadMore());

    // Same hook, new filter while the click waits: the observer it used now serves p2.
    rerender({ projectId: "p2" });
    server.release();
    await waitFor(() => expect(client.isFetching()).toBe(0));
    await act(() => new Promise((resolve) => setTimeout(resolve, 300)));

    expect(server.seen.filter((request) => request.project === "p2").map((r) => r.offset)).toEqual(
      [0, 0],
    );
    expect(result.current.pagination.loaded).toBe(50);
    expect(result.current.pagination.isLoadingMore).toBe(false);
  });
});
