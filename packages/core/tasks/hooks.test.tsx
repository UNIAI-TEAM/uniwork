import { QueryClient, QueryClientProvider, type QueryKey } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  tableGroups,
  type TableFilter,
  type TableGroupsResult,
  type TableRowsResult,
} from "../api/endpoints/tasks-table";
import { setAccessToken } from "../api/session";
import { configureRuntime, resetRuntimeConfig } from "../runtime-config";
import type { Task, TaskQueryPage } from "../types/task";
import { useCreateTask, useDeleteTask, useUpdateTask } from "./hooks";
import { useInfiniteMyTasks, useInfiniteQueryTasks } from "./hooks-suite";
import { taskKeys } from "./keys";
import { tableGroupsBody, tableRowsPageBody, tableRowsPageQuery } from "./surface/table-query";

const WS = "ws1";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const failure = () => json({ error: { code: "internal", message: "boom" } }, 500);

function newClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function wrapperFor(qc: QueryClient) {
  function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  }
  return Wrapper;
}

function task(id: string, over: Partial<Task> = {}): Task {
  return {
    id,
    organization_id: "o1",
    workspace_id: WS,
    number: 1,
    identifier: "",
    revision: 1,
    title: id,
    description: "",
    status: "todo",
    priority: "medium",
    assignee_id: "u1",
    assignee_kind: "human",
    project_id: "p1",
    position: 1,
    kind: "normal",
    created_by: "u1",
    created_by_kind: "human",
    created_at: "2026-09-14T00:00:00Z",
    updated_at: "2026-09-14T00:00:00Z",
    ...over,
  };
}

/** The key the board and the table view put one rows page under, built by their shared builder. */
function rowsKey(
  groupBy: string,
  groupKey: string | null,
  { offset = 0, filter }: { offset?: number; filter?: TableFilter } = {},
): QueryKey {
  return tableRowsPageQuery(
    WS,
    tableRowsPageBody({ filter, groupBy, groupKey, columns: ["title", "status"], limit: 50, offset }),
  ).queryKey;
}

function rowsPage(tasks: Task[], total = tasks.length): TableRowsResult {
  return {
    query_fingerprint: "f",
    group_key: null,
    parent_id: null,
    total,
    rows: tasks.map((t) => ({ task: t, direct_child_count: 0 })),
    branch_total: tasks.length,
    next_cursor: null,
  };
}

const rowsOf = (qc: QueryClient, key: QueryKey) => qc.getQueryData<TableRowsResult>(key);
const idsOf = (qc: QueryClient, key: QueryKey) => rowsOf(qc, key)?.rows.map((row) => row.task.id);

/** The body the board and the table view send for groups, and the key `useTableGroups` hashes it under. */
function groupsBodyFor({ groupBy = "status", filter }: { groupBy?: string; filter?: TableFilter } = {}) {
  return tableGroupsBody({ filter, groupBy, columns: ["title", "status"], limit: 50 });
}
const groupsKey = (options: { groupBy?: string; filter?: TableFilter } = {}): QueryKey =>
  taskKeys.tableGroups(WS, JSON.stringify(groupsBodyFor(options)));

/** Status groups in server order (`ORDER BY status`), counts as given. */
function groupsResult(counts: Record<string, number>): TableGroupsResult {
  const keys = Object.keys(counts).sort();
  return {
    query_fingerprint: "g",
    total: keys.reduce((sum, key) => sum + counts[key]!, 0),
    groups: keys.map((key) => ({ key, value: { kind: "status", status: key }, count: counts[key]! })),
    next_cursor: null,
  };
}
const countsOf = (qc: QueryClient, key: QueryKey) =>
  qc.getQueryData<TableGroupsResult>(key)?.groups.map((group) => [group.key, group.count]);

/** Every request goes through `respond`; the PATCH of a task can be held and released by the test. */
function serve(respond: (path: string, method: string) => Promise<Response> | Response) {
  vi.mocked(fetch).mockImplementation((input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    return Promise.resolve(respond(url.pathname, init?.method ?? "GET"));
  });
}

function holdTaskPatch() {
  let release: (response: Response) => void = () => undefined;
  const held = new Promise<Response>((resolve) => {
    release = resolve;
  });
  serve((path, method) => (method === "PATCH" && path.startsWith("/api/v1/tasks/") ? held : failure()));
  return (response: Response) => release(response);
}

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

