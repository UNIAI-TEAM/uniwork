import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api/http";
import { taskKeys } from "@uniwork/core/tasks";
import { initI18n } from "@uniwork/core/i18n";
import { getTaskSurfaceViewStore } from "@uniwork/core/tasks/stores/surface-view-store";
import { ViewStoreProvider } from "@uniwork/core/tasks/stores/view-store-context";
import type { TableGrouping } from "@uniwork/core/tasks/stores/view-store";
import { serveBoardTable } from "../../test/board-table-server";
import { serveTableCursor } from "../../test/table-cursor-server";
import { useTableViewData } from "./use-table-view-data";

initI18n();

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

let storeCount = 0;

function renderTableData(
  grouping: TableGrouping,
  initialSearch = "",
  before?: (store: ReturnType<typeof getTaskSurfaceViewStore>) => void,
  client = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0 } } }),
) {
  storeCount += 1;
  const store = getTaskSurfaceViewStore(`table-view-data-${storeCount}`);
  store.getState().setTableGrouping(grouping);
  before?.(store);
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
        hierarchy: true,
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

  it("lists every matching task flat with hierarchy off when sub-tasks are hidden", async () => {
    const server = serveTableCursor({ count: () => 2, childCount: () => 3 });
    const { result, store } = renderTableData("none", "", (s) => s.getState().toggleShowSubTasks());
    await waitFor(() => expect(result.current.loadedTasks).toHaveLength(2));

    expect(server.rowBodies).toEqual([expect.objectContaining({ hierarchy: false, parent_id: null })]);
    expect(result.current.displayRows).toMatchObject([
      { kind: "task", hasChildren: false, depth: 0 },
      { kind: "task", hasChildren: false, depth: 0 },
    ]);
    expect(store.getState().tableExpandedParents).toEqual([]);
  });

  it("keeps parents closed and asks a parent's children only once it is expanded", async () => {
    const server = serveTableCursor({
      count: (_group, parentId) => (parentId ? 1 : 2),
      childCount: (_group, parentId, index) => (!parentId && index === 0 ? 1 : 0),
    });
    const { result, store } = renderTableData("none");
    await waitFor(() => expect(result.current.loadedTasks).toHaveLength(2));
    expect(result.current.displayRows[0]).toMatchObject({
      kind: "task",
      key: "null-0",
      hasChildren: true,
      collapsed: true,
    });
    expect(server.rowBodies).toHaveLength(1);

    act(() => store.getState().toggleTableParentExpanded("null-0"));
    await waitFor(() => expect(result.current.loadedTasks).toHaveLength(3));

    expect(server.rowBodies.at(-1)).toEqual({
      query: {},
      group_by: "none",
      group_key: null,
      hierarchy: true,
      parent_id: "null-0",
      cursor: null,
      limit: 50,
    });
    expect(
      result.current.displayRows.map((row) => (row.kind === "task" ? `${row.key}@${row.depth}` : row.kind)),
    ).toEqual(["null-0@0", "null/null-0-0@1", "null-1@0"]);
  });

  it("groups by project under the server's names, and names the tasks without a project", async () => {
    const server = serveTableCursor({
      count: () => 1,
      groups: () => [
        { key: "project:p1", value: { kind: "project", project_id: "p1", label: "Website" }, count: 1 },
        { key: "project:none", value: { kind: "project" }, count: 1 },
      ],
    });
    const { result } = renderTableData("project");
    await waitFor(() => expect(result.current.loadedTasks).toHaveLength(2));

    expect(server.groupBodies).toEqual([{ query: {}, group_by: "project" }]);
    expect(
      result.current.displayRows.filter((row) => row.kind === "group").map((row) => row.label),
    ).toEqual(["Website", "Không có dự án"]);
    expect(server.rowRequests().sort()).toEqual(["project:none@null", "project:p1@null"]);
  });

  it("colours a select property's groups with their option colour", async () => {
    serveTableCursor({
      count: () => 1,
      groups: () => [
        { key: "property:p1:o1", value: { kind: "property", property_id: "p1", option: "o1", label: "Cao" }, count: 1 },
        { key: "property:p1:none", value: { kind: "property", property_id: "p1" }, count: 1 },
      ],
    });
    storeCount += 1;
    const store = getTaskSurfaceViewStore(`table-view-data-${storeCount}`);
    store.getState().setTableGrouping("property:p1");
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0 } } });
    const properties = new Map([
      [
        "p1",
        {
          id: "p1",
          organization_id: "o1",
          workspace_id: "w1",
          name: "Mức độ",
          type: "select",
          description: "",
          config: { options: [{ id: "o1", name: "Cao", color: "#ef4444" }] },
          position: 0,
          usage_count: 0,
          created_at: "2026-09-01T00:00:00Z",
          updated_at: "2026-09-01T00:00:00Z",
        },
      ],
    ]);
    function Wrapper({ children }: { children: React.ReactNode }) {
      return (
        <QueryClientProvider client={client}>
          <ViewStoreProvider store={store}>{children}</ViewStoreProvider>
        </QueryClientProvider>
      );
    }
    const { result } = renderHook(() => useTableViewData({ workspaceId: "w1", properties }), {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(result.current.loadedTasks).toHaveLength(2));
    expect(
      result.current.displayRows
        .filter((row) => row.kind === "group")
        .map((row) => [row.label, row.color]),
    ).toEqual([
      ["Cao", "#ef4444"],
      ["Chưa có giá trị", undefined],
    ]);
  });

  it("keeps the rows and open sub-tasks on screen while a changed search loads, and asks the children at once", async () => {
    const server = serveTableCursor({
      count: (_group, parentId) => (parentId ? 1 : 2),
      childCount: (_group, parentId, index) => (!parentId && index === 0 ? 1 : 0),
      hold: (body) => (body.query as { search?: string }).search === "x" && body.parent_id === null,
    });
    const { result, store, rerender } = renderTableData("none");
    await waitFor(() => expect(result.current.loadedTasks).toHaveLength(2));
    act(() => store.getState().toggleTableParentExpanded("null-0"));
    await waitFor(() => expect(result.current.loadedTasks).toHaveLength(3));
    const shape = () =>
      result.current.displayRows.map((row) => (row.kind === "task" ? `${row.key}@${row.depth}` : row.kind));

    rerender({ search: "x" });
    const searched = () =>
      server.rowBodies.filter((body) => (body.query as { search?: string }).search === "x");
    // The roots are held: the child branch is asked under the new query anyway.
    await waitFor(() => expect(searched().map((body) => body.parent_id).sort()).toEqual([null, "null-0"]), {
      timeout: 1500,
    });
    await waitFor(() => expect(result.current.isRefreshing).toBe(true));
    expect(result.current.isLoading).toBe(false);
    expect(shape()).toEqual(["null-0@0", "null/null-0-0@1", "null-1@0"]);

    server.release();
    await waitFor(() => expect(result.current.isRefreshing).toBe(false));
    expect(shape()).toEqual(["null-0@0", "null/null-0-0@1", "null-1@0"]);
  });

  it("keeps the groups on screen while a changed search loads them again", async () => {
    const server = serveTableCursor({
      count: () => 1,
      groups: () => [
        { key: "status:todo", value: { kind: "status", status: "todo" }, count: 1 },
      ],
      hold: (body) => (body.query as { search?: string }).search === "x",
    });
    const { result, rerender } = renderTableData("status");
    await waitFor(() => expect(result.current.loadedTasks).toHaveLength(1));

    rerender({ search: "x" });
    await waitFor(() => expect(server.groupBodies).toHaveLength(2), { timeout: 1500 });
    await waitFor(() => expect(result.current.isRefreshing).toBe(true));
    expect(result.current.isLoading).toBe(false);
    expect(result.current.displayRows.map((row) => row.kind)).toEqual(["group", "task"]);
    server.release();
    await waitFor(() => expect(result.current.isRefreshing).toBe(false));
  });

  it("says it shows previous rows only for a changed query, not for a refetch after an edit", async () => {
    let holding = false;
    const server = serveTableCursor({
      count: () => 2,
      groups: () => [{ key: "status:todo", value: { kind: "status", status: "todo" }, count: 2 }],
      hold: (body) => holding || (body.query as { search?: string }).search === "x",
    });
    const { result, client, rerender } = renderTableData("status");
    await waitFor(() => expect(result.current.loadedTasks).toHaveLength(2));

    holding = true;
    act(() => {
      void client.invalidateQueries({ queryKey: taskKeys.tableRoot("w1") });
    });
    await waitFor(() => expect(result.current.isRefreshing).toBe(true));
    expect(result.current.isShowingPrevious).toBe(false);
    server.release();
    await waitFor(() => expect(result.current.isRefreshing).toBe(false));
    holding = false;

    rerender({ search: "x" });
    await waitFor(() => expect(result.current.isShowingPrevious).toBe(true), { timeout: 1500 });
    expect(result.current.displayRows.map((row) => row.kind)).toEqual(["group", "task", "task"]);
    server.release();
    await waitFor(() => expect(result.current.isShowingPrevious).toBe(false));
  });

  it("keeps the rows when a background refetch of the groups fails", async () => {
    let failing = false;
    serveTableCursor({
      count: () => 1,
      groups: () =>
        failing ? new Error("groups down") : [{ key: "status:todo", value: { kind: "status", status: "todo" }, count: 1 }],
    });
    const { result, client } = renderTableData("status");
    await waitFor(() => expect(result.current.loadedTasks).toHaveLength(1));

    failing = true;
    await act(() => client.refetchQueries({ queryKey: [...taskKeys.tableRoot("w1"), "groups"] }));
    await waitFor(() => expect(client.getQueryCache().findAll({ queryKey: [...taskKeys.tableRoot("w1"), "groups"] })[0]?.state.status).toBe("error"));
    expect(result.current.groupsError).toBe(false);
    expect(result.current.displayRows.map((row) => row.kind)).toEqual(["group", "task"]);
  });

  it("starts a changed grouping from skeletons, not the old grouping's groups", async () => {
    const server = serveTableCursor({
      count: () => 1,
      groups: (groupBy) => [
        { key: `${groupBy}:a`, value: { kind: groupBy }, count: 1 },
      ],
      hold: (body) => body.group_by === "priority" && body.group_key === undefined,
    });
    const { result, store } = renderTableData("status");
    await waitFor(() => expect(result.current.loadedTasks).toHaveLength(1));

    act(() => store.getState().setTableGrouping("priority"));
    await waitFor(() => expect(server.groupBodies).toHaveLength(2));
    expect(result.current.isLoading).toBe(true);
    expect(result.current.displayRows.some((row) => row.kind === "group")).toBe(false);
    server.release();
    await waitFor(() => expect(result.current.displayRows[0]).toMatchObject({ kind: "group", key: "priority:a" }));
  });

  it("falls back to no grouping with one notice when the server cannot group by a property", async () => {
    const infoMock = vi.mocked(toast.info);
    infoMock.mockClear();
    const server = serveTableCursor({
      count: () => 2,
      groups: () => new ApiError("grouping needs an active select or checkbox property", "unsupported_group", 422),
    });
    // The app's own retry defaults (a 1 s delay first): a 422 is not retried,
    // so the grouping resets well inside that delay.
    const { result, store } = renderTableData("property:gone", "", undefined, new QueryClient());
    await waitFor(() => expect(store.getState().tableGrouping).toBe("none"), { timeout: 500 });
    await waitFor(() => expect(result.current.loadedTasks).toHaveLength(2));

    expect(server.groupBodies).toEqual([{ query: {}, group_by: "property:gone" }]);
    expect(result.current.groupsError).toBe(false);
    expect(infoMock).toHaveBeenCalledTimes(1);
    expect(infoMock).toHaveBeenCalledWith(
      "Không nhóm được theo thuộc tính này, đã chuyển về “Không nhóm”.",
    );
  });
});
