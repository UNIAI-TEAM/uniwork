import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { taskKeys } from "@uniwork/core/tasks";
import { getTaskSurfaceViewStore } from "@uniwork/core/tasks/stores/surface-view-store";
import { ViewStoreProvider } from "@uniwork/core/tasks/stores/view-store-context";
import {
  tableGroupsBody,
  tableRowsPageBody,
  tableRowsPageQuery,
} from "@uniwork/core/tasks/surface/table-query";
import { serveBoardTable } from "../../test/board-table-server";
import { useTableViewData } from "../modes/use-table-view-data";
import { useBoardColumnsData } from "./use-board-columns-data";

initI18n();

let storeCount = 0;

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0 } } });
  storeCount += 1;
  const store = getTaskSurfaceViewStore(`board-columns-data-${storeCount}`);
  function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <ViewStoreProvider store={store}>{children}</ViewStoreProvider>
      </QueryClientProvider>
    );
  }
  return { client, store, Wrapper };
}

function renderColumns(categories: string[], before?: (store: ReturnType<typeof setup>["store"]) => void) {
  const { client, store, Wrapper } = setup();
  before?.(store);
  const view = renderHook(
    () => useBoardColumnsData({ workspaceId: "w1", categories, enabled: true }),
    { wrapper: Wrapper },
  );
  return { client, ...view };
}

const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 150)));

