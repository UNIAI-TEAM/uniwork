import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { tableRowsBranchPrefix, tableRowsPageBody } from "@uniwork/core/tasks/surface/table-query";
import { encodeCursor, serveTableCursor } from "../../test/table-cursor-server";
import { useCursorBranches, type CursorBranchSpec } from "./use-cursor-branches";

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return { client, Wrapper };
}

function branch(groupKey: string, over: { search?: string; limit?: number; parentId?: string } = {}): CursorBranchSpec {
  return {
    key: over.parentId ? `${groupKey}/${over.parentId}` : groupKey,
    body: tableRowsPageBody({
      query: over.search ? { search: over.search } : {},
      groupBy: "status",
      hierarchy: false,
      groupKey,
      parentId: over.parentId ?? null,
      cursor: null,
      limit: over.limit ?? 2,
    }),
    enabled: true,
  };
}

function renderBranches(initial: { search?: string; limit?: number }, keys = ["todo"]) {
  const { client, Wrapper } = setup();
  const view = renderHook(
    (props: { search?: string; limit?: number }) =>
      useCursorBranches(
        "w1",
        keys.map((key) => branch(key, props)),
      ),
    { wrapper: Wrapper, initialProps: initial },
  );
  return { client, ...view };
}

const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 50)));

describe("useCursorBranches", () => {
  it("loads the first page, then each next page on its cursor, until the branch ends", async () => {
    const server = serveTableCursor({ count: () => 5 });
    const { result } = renderBranches({});

    await waitFor(() => expect(result.current.byKey.get("todo")?.rows).toHaveLength(2));
    const first = result.current.byKey.get("todo")!;
    expect(first).toMatchObject({ total: 5, hasMore: true, isLoading: false, isError: false });

    act(() => result.current.byKey.get("todo")!.loadMore());
    await waitFor(() => expect(result.current.byKey.get("todo")?.rows).toHaveLength(4));
    act(() => result.current.byKey.get("todo")!.loadMore());
    await waitFor(() => expect(result.current.byKey.get("todo")?.rows).toHaveLength(5));

    const state = result.current.byKey.get("todo")!;
    expect(state.hasMore).toBe(false);
    expect(state.rows.map((row) => row.task.id)).toEqual([0, 1, 2, 3, 4].map((i) => `todo-${i}`));
    expect(server.rowRequests()).toEqual([
      "todo@null",
      `todo@${encodeCursor(2)}`,
      `todo@${encodeCursor(4)}`,
    ]);

    // At the end of the branch, loadMore asks for nothing.
    act(() => result.current.byKey.get("todo")!.loadMore());
    await settle();
    expect(server.rowRequests()).toHaveLength(3);
  });

  it("keeps byKey's identity across a render where nothing changed", async () => {
    serveTableCursor({ count: () => 5 });
    const { result, rerender } = renderBranches({}, ["todo", "done"]);
    await waitFor(() => expect(result.current.byKey.get("done")?.rows).toHaveLength(2));
    await settle();

    const before = result.current.byKey;
    rerender({});
    rerender({});
    expect(result.current.byKey).toBe(before);
    expect(result.current.byKey.get("todo")).toBe(before.get("todo"));
  });

  it("reads a branch whose query changed as one page, asked for with a null cursor", async () => {
    const server = serveTableCursor({ count: () => 6 });
    const { result, rerender } = renderBranches({});
    await waitFor(() => expect(result.current.byKey.get("todo")?.rows).toHaveLength(2));
    act(() => result.current.byKey.get("todo")!.loadMore());
    await waitFor(() => expect(result.current.byKey.get("todo")?.rows).toHaveLength(4));

    server.rowBodies.length = 0;
    rerender({ search: "abc" });
    await waitFor(() => expect(result.current.byKey.get("todo")?.rows).toHaveLength(2));
    await settle();

    expect(server.rowBodies).toHaveLength(1);
    expect(server.rowBodies[0]).toMatchObject({ cursor: null, query: { search: "abc" } });
    expect(result.current.byKey.get("todo")?.hasMore).toBe(true);
  });

  it("drops the tail pages when the first page refetches with changed data", async () => {
    const server = serveTableCursor({ count: () => 6 });
    const { client, result } = renderBranches({});
    await waitFor(() => expect(result.current.byKey.get("todo")?.rows).toHaveLength(2));
    act(() => result.current.byKey.get("todo")!.loadMore());
    await waitFor(() => expect(result.current.byKey.get("todo")?.rows).toHaveLength(4));

    server.change();
    await act(() => client.invalidateQueries({ queryKey: tableRowsBranchPrefix("w1", branch("todo").body) }));
    await waitFor(() => expect(result.current.byKey.get("todo")?.rows).toHaveLength(2));
    await settle();

    const state = result.current.byKey.get("todo")!;
    expect(state.rows.map((row) => row.task.title)).toEqual(["todo 0 v1", "todo 1 v1"]);
    expect(state.hasMore).toBe(true);
    expect(result.current.isRefreshing).toBe(false);

    // Paging again starts from the fresh first page's cursor.
    server.rowBodies.length = 0;
    act(() => result.current.byKey.get("todo")!.loadMore());
    await waitFor(() => expect(result.current.byKey.get("todo")?.rows).toHaveLength(4));
    expect(result.current.byKey.get("todo")!.rows[2]!.task.title).toBe("todo 2 v1");
  });

  it("keeps the tail pages when the first page refetches with equal data", async () => {
    const server = serveTableCursor({ count: () => 6 });
    const { client, result } = renderBranches({});
    await waitFor(() => expect(result.current.byKey.get("todo")?.rows).toHaveLength(2));
    act(() => result.current.byKey.get("todo")!.loadMore());
    await waitFor(() => expect(result.current.byKey.get("todo")?.rows).toHaveLength(4));

    // A window-refocus style refetch: the server answers the same rows.
    server.rowBodies.length = 0;
    await act(() => client.refetchQueries({ queryKey: tableRowsBranchPrefix("w1", branch("todo").body) }));
    await waitFor(() => expect(server.rowBodies.length).toBeGreaterThanOrEqual(2));
    await settle();

    const state = result.current.byKey.get("todo")!;
    expect(state.rows.map((row) => row.task.id)).toEqual([0, 1, 2, 3].map((i) => `todo-${i}`));
    expect(state.hasMore).toBe(true);

    // The cursors stayed too: the next page is the third one.
    server.rowBodies.length = 0;
    act(() => result.current.byKey.get("todo")!.loadMore());
    await waitFor(() => expect(result.current.byKey.get("todo")?.rows).toHaveLength(6));
    expect(server.rowRequests()).toEqual([`todo@${encodeCursor(4)}`]);
  });

  it("follows the first page's total down after deletions", async () => {
    let count = 6;
    serveTableCursor({ count: () => count });
    const { client, result } = renderBranches({});
    await waitFor(() => expect(result.current.byKey.get("todo")?.total).toBe(6));
    act(() => result.current.byKey.get("todo")!.loadMore());
    await waitFor(() => expect(result.current.byKey.get("todo")?.rows).toHaveLength(4));

    count = 3;
    await act(() => client.refetchQueries({ queryKey: tableRowsBranchPrefix("w1", branch("todo").body) }));
    await waitFor(() => expect(result.current.byKey.get("todo")?.total).toBe(3));
    await settle();
    expect(result.current.byKey.get("todo")?.rows).toHaveLength(2);
    expect(result.current.byKey.get("todo")?.total).toBe(3);
  });

  it("never reports a total below the rows loaded", async () => {
    serveTableCursor({ count: () => 6, claimed: () => 1 });
    const { result } = renderBranches({});
    await waitFor(() => expect(result.current.byKey.get("todo")?.rows).toHaveLength(2));
    expect(result.current.byKey.get("todo")?.total).toBe(2);
    act(() => result.current.byKey.get("todo")!.loadMore());
    await waitFor(() => expect(result.current.byKey.get("todo")?.rows).toHaveLength(4));
    expect(result.current.byKey.get("todo")?.total).toBe(4);
  });

  it("reports a failed page, and retry refetches it and clears the error", async () => {
    const server = serveTableCursor({ count: () => 5, failOnce: ["todo@0"] });
    const { result } = renderBranches({});

    await waitFor(() => expect(result.current.byKey.get("todo")?.isError).toBe(true));
    expect(result.current.byKey.get("todo")).toMatchObject({ isLoading: false, rows: [] });

    act(() => result.current.byKey.get("todo")!.retry());
    await waitFor(() => expect(result.current.byKey.get("todo")?.rows).toHaveLength(2));
    expect(result.current.byKey.get("todo")?.isError).toBe(false);
    expect(server.rowRequests()).toEqual(["todo@null", "todo@null"]);
  });

  it("retries a failed later page from loadMore, keeping the rows before it", async () => {
    const server = serveTableCursor({ count: () => 5, failOnce: ["todo@2"] });
    const { result } = renderBranches({});
    await waitFor(() => expect(result.current.byKey.get("todo")?.rows).toHaveLength(2));

    act(() => result.current.byKey.get("todo")!.loadMore());
    await waitFor(() => expect(server.rowRequests()).toHaveLength(2));
    await settle();
    expect(result.current.byKey.get("todo")).toMatchObject({ isFetchingMore: false });
    expect(result.current.byKey.get("todo")?.rows).toHaveLength(2);

    act(() => result.current.byKey.get("todo")!.loadMore());
    await waitFor(() => expect(result.current.byKey.get("todo")?.rows).toHaveLength(4));
    expect(server.rowRequests()).toEqual(["todo@null", `todo@${encodeCursor(2)}`, `todo@${encodeCursor(2)}`]);
  });

  it("resets a branch to its first page once when a later cursor no longer matches the query", async () => {
    const server = serveTableCursor({ count: () => 5, mismatchOnce: ["todo@2"] });
    const { result } = renderBranches({});
    await waitFor(() => expect(result.current.byKey.get("todo")?.rows).toHaveLength(2));

    act(() => result.current.byKey.get("todo")!.loadMore());
    await waitFor(() => expect(server.rowRequests()).toHaveLength(2));
    await settle();

    const state = result.current.byKey.get("todo")!;
    expect(state).toMatchObject({ isError: false, hasMore: true });
    expect(state.rows).toHaveLength(2);
    expect(server.rowRequests()).toHaveLength(2);
  });

  it("asks nothing for a disabled branch", async () => {
    const server = serveTableCursor({ count: () => 5 });
    const { Wrapper } = setup();
    const { result } = renderHook(
      () => useCursorBranches("w1", [{ ...branch("todo"), enabled: false }]),
      { wrapper: Wrapper },
    );
    await settle();
    expect(server.rowBodies).toHaveLength(0);
    expect(result.current.byKey.get("todo")).toMatchObject({ isLoading: false, rows: [], hasMore: false });
  });
});
