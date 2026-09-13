import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
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