describe("useBoardColumnsData", () => {
  it("pages a column under the key the shared table-query builders give its parameters", async () => {
    const server = serveBoardTable({ counts: { todo: 3 } });
    const { client, Wrapper } = setup();
    const { result } = renderHook(
      () =>
        useBoardColumnsData({
          workspaceId: "w1",
          projectId: "p1",
          categories: ["todo"],
          enabled: true,
        }),
      { wrapper: Wrapper },
    );
    await waitFor(() => expect(result.current.columns.todo?.tasks).toHaveLength(3));

    const query = { filter: { project_ids: ["p1"] } };
    const entries = client.getQueryCache().findAll({ queryKey: taskKeys.tableRoot("w1") });
    const rows = entries.filter((entry) => entry.queryKey[2] === "rows");
    const groups = entries.filter((entry) => entry.queryKey[2] === "groups");
    expect(rows.map((entry) => entry.queryKey)).toEqual([
      tableRowsPageQuery(
        "w1",
        tableRowsPageBody({
          query,
          groupBy: "status",
          hierarchy: false,
          groupKey: "status:todo",
          parentId: null,
          cursor: null,
          limit: 50,
        }),
      ).queryKey,
    ]);
    expect(groups).toHaveLength(1);
    expect(server.groupBodies).toEqual([tableGroupsBody({ query, groupBy: "status" })]);
    expect(server.rowBodies[0]).toEqual({
      query,
      group_by: "status",
      group_key: "status:todo",
      hierarchy: false,
      parent_id: null,
      cursor: null,
      limit: 50,
    });
    expect(server.rowRequests()).toEqual(["status:todo@0"]);
  });

  it("shares its rows and groups cache entries with a flat table grouped by status on the same parameters", async () => {
    serveBoardTable({ counts: { todo: 3, done: 2 } });
    const { client, store, Wrapper } = setup();
    store.getState().setTableGrouping("status");
    // The board is flat; a table showing sub-tasks asks `hierarchy: true` and pages apart.
    store.getState().toggleShowSubTasks();
    const { result } = renderHook(
      () => ({
        board: useBoardColumnsData({
          workspaceId: "w1",
          projectId: "p1",
          categories: ["todo", "done"],
          enabled: true,
        }),
        table: useTableViewData({ workspaceId: "w1", filter: { project_ids: ["p1"] } }),
      }),
      { wrapper: Wrapper },
    );
    await waitFor(() => {
      expect(result.current.board.tasks).toHaveLength(5);
      expect(result.current.table.loadedTasks).toHaveLength(5);
    });

    const entries = client.getQueryCache().findAll({ queryKey: taskKeys.tableRoot("w1") });
    const rows = entries.filter((entry) => entry.queryKey[2] === "rows");
    const groups = entries.filter((entry) => entry.queryKey[2] === "groups");
    expect(rows).toHaveLength(2);
    expect(groups).toHaveLength(1);
    for (const entry of [...rows, ...groups]) {
      expect(entry.getObserversCount()).toBe(2);
    }
  });

  it("merges a column's pages in order and keeps the first copy of an id that crosses a page boundary", async () => {
    const server = serveBoardTable({ counts: { todo: 120 }, overlap: 1 });
    const { result } = renderColumns(["todo"]);
    await waitFor(() => expect(result.current.columns.todo?.tasks).toHaveLength(50));

    act(() => result.current.columns.todo!.loadMore());

    await waitFor(() => expect(result.current.columns.todo?.tasks).toHaveLength(99));
    const ids = result.current.columns.todo!.tasks.map((task) => task.id);
    expect(new Set(ids).size).toBe(99);
    expect(ids.slice(48, 51)).toEqual(["todo-48", "todo-49", "todo-50"]);
    expect(result.current.tasks).toHaveLength(99);
    expect(result.current.columns.todo!.count).toBe(120);
    expect(server.rowRequests()).toEqual(["status:todo@0", "status:todo@50"]);
  });

  it("asks for no rows of a column the groups call leaves out", async () => {
    const server = serveBoardTable({ counts: { todo: 3, done: 0 } });
    const { result } = renderColumns(["todo", "done"]);
    await waitFor(() => expect(result.current.columns.todo?.tasks).toHaveLength(3));

    expect(result.current.columns.done).toMatchObject({
      count: 0,
      tasks: [],
      hasMore: false,
      isLoading: false,
      isLoadingMore: false,
      isError: false,
    });
    expect(result.current.isLoading).toBe(false);
    await settle();
    expect(server.rowRequests()).toEqual(["status:todo@0"]);
  });

  it("counts a hidden status column from its group without loading its rows", async () => {
    const server = serveBoardTable({ counts: { todo: 3, done: 2 } });
    const { result } = renderColumns(["todo", "done"], (store) =>
      store.getState().hideStatus("done"),
    );
    await waitFor(() => expect(result.current.columns.todo?.tasks).toHaveLength(3));

    expect(result.current.columns.done).toMatchObject({ count: 2, tasks: [] });
    await settle();
    expect(server.rowRequests()).toEqual(["status:todo@0"]);
  });

  it("turns load more fired twice before the page renders into one request", async () => {
    const server = serveBoardTable({ counts: { todo: 120 } });
    const { result } = renderColumns(["todo"]);
    await waitFor(() => expect(result.current.columns.todo?.tasks).toHaveLength(50));

    // The button and the column-end sentinel can fire in the same tick.
    const { loadMore } = result.current.columns.todo!;
    act(() => {
      loadMore();
      loadMore();
    });

    await waitFor(() => expect(result.current.columns.todo?.tasks).toHaveLength(100));
    await settle();
    expect(server.rowRequests()).toEqual(["status:todo@0", "status:todo@50"]);
  });

  it("ends a column at a short page whatever its count claims", async () => {
    const server = serveBoardTable({ counts: { todo: 60 }, claimed: { todo: 200 } });
    const { result } = renderColumns(["todo"]);
    await waitFor(() => expect(result.current.columns.todo?.hasMore).toBe(true));

    act(() => result.current.columns.todo!.loadMore());

    await waitFor(() => expect(result.current.columns.todo?.tasks).toHaveLength(60));
    expect(result.current.columns.todo!.hasMore).toBe(false);
    act(() => result.current.columns.todo!.loadMore());
    await settle();
    expect(server.rowRequests()).toEqual(["status:todo@0", "status:todo@50"]);
  });

  it("never counts a column below the cards it has loaded", async () => {
    // 100 rows exist while the count lags at 60.
    serveBoardTable({ counts: { todo: 100 }, claimed: { todo: 60 } });
    const { result } = renderColumns(["todo"]);
    await waitFor(() => expect(result.current.columns.todo?.tasks).toHaveLength(50));
    expect(result.current.columns.todo!.count).toBe(60);

    act(() => result.current.columns.todo!.loadMore());

    await waitFor(() => expect(result.current.columns.todo?.tasks).toHaveLength(100));
    expect(result.current.columns.todo!.count).toBe(100);
    expect(result.current.columns.todo!.hasMore).toBe(false);
  });

  it("loads as a board until the first column page arrives", async () => {
    const server = serveBoardTable({ counts: { todo: 3 }, hold: "status:todo@0" });
    const { result } = renderColumns(["todo"]);
    await waitFor(() => expect(server.rowRequests()).toEqual(["status:todo@0"]));
    await settle();

    expect(result.current.isLoading).toBe(true);
    server.release();
    await waitFor(() => expect(result.current.columns.todo?.tasks).toHaveLength(3));
    expect(result.current.isLoading).toBe(false);
  });

  it("loads a column that fills after the first load inside that column, not as the board", async () => {
    // Counts are read on each request, so a column can gain tasks between two groups calls.
    const counts: Record<string, number> = { todo: 3, done: 0 };
    const server = serveBoardTable({ counts, hold: "status:done@0" });
    const { client, result } = renderColumns(["todo", "done"]);
    await waitFor(() => expect(result.current.columns.todo?.tasks).toHaveLength(3));

    counts.done = 2;
    act(() => void client.invalidateQueries({ queryKey: taskKeys.tableRoot("w1") }));
    await waitFor(() => expect(server.rowRequests()).toContain("status:done@0"));
    await settle();

    expect(result.current.columns.done).toMatchObject({ isLoading: true, tasks: [] });
    expect(result.current.isLoading).toBe(false);
    server.release();
    await waitFor(() => expect(result.current.columns.done?.tasks).toHaveLength(2));
    expect(result.current.isLoading).toBe(false);
  });

  it("does not load as a board again when the only column with tasks empties into one that has none", async () => {
    const counts: Record<string, number> = { todo: 1, done: 0 };
    const server = serveBoardTable({ counts, hold: "status:done@0" });
    const { client, result } = renderColumns(["todo", "done"]);
    await waitFor(() => expect(result.current.columns.todo?.tasks).toHaveLength(1));

    // Every page the board still asks for is new, and none has arrived yet.
    counts.todo = 0;
    counts.done = 1;
    act(() => void client.invalidateQueries({ queryKey: taskKeys.tableRoot("w1") }));
    await waitFor(() => expect(server.rowRequests()).toContain("status:done@0"));
    await settle();

    expect(result.current.columns.done?.isLoading).toBe(true);
    expect(result.current.isLoading).toBe(false);
    server.release();
    await waitFor(() => expect(result.current.columns.done?.tasks).toHaveLength(1));
  });

  it("loads as a board again after being switched off and on with nothing cached", async () => {
    const server = serveBoardTable({ counts: { todo: 3 }, hold: "status:todo@0", holdNth: 2 });
    const { client, Wrapper } = setup();
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) =>
        useBoardColumnsData({ workspaceId: "w1", categories: ["todo"], enabled }),
      { wrapper: Wrapper, initialProps: { enabled: true } },
    );
    await waitFor(() => expect(result.current.columns.todo?.tasks).toHaveLength(3));

    rerender({ enabled: false });
    client.removeQueries({ queryKey: taskKeys.tableRoot("w1") });
    rerender({ enabled: true });
    await waitFor(() => expect(server.rowRequests()).toEqual(["status:todo@0", "status:todo@0"]));
    await settle();

    expect(result.current.isLoading).toBe(true);
    server.release();
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.columns.todo?.tasks).toHaveLength(3);
  });

  it("keeps a failed page to its own column and retries that page through load more", async () => {
    const server = serveBoardTable({
      counts: { todo: 120, in_progress: 3 },
      failOnce: ["status:todo@50"],
    });
    const { result } = renderColumns(["todo", "in_progress"]);
    await waitFor(() => expect(result.current.columns.todo?.tasks).toHaveLength(50));

    act(() => result.current.columns.todo!.loadMore());

    await waitFor(() => expect(result.current.columns.todo?.isError).toBe(true));
    expect(result.current.columns.todo).toMatchObject({ hasMore: true, isLoadingMore: false });
    expect(result.current.columns.todo!.tasks).toHaveLength(50);
    expect(result.current.columns.in_progress).toMatchObject({ isError: false, count: 3 });
    expect(result.current.isError).toBe(false);

    act(() => result.current.columns.todo!.loadMore());

    await waitFor(() => expect(result.current.columns.todo?.tasks).toHaveLength(100));
    expect(result.current.columns.todo!.isError).toBe(false);
    expect(server.rowRequests().filter((page) => page.startsWith("status:todo@"))).toEqual([
      "status:todo@0",
      "status:todo@50",
      "status:todo@50",
      "status:todo@50",
    ]);
  });
});
