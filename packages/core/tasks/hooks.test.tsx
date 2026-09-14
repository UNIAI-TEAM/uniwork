import { QueryClient, QueryClientProvider, type QueryKey } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TableFilter, TableRowsResult } from "../api/endpoints/tasks-table";
import { setAccessToken } from "../api/session";
import { configureRuntime, resetRuntimeConfig } from "../runtime-config";
import type { Task, TaskQueryPage } from "../types/task";
import { useCreateTask, useDeleteTask, useUpdateTask } from "./hooks";
import { useInfiniteMyTasks, useInfiniteQueryTasks } from "./hooks-suite";
import { taskKeys } from "./keys";
import { tableRowsPageBody, tableRowsPageQuery } from "./surface/table-query";

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