describe("useUpdateTask optimistic table rows", () => {
  const A = task("A", { position: 1 });
  const B = task("B", { position: 2 });
  const C = task("C", { status: "done", position: 1 });
  const todoKey = rowsKey("status", "todo");
  const doneKey = rowsKey("status", "done");

  function seedBoard(qc: QueryClient) {
    const todo = rowsPage([A, B]);
    const done = rowsPage([C]);
    qc.setQueryData(todoKey, todo);
    qc.setQueryData(doneKey, done);
    return { todo, done };
  }

  function mount(qc: QueryClient) {
    return renderHook(() => useUpdateTask(WS), { wrapper: wrapperFor(qc) }).result;
  }

  it("moves a dragged task from its column's page into the target column's first page at once, counts included", async () => {
    const qc = newClient();
    seedBoard(qc);
    const queryPage: TaskQueryPage = { tasks: [A, B], total: 2, limit: 50, offset: 0 };
    const infinite = { pages: [queryPage], pageParams: [0] };
    qc.setQueryData(taskKeys.query(WS, "{}"), queryPage);
    qc.setQueryData(taskKeys.myTasksInfinite(WS, "{}"), infinite);
    const release = holdTaskPatch();
    const result = mount(qc);

    act(() => result.current.mutate({ taskId: "A", patch: { status: "done", position: 0.5 } }));

    await waitFor(() => expect(idsOf(qc, todoKey)).toEqual(["B"]));
    expect(idsOf(qc, doneKey)).toEqual(["A", "C"]);
    expect(rowsOf(qc, doneKey)?.rows[0]?.task).toMatchObject({ id: "A", status: "done", position: 0.5 });
    expect(rowsOf(qc, todoKey)).toMatchObject({ total: 1, branch_total: 1 });
    expect(rowsOf(qc, doneKey)).toMatchObject({ total: 2, branch_total: 2 });
    // Paged list entries are refreshed on settle, never patched.
    expect(qc.getQueryData(taskKeys.query(WS, "{}"))).toBe(queryPage);
    expect(qc.getQueryData(taskKeys.myTasksInfinite(WS, "{}"))).toBe(infinite);

    release(json({ task: { ...A, status: "done", position: 0.5 } }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it("puts every page it patched back exactly as it was when the server rejects the move", async () => {
    const qc = newClient();
    const { todo, done } = seedBoard(qc);
    const release = holdTaskPatch();
    const result = mount(qc);

    act(() => result.current.mutate({ taskId: "A", patch: { status: "done", position: 0.5 } }));
    await waitFor(() => expect(idsOf(qc, doneKey)).toEqual(["A", "C"]));

    release(failure());
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(rowsOf(qc, todoKey)).toStrictEqual(todo);
    expect(rowsOf(qc, doneKey)).toStrictEqual(done);
  });

  it("keeps the move on success and invalidates the table root, the list and the task", async () => {
    const qc = newClient();
    seedBoard(qc);
    const groupsKey = taskKeys.tableGroups(WS, "{}");
    qc.setQueryData(groupsKey, { query_fingerprint: "f", total: 3, groups: [], next_cursor: null });
    qc.setQueryData(taskKeys.list(WS), [A, B, C]);
    qc.setQueryData(taskKeys.detail("A"), A);
    const release = holdTaskPatch();
    const result = mount(qc);

    act(() => result.current.mutate({ taskId: "A", patch: { status: "done", position: 0.5 } }));
    await waitFor(() => expect(idsOf(qc, doneKey)).toEqual(["A", "C"]));
    release(json({ task: { ...A, status: "done", position: 0.5 } }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(idsOf(qc, todoKey)).toEqual(["B"]);
    expect(idsOf(qc, doneKey)).toEqual(["A", "C"]);
    for (const key of [todoKey, doneKey, groupsKey, taskKeys.list(WS), taskKeys.detail("A")]) {
      expect(qc.getQueryState(key)?.isInvalidated).toBe(true);
    }
  });

  it("reorders a column's page at once when a task moves within that column", async () => {
    const qc = newClient();
    seedBoard(qc);
    const release = holdTaskPatch();
    const result = mount(qc);

    act(() => result.current.mutate({ taskId: "A", patch: { position: 3 } }));

    await waitFor(() => expect(idsOf(qc, todoKey)).toEqual(["B", "A"]));
    expect(rowsOf(qc, todoKey)).toMatchObject({ total: 2, branch_total: 2 });
    release(json({ task: { ...A, position: 3 } }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it("adds the task only to a target page whose filter admits it, and leaves other filters' pages as they were", async () => {
    const qc = newClient();
    const D = task("D", { status: "done", project_id: "p2", position: 1 });
    const p1Todo = rowsKey("status", "todo", { filter: { project_ids: ["p1"] } });
    const p1Done = rowsKey("status", "done", { filter: { project_ids: ["p1"] } });
    const p2Done = rowsKey("status", "done", { filter: { project_ids: ["p2"] } });
    const statusFiltered = rowsKey("status", "done", { filter: { statuses: ["todo"] } });
    const p2Page = rowsPage([D]);
    const excludedPage = rowsPage([]);
    qc.setQueryData(p1Todo, rowsPage([A, B]));
    qc.setQueryData(p1Done, rowsPage([C]));
    qc.setQueryData(p2Done, p2Page);
    qc.setQueryData(statusFiltered, excludedPage);
    const release = holdTaskPatch();
    const result = mount(qc);

    act(() => result.current.mutate({ taskId: "A", patch: { status: "done", position: 0.5 } }));

    await waitFor(() => expect(idsOf(qc, p1Done)).toEqual(["A", "C"]));
    expect(qc.getQueryData(p2Done)).toBe(p2Page);
    expect(qc.getQueryData(statusFiltered)).toBe(excludedPage);
    release(json({ task: { ...A, status: "done", position: 0.5 } }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it("gives an offset-50 page of the target column no row, even when the position falls inside it", async () => {
    const qc = newClient();
    const firstPage = Array.from({ length: 50 }, (_, i) => task(`d${i}`, { status: "done", position: i }));
    const secondPage = Array.from({ length: 10 }, (_, i) => task(`d${50 + i}`, { status: "done", position: 50 + i }));
    const done0 = rowsKey("status", "done");
    const done50 = rowsKey("status", "done", { offset: 50 });
    qc.setQueryData(todoKey, rowsPage([A, B]));
    qc.setQueryData(done0, rowsPage(firstPage, 60));
    qc.setQueryData(done50, rowsPage(secondPage, 60));
    const release = holdTaskPatch();
    const result = mount(qc);

    act(() => result.current.mutate({ taskId: "A", patch: { status: "done", position: 55.5 } }));

    await waitFor(() => expect(idsOf(qc, todoKey)).toEqual(["B"]));
    expect(idsOf(qc, done0)).toEqual(firstPage.map((t) => t.id));
    expect(idsOf(qc, done50)).toEqual(secondPage.map((t) => t.id));
    // The column still gained a task on the server; only where it lands is unknown.
    expect(rowsOf(qc, done0)?.total).toBe(61);
    expect(rowsOf(qc, done50)?.total).toBe(61);
    release(json({ task: { ...A, status: "done", position: 55.5 } }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it("takes a reassigned task out of its assignee branch without placing it in the new one, and moves its card in the status pages", async () => {
    const qc = newClient();
    const E = task("E", { assignee_id: "u2", position: 1 });
    const u1 = rowsKey("assignee", "u1");
    const u2 = rowsKey("assignee", "u2");
    qc.setQueryData(todoKey, rowsPage([A, B]));
    qc.setQueryData(u1, rowsPage([A]));
    qc.setQueryData(u2, rowsPage([E]));
    const release = holdTaskPatch();
    const result = mount(qc);

    act(() =>
      result.current.mutate({
        taskId: "A",
        patch: { assignee_id: "u2", assignee_kind: "human", position: 2.5 },
      }),
    );

    await waitFor(() => expect(idsOf(qc, u1)).toEqual([]));
    expect(rowsOf(qc, u1)?.total).toBe(0);
    expect(idsOf(qc, u2)).toEqual(["E"]);
    expect(rowsOf(qc, u2)?.total).toBe(2);
    // An assignee board regroups the status pages it loaded, so the card follows its new assignee.
    expect(idsOf(qc, todoKey)).toEqual(["B", "A"]);
    expect(rowsOf(qc, todoKey)?.rows[1]?.task.assignee_id).toBe("u2");
    release(json({ task: { ...A, assignee_id: "u2", position: 2.5 } }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it("does not let a page fetch that was in flight overwrite the move", async () => {
    const qc = newClient();
    const { todo } = seedBoard(qc);
    let releaseRows: (response: Response) => void = () => undefined;
    const heldRows = new Promise<Response>((resolve) => {
      releaseRows = resolve;
    });
    let releasePatch: (response: Response) => void = () => undefined;
    const heldPatch = new Promise<Response>((resolve) => {
      releasePatch = resolve;
    });
    serve((path, method) => {
      if (path.endsWith("/tasks/table/rows")) return heldRows;
      if (method === "PATCH") return heldPatch;
      return failure();
    });
    const inFlight = qc
      .fetchQuery(
        tableRowsPageQuery(
          WS,
          tableRowsPageBody({ groupBy: "status", groupKey: "todo", columns: ["title", "status"], limit: 50, offset: 0 }),
        ),
      )
      .catch(() => undefined);
    const result = mount(qc);

    act(() => result.current.mutate({ taskId: "A", patch: { status: "done", position: 0.5 } }));
    await waitFor(() => expect(idsOf(qc, todoKey)).toEqual(["B"]));
    releaseRows(json(todo));
    await inFlight;

    expect(idsOf(qc, todoKey)).toEqual(["B"]);
    releasePatch(json({ task: { ...A, status: "done", position: 0.5 } }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });
});

describe("useUpdateTask optimistic table rows, edge pages", () => {
  const A = task("A", { position: 1 });
  const B = task("B", { position: 2 });
  const C = task("C", { status: "done", position: 1 });
  const todoKey = rowsKey("status", "todo");
  const doneKey = rowsKey("status", "done");

  function mount(qc: QueryClient) {
    return renderHook(() => useUpdateTask(WS), { wrapper: wrapperFor(qc) }).result;
  }

  it("takes the moved task from its newest copy when an older copy is cached ahead of it", async () => {
    const qc = newClient();
    // An inactive ungrouped table page from before another member's edits, cached first.
    const stale = task("A", { revision: 1, status: "in_progress", title: "old title", position: 1 });
    const fresh = task("A", { revision: 3, title: "new title", position: 1 });
    qc.setQueryData(rowsKey("status", null), rowsPage([stale]));
    qc.setQueryData(todoKey, rowsPage([fresh, B]));
    qc.setQueryData(doneKey, rowsPage([C]));
    const board = groupsKey();
    qc.setQueryData(board, groupsResult({ done: 1, in_progress: 1, todo: 2 }));
    const release = holdTaskPatch();
    const result = mount(qc);

    act(() => result.current.mutate({ taskId: "A", patch: { status: "done", position: 0.5 } }));

    await waitFor(() => expect(idsOf(qc, doneKey)).toEqual(["A", "C"]));
    expect(rowsOf(qc, doneKey)?.rows[0]?.task).toMatchObject({ revision: 3, title: "new title", status: "done" });
    expect(countsOf(qc, board)).toEqual([
      ["done", 2],
      ["in_progress", 1],
      ["todo", 1],
    ]);
    release(json({ task: { ...fresh, status: "done", position: 0.5 } }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it("puts a task dropped below the last card of a column of exactly one page at the end of that page", async () => {
    const qc = newClient();
    const fifty = Array.from({ length: 50 }, (_, i) => task(`d${i}`, { status: "done", position: i }));
    qc.setQueryData(todoKey, rowsPage([A, B]));
    qc.setQueryData(doneKey, rowsPage(fifty));
    const release = holdTaskPatch();
    const result = mount(qc);

    act(() => result.current.mutate({ taskId: "A", patch: { status: "done", position: 100 } }));

    await waitFor(() => expect(idsOf(qc, todoKey)).toEqual(["B"]));
    expect(idsOf(qc, doneKey)).toEqual([...fifty.map((t) => t.id), "A"]);
    expect(rowsOf(qc, doneKey)).toMatchObject({ total: 51, branch_total: 51 });
    release(json({ task: { ...A, status: "done", position: 100 } }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it("refreshes the task in place on ungrouped pages, where a filter alone decides membership and the count", async () => {
    const qc = newClient();
    const all = rowsKey("status", null);
    const todoOnly = rowsKey("status", null, { filter: { statuses: ["todo"] } });
    const doneOnly = rowsKey("status", null, { filter: { statuses: ["done"] } });
    qc.setQueryData(all, rowsPage([A, B]));
    qc.setQueryData(todoOnly, rowsPage([A, B]));
    qc.setQueryData(doneOnly, rowsPage([C]));
    const release = holdTaskPatch();
    const result = mount(qc);

    act(() => result.current.mutate({ taskId: "A", patch: { status: "done", position: 5 } }));

    await waitFor(() => expect(idsOf(qc, todoOnly)).toEqual(["B"]));
    // No branch order to follow: the row stays where it was.
    expect(idsOf(qc, all)).toEqual(["A", "B"]);
    expect(rowsOf(qc, all)?.rows[0]?.task).toMatchObject({ status: "done", position: 5 });
    expect(rowsOf(qc, all)?.total).toBe(2);
    expect(rowsOf(qc, todoOnly)).toMatchObject({ total: 1, branch_total: 1 });
    // The filter now admits the task, but where it lands is unknown: counted, not placed.
    expect(idsOf(qc, doneOnly)).toEqual(["C"]);
    expect(rowsOf(qc, doneOnly)?.total).toBe(2);
    release(json({ task: { ...A, status: "done", position: 5 } }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  describe("a later page of the task's column, which does not hold the task", () => {
    const first = [A, ...Array.from({ length: 49 }, (_, i) => task(`t${i}`, { position: 2 + i }))];
    const later = Array.from({ length: 10 }, (_, i) => task(`t${49 + i}`, { position: 51 + i }));
    const todo50 = rowsKey("status", "todo", { offset: 50 });

    function seedColumn(qc: QueryClient) {
      qc.setQueryData(todoKey, rowsPage(first, 60));
      const laterPage = rowsPage(later, 60);
      qc.setQueryData(todo50, laterPage);
      qc.setQueryData(doneKey, rowsPage([C]));
      return laterPage;
    }

    it("keeps its total when the task moves within the column", async () => {
      const qc = newClient();
      const laterPage = seedColumn(qc);
      const release = holdTaskPatch();
      const result = mount(qc);

      act(() => result.current.mutate({ taskId: "A", patch: { position: 10.5 } }));

      await waitFor(() => expect(idsOf(qc, todoKey)?.[0]).toBe("t0"));
      expect(qc.getQueryData(todo50)).toBe(laterPage);
      expect(rowsOf(qc, todoKey)?.total).toBe(60);
      release(json({ task: { ...A, position: 10.5 } }));
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
    });

    it("lowers its total when the task leaves the column", async () => {
      const qc = newClient();
      seedColumn(qc);
      const release = holdTaskPatch();
      const result = mount(qc);

      act(() => result.current.mutate({ taskId: "A", patch: { status: "done", position: 0.5 } }));

      await waitFor(() => expect(idsOf(qc, doneKey)).toEqual(["A", "C"]));
      expect(idsOf(qc, todo50)).toEqual(later.map((t) => t.id));
      expect(rowsOf(qc, todo50)?.total).toBe(59);
      expect(rowsOf(qc, todoKey)?.total).toBe(59);
      release(json({ task: { ...A, status: "done", position: 0.5 } }));
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
    });
  });
});

describe("useUpdateTask optimistic table groups", () => {
  const A = task("A", { position: 1 });
  const B = task("B", { position: 2 });
  const C = task("C", { status: "done", position: 1 });
  const todoKey = rowsKey("status", "todo");
  const doneKey = rowsKey("status", "done");

  function mount(qc: QueryClient) {
    return renderHook(() => useUpdateTask(WS), { wrapper: wrapperFor(qc) }).result;
  }

  it("moves one from the source column's count to the target's at once, as far as each filter admits the task", async () => {
    const qc = newClient();
    qc.setQueryData(todoKey, rowsPage([A, B]));
    qc.setQueryData(doneKey, rowsPage([C]));
    const board = groupsKey();
    qc.setQueryData(board, groupsResult({ done: 1, todo: 2 }));
    // The target group is missing (added in server order) and the source group empties (dropped).
    const p1 = groupsKey({ filter: { project_ids: ["p1"] } });
    qc.setQueryData(p1, groupsResult({ backlog: 1, todo: 1 }));
    // A filter the task leaves only loses it.
    const todoOnly = groupsKey({ filter: { statuses: ["todo"] } });
    qc.setQueryData(todoOnly, groupsResult({ todo: 2 }));
    // A filter that never admits the task, and a grouping that is not by status, stay as they are.
    const p2 = groupsKey({ filter: { project_ids: ["p2"] } });
    const p2Groups = groupsResult({ todo: 4 });
    qc.setQueryData(p2, p2Groups);
    const byAssignee = groupsKey({ groupBy: "assignee" });
    const assigneeGroups: TableGroupsResult = {
      query_fingerprint: "g",
      total: 2,
      groups: [{ key: "u1", value: { kind: "assignee", actor: { type: "human", id: "u1" } }, count: 2 }],
      next_cursor: null,
    };
    qc.setQueryData(byAssignee, assigneeGroups);
    const release = holdTaskPatch();
    const result = mount(qc);

    act(() => result.current.mutate({ taskId: "A", patch: { status: "done", position: 0.5 } }));

    await waitFor(() =>
      expect(countsOf(qc, board)).toEqual([
        ["done", 2],
        ["todo", 1],
      ]),
    );
    expect(qc.getQueryData<TableGroupsResult>(board)?.total).toBe(3);
    expect(qc.getQueryData(p1)).toEqual({
      query_fingerprint: "g",
      total: 2,
      groups: [
        { key: "backlog", value: { kind: "status", status: "backlog" }, count: 1 },
        { key: "done", value: { kind: "status", status: "done" }, count: 1 },
      ],
      next_cursor: null,
    });
    expect(qc.getQueryData(todoOnly)).toMatchObject({ total: 1, groups: [{ key: "todo", count: 1 }] });
    expect(qc.getQueryData(p2)).toBe(p2Groups);
    expect(qc.getQueryData(byAssignee)).toBe(assigneeGroups);
    release(json({ task: { ...A, status: "done", position: 0.5 } }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it("puts every groups entry it patched back when the server rejects the move", async () => {
    const qc = newClient();
    qc.setQueryData(todoKey, rowsPage([A, B]));
    const board = groupsKey();
    const before = groupsResult({ todo: 2 });
    qc.setQueryData(board, before);
    const release = holdTaskPatch();
    const result = mount(qc);

    act(() => result.current.mutate({ taskId: "A", patch: { status: "done", position: 0.5 } }));
    await waitFor(() =>
      expect(countsOf(qc, board)).toEqual([
        ["done", 1],
        ["todo", 1],
      ]),
    );

    release(failure());
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(qc.getQueryData(board)).toStrictEqual(before);
  });

  it("seeds the first page of an empty target column, under the key the board asks for", async () => {
    const qc = newClient();
    qc.setQueryData(todoKey, rowsPage([A, B], 2));
    qc.setQueryData(groupsKey(), groupsResult({ todo: 2 }));
    // A target column with tasks but no loaded page (a hidden column) gets no one-task page.
    const p1 = { project_ids: ["p1"] };
    qc.setQueryData(groupsKey({ filter: p1 }), groupsResult({ done: 3, todo: 2 }));
    // Nor does a filter that does not admit the task.
    const p2 = { project_ids: ["p2"] };
    qc.setQueryData(groupsKey({ filter: p2 }), groupsResult({ todo: 1 }));
    const release = holdTaskPatch();
    const result = mount(qc);

    act(() => result.current.mutate({ taskId: "A", patch: { status: "done", position: 0.5 } }));

    await waitFor(() => expect(idsOf(qc, doneKey)).toEqual(["A"]));
    expect(rowsOf(qc, doneKey)).toMatchObject({
      group_key: "done",
      parent_id: null,
      total: 1,
      branch_total: 1,
      next_cursor: null,
      rows: [{ task: { id: "A", status: "done", position: 0.5 }, direct_child_count: 0 }],
    });
    // Byte for byte the body useBoardColumnsData sends for that column's first page.
    expect(doneKey[3]).toBe(
      '{"group_by":"status","group_key":"done","columns":["title","status"],"limit":50,"offset":0}',
    );
    expect(qc.getQueryState(rowsKey("status", "done", { filter: p1 }))).toBeUndefined();
    expect(qc.getQueryState(rowsKey("status", "done", { filter: p2 }))).toBeUndefined();
    expect(
      qc.getQueryCache().findAll({ queryKey: taskKeys.tableRows(WS, "").slice(0, -1) }),
    ).toHaveLength(2);
    release(json({ task: { ...A, status: "done", position: 0.5 } }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(idsOf(qc, doneKey)).toEqual(["A"]);
  });

  it("removes the page it seeded when the server rejects the move", async () => {
    const qc = newClient();
    const todo = rowsPage([A, B]);
    qc.setQueryData(todoKey, todo);
    qc.setQueryData(groupsKey(), groupsResult({ todo: 2 }));
    const release = holdTaskPatch();
    const result = mount(qc);

    act(() => result.current.mutate({ taskId: "A", patch: { status: "done", position: 0.5 } }));
    await waitFor(() => expect(idsOf(qc, doneKey)).toEqual(["A"]));

    release(failure());
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(qc.getQueryState(doneKey)).toBeUndefined();
    expect(rowsOf(qc, todoKey)).toStrictEqual(todo);
  });

  it("leaves every entry that refetched while the save was out as the server sent it when the save fails", async () => {
    const qc = newClient();
    const D = task("D", { status: "in_progress", position: 1 });
    const E = task("E", { position: 3 });
    const F = task("F", { status: "in_progress", position: 2 });
    const inProgressKey = rowsKey("status", "in_progress");
    const board = groupsKey();
    qc.setQueryData(todoKey, rowsPage([A, B]));
    const done = rowsPage([C]);
    qc.setQueryData(doneKey, done);
    // A page the move does not change.
    qc.setQueryData(inProgressKey, rowsPage([D]));
    qc.setQueryData(board, groupsResult({ done: 1, in_progress: 1, todo: 2 }));
    // Another member's writes, which the refetches below bring in.
    const newer: Record<string, TableRowsResult> = {
      todo: rowsPage([B, E]),
      in_progress: rowsPage([D, F]),
    };
    const newerGroups = groupsResult({ done: 1, in_progress: 2, todo: 2 });
    let releasePatch: (response: Response) => void = () => undefined;
    const heldPatch = new Promise<Response>((resolve) => {
      releasePatch = resolve;
    });
    vi.mocked(fetch).mockImplementation((input, init) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      if (init?.method === "PATCH") return heldPatch;
      if (url.pathname.endsWith("/tasks/table/groups")) return Promise.resolve(json(newerGroups));
      if (url.pathname.endsWith("/tasks/table/rows")) {
        const body = JSON.parse(String(init?.body)) as { group_key: string };
        return Promise.resolve(json(newer[body.group_key]));
      }
      return Promise.resolve(failure());
    });
    const result = mount(qc);

    act(() => result.current.mutate({ taskId: "A", patch: { status: "done", position: 0.5 } }));
    await waitFor(() => expect(idsOf(qc, doneKey)).toEqual(["A", "C"]));
    const rowsPageOf = (groupKey: string) =>
      tableRowsPageQuery(
        WS,
        tableRowsPageBody({ groupBy: "status", groupKey, columns: ["title", "status"], limit: 50, offset: 0 }),
      );
    await act(async () => {
      await qc.fetchQuery(rowsPageOf("todo"));
      await qc.fetchQuery(rowsPageOf("in_progress"));
      await qc.fetchQuery({ queryKey: board, queryFn: () => tableGroups(WS, groupsBodyFor()) });
    });
    expect(idsOf(qc, todoKey)).toEqual(["B", "E"]);

    releasePatch(failure());
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(idsOf(qc, todoKey)).toEqual(["B", "E"]);
    expect(idsOf(qc, inProgressKey)).toEqual(["D", "F"]);
    expect(countsOf(qc, board)).toEqual([
      ["done", 1],
      ["in_progress", 2],
      ["todo", 2],
    ]);
    // Not refetched: back to what it was.
    expect(rowsOf(qc, doneKey)).toStrictEqual(done);
  });
});

describe("useUpdateTask optimistic list", () => {
  it("patches the task in the workspace list at once and restores the list when the server rejects it", async () => {
    const qc = newClient();
    const list = [task("A"), task("B")];
    qc.setQueryData(taskKeys.list(WS), list);
    const release = holdTaskPatch();
    const { result } = renderHook(() => useUpdateTask(WS), { wrapper: wrapperFor(qc) });

    act(() => result.current.mutate({ taskId: "A", patch: { status: "done" } }));
    await waitFor(() =>
      expect(qc.getQueryData<Task[]>(taskKeys.list(WS))?.map((t) => t.status)).toEqual(["done", "todo"]),
    );

    release(failure());
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(qc.getQueryData(taskKeys.list(WS))).toEqual(list);
  });
});

describe("local task writes refresh the paged task lists", () => {
  /**
   * A server for one task: the query and my-tasks pages record `root@offset`,
   * writes record `METHOD path`. No realtime client exists in these tests, so
   * any refetch comes from the mutation itself.
   */
  function servePagedLists(): string[] {
    const seen: string[] = [];
    const row = task("t1");
    vi.mocked(fetch).mockImplementation((input, init) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      const method = init?.method ?? "GET";
      const page = (offset: number) => json({ tasks: [row], total: 1, limit: 50, offset });
      if (url.pathname.endsWith("/tasks/query")) {
        const offset = Number((JSON.parse(String(init?.body)) as { offset: number }).offset);
        seen.push(`query@${offset}`);
        return Promise.resolve(page(offset));
      }
      if (url.pathname.endsWith("/my-tasks")) {
        const offset = Number(url.searchParams.get("offset"));
        seen.push(`my-tasks@${offset}`);
        return Promise.resolve(page(offset));
      }
      seen.push(`${method} ${url.pathname}`);
      if (method === "DELETE") return Promise.resolve(new Response(null, { status: 204 }));
      return Promise.resolve(json({ task: row }));
    });
    return seen;
  }

  async function mountLists(qc: QueryClient) {
    const { result } = renderHook(
      () => ({
        query: useInfiniteQueryTasks(WS, {}),
        mine: useInfiniteMyTasks(WS, {}),
        update: useUpdateTask(WS),
        create: useCreateTask(WS),
        remove: useDeleteTask(WS),
      }),
      { wrapper: wrapperFor(qc) },
    );
    await waitFor(() => expect(result.current.query.isSuccess && result.current.mine.isSuccess).toBe(true));
    return result;
  }

  /** Requests made by `write` and by whatever it invalidated, once nothing is fetching. */
  async function requestsDuring(qc: QueryClient, seen: string[], write: () => Promise<unknown>) {
    seen.length = 0;
    await act(async () => {
      await write();
    });
    await waitFor(() => expect(qc.isFetching()).toBe(0));
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 50)));
    return [...seen].sort();
  }

  it("useUpdateTask refetches the query and my-tasks pages once each", async () => {
    const seen = servePagedLists();
    const qc = newClient();
    const result = await mountLists(qc);

    const requests = await requestsDuring(qc, seen, () =>
      result.current.update.mutateAsync({ taskId: "t1", patch: { title: "renamed" } }),
    );

    expect(requests).toEqual(["PATCH /api/v1/tasks/t1", "my-tasks@0", "query@0"]);
  });

  it("useCreateTask refetches the query and my-tasks pages once each", async () => {
    const seen = servePagedLists();
    const qc = newClient();
    const result = await mountLists(qc);

    const requests = await requestsDuring(qc, seen, () => result.current.create.mutateAsync({ title: "new" }));

    expect(requests).toEqual(["POST /api/v1/workspaces/ws1/tasks", "my-tasks@0", "query@0"]);
  });

  it("useDeleteTask refetches the query and my-tasks pages once each", async () => {
    const seen = servePagedLists();
    const qc = newClient();
    const result = await mountLists(qc);

    const requests = await requestsDuring(qc, seen, () => result.current.remove.mutateAsync("t1"));

    expect(requests).toEqual(["DELETE /api/v1/tasks/t1", "my-tasks@0", "query@0"]);
  });
});
