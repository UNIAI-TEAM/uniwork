import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { taskKeys } from "@uniwork/core/tasks";
import { getTaskSurfaceViewStore } from "@uniwork/core/tasks/stores/surface-view-store";
import { ViewStoreProvider } from "@uniwork/core/tasks/stores/view-store-context";
import { serveBoardTable } from "../../test/board-table-server";
import { useTableViewData } from "../modes/use-table-view-data";
import { useBoardColumnsData } from "./use-board-columns-data";

initI18n();

let storeCount = 0;

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
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
  it("puts a column page in the same cache entry the table view uses for the same parameters", async () => {
    const server = serveBoardTable({ counts: { todo: 3 } });
    const { client, store, Wrapper } = setup();
    // The table view grouped by status with the board's columns: the parameters match.
    store.getState().setTableGrouping("status");
    for (const key of ["priority", "assignee", "due_date", "labels"] as const) {
      store.getState().toggleTableColumn(key);
    }
    const filter = { project_ids: ["p1"] };
    const { result } = renderHook(
      () => ({
        board: useBoardColumnsData({
          workspaceId: "w1",
          projectId: "p1",
          categories: ["todo"],
          enabled: true,
        }),
        table: useTableViewData({ workspaceId: "w1", filter }),
      }),
      { wrapper: Wrapper },
    );
    await waitFor(() => expect(result.current.board.columns.todo?.tasks).toHaveLength(3));
    await waitFor(() => expect(result.current.table.loadedTasks).toHaveLength(3));

    const entries = client.getQueryCache().findAll({ queryKey: taskKeys.tableRoot("w1") });
    const rows = entries.filter((query) => query.queryKey[2] === "rows");
    const groups = entries.filter((query) => query.queryKey[2] === "groups");
    // Byte for byte the key the table view has always built.
    expect(rows.map((query) => query.queryKey)).toEqual([
      [
        "tasks-table",
        "w1",
        "rows",
        '{"filter":{"project_ids":["p1"]},"group_by":"status","group_key":"todo","columns":["title","status"],"limit":50,"offset":0}',
      ],
    ]);
    expect(rows[0]!.getObserversCount()).toBe(2);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.getObserversCount()).toBe(2);
    expect(server.rowRequests()).toEqual(["todo@0"]);
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
    expect(server.rowRequests()).toEqual(["todo@0", "todo@50"]);
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
    expect(server.rowRequests()).toEqual(["todo@0"]);
  });

  it("counts a hidden status column from its group without loading its rows", async () => {
    const server = serveBoardTable({ counts: { todo: 3, done: 2 } });
    const { result } = renderColumns(["todo", "done"], (store) =>
      store.getState().hideStatus("done"),
    );
    await waitFor(() => expect(result.current.columns.todo?.tasks).toHaveLength(3));

    expect(result.current.columns.done).toMatchObject({ count: 2, tasks: [] });
    await settle();
    expect(server.rowRequests()).toEqual(["todo@0"]);
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
    expect(server.rowRequests()).toEqual(["todo@0", "todo@50"]);
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
    expect(server.rowRequests()).toEqual(["todo@0", "todo@50"]);
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

  it("keeps a failed page to its own column and retries that page through load more", async () => {
    const server = serveBoardTable({
      counts: { todo: 120, in_progress: 3 },
      failOnce: ["todo@50"],
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
    expect(server.rowRequests().filter((page) => page.startsWith("todo@"))).toEqual([
      "todo@0",
      "todo@50",
      "todo@50",
    ]);
  });
});
