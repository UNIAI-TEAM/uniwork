import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { getTaskSurfaceViewStore } from "@uniwork/core/tasks/stores/surface-view-store";
import { ViewStoreProvider } from "@uniwork/core/tasks/stores/view-store-context";
import type { TableGrouping } from "@uniwork/core/tasks/stores/view-store";
import { serveBoardTable } from "../../test/board-table-server";
import { useTableViewData } from "./use-table-view-data";

initI18n();

let storeCount = 0;

function renderTableData(grouping: TableGrouping, initialSearch = "") {
  storeCount += 1;
  const store = getTaskSurfaceViewStore(`table-view-data-${storeCount}`);
  store.getState().setTableGrouping(grouping);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <ViewStoreProvider store={store}>{children}</ViewStoreProvider>
      </QueryClientProvider>
    );
  }
  const view = renderHook(
    ({ search }: { search: string }) => useTableViewData({ workspaceId: "w1", search }),
    { wrapper: Wrapper, initialProps: { search: initialSearch } },
  );
  return { store, client, ...view };
}

const loadMoreRow = (rows: ReturnType<typeof useTableViewData>["displayRows"]) =>
  rows.find((row) => row.kind === "load_more");

afterEach(() => {
  vi.useRealTimers();
});

describe("useTableViewData", () => {
  it("pages the ungrouped table as one branch with group_by none and no group key", async () => {
    const server = serveBoardTable({ counts: { todo: 3, done: 2 } });
    const { result } = renderTableData("none");
    await waitFor(() => expect(result.current.loadedTasks).toHaveLength(5));

    expect(server.groupBodies).toEqual([]);
    expect(server.rowBodies).toEqual([
      {
        query: {},
        group_by: "none",
        group_key: null,
        hierarchy: false,
        parent_id: null,
        cursor: null,
        limit: 50,
      },
    ]);
    expect(result.current.total).toBe(5);
  });

  it("pages each open status group under its server group key", async () => {
    const server = serveBoardTable({ counts: { todo: 3, done: 2 } });
    const { result, store } = renderTableData("status");
    await waitFor(() => expect(result.current.loadedTasks).toHaveLength(5));

    expect(server.groupBodies).toEqual([{ query: {}, group_by: "status" }]);
    expect(server.rowRequests().sort()).toEqual(["status:done@0", "status:todo@0"]);
    expect(
      result.current.displayRows.filter((row) => row.kind === "group").map((row) => row.key),
    ).toEqual(["status:todo", "status:done"]);

    act(() => store.getState().toggleTableGroupCollapsed("status:done"));
    await waitFor(() => expect(result.current.loadedTasks).toHaveLength(3));
    expect(server.rowRequests()).toHaveLength(2);
  });

  it("sends a changed sort to the server and starts over at the first page", async () => {
    const server = serveBoardTable({ counts: { todo: 120 } });
    const { result, store } = renderTableData("none");
    await waitFor(() => expect(result.current.loadedTasks).toHaveLength(50));

    const more = loadMoreRow(result.current.displayRows);
    expect(more).toMatchObject({ state: "has_more", total: 120, loadedCount: 50 });
    act(() => (more as { onLoad: () => void }).onLoad());
    await waitFor(() => expect(result.current.loadedTasks).toHaveLength(100));

    act(() => {
      store.getState().setSortBy("title");
      store.getState().setSortDirection("desc");
    });
    await waitFor(() =>
      expect(server.rowBodies.at(-1)).toMatchObject({
        query: { sort: { field: "title", direction: "desc" } },
        cursor: null,
      }),
    );
    await waitFor(() => expect(result.current.loadedTasks).toHaveLength(50));
    await act(() => new Promise((resolve) => setTimeout(resolve, 100)));

    const sorted = server.rowBodies.filter(
      (body) => (body.query as { sort?: unknown }).sort !== undefined,
    );
    expect(sorted).toHaveLength(1);
    expect(loadMoreRow(result.current.displayRows)).toMatchObject({ loadedCount: 50 });
  });

  it("sends a typed search only once it has held still for 300 ms", async () => {
    const server = serveBoardTable({ counts: { todo: 3 } });
    const { result, rerender } = renderTableData("none");
    await waitFor(() => expect(result.current.loadedTasks).toHaveLength(3));
    const searched = () =>
      server.rowBodies.filter((body) => (body.query as { search?: string }).search !== undefined);

    vi.useFakeTimers();
    rerender({ search: "ab" });
    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    rerender({ search: "abc" });
    await act(async () => {
      vi.advanceTimersByTime(299);
    });
    expect(searched()).toEqual([]);

    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    vi.useRealTimers();
    await waitFor(() => expect(searched()).toHaveLength(1));
    expect(searched()[0]).toMatchObject({ query: { search: "abc" }, group_key: null, cursor: null });
  });
});
