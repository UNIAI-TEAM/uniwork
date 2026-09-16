import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TableFilter, TableGroupsResult, TableRowsResult } from "../api/endpoints/tasks-table";
import { setAccessToken } from "../api/session";
import { resetAuthStoreForTests, useAuthStore } from "../auth/store";
import { configureRuntime, resetRuntimeConfig } from "../runtime-config";
import type { Task } from "../types/task";
import type { User } from "../types/user";
import { useCreateTask, useDeleteTask, useUpdateTask } from "./hooks";
import { useInfiniteMyTasks, useInfiniteQueryTasks } from "./hooks-suite";
import { taskKeys } from "./keys";
import { useRecentTasksStore } from "./stores/recent-tasks-store";
import { tableGroupsBody, tableRowsPageBody, tableRowsPageQuery } from "./surface/table-query";

const WS = "ws1";
const USER: User = {
  id: "u1",
  email: "a@b.c",
  display_name: "A",
  onboarded_at: null,
  email_verified_at: "2026-08-25T00:00:00Z",
  onboarding_questionnaire: {},
  locale: "vi",
};

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
  resetAuthStoreForTests();
  useAuthStore.getState().setUser(USER);
  useRecentTasksStore.setState({ byWorkspace: {}, ownerId: null });
  vi.stubGlobal("fetch", vi.fn());
  configureRuntime({ apiUrl: "http://api.test" });
});
afterEach(() => {
  vi.unstubAllGlobals();
  resetRuntimeConfig();
  setAccessToken(null);
  resetAuthStoreForTests();
});

describe("useCreateTask", () => {
  it("rejects a malformed create response so callers do not treat it as success", async () => {
    serve((_path, method) =>
      method === "POST" ? json({ task: { nope: true } }) : failure(),
    );
    const { result } = renderHook(() => useCreateTask(WS), {
      wrapper: wrapperFor(newClient()),
    });

    await expect(
      act(async () => result.current.mutateAsync({ title: "New task" })),
    ).rejects.toThrow("task_create_response_invalid");
    expect(useRecentTasksStore.getState().byWorkspace[WS]).toBeUndefined();
  });

  it("forwards idempotency without putting it in the body, invalidates every task root, and records the task", async () => {
    const created = task("new", { identifier: "UNI-2", title: "New task" });
    serve((_path, method) =>
      method === "POST" ? json({ task: created }) : failure(),
    );
    const qc = newClient();
    const roots = [
      taskKeys.list(WS),
      taskKeys.queryRoot(WS),
      taskKeys.myTasks(WS),
      taskKeys.tableRoot(WS),
    ];
    for (const key of roots) qc.setQueryData(key, { seeded: true });
    const { result } = renderHook(() => useCreateTask(WS), {
      wrapper: wrapperFor(qc),
    });

    await act(async () => {
      await result.current.mutateAsync({
        title: "New task",
        status: "in_progress",
        project_id: "p1",
        idempotencyKey: "create-1",
      });
    });

    const init = vi.mocked(fetch).mock.calls[0]![1]!;
    expect(init.headers).toMatchObject({ "Idempotency-Key": "create-1" });
    expect(JSON.parse(init.body as string)).toEqual({
      title: "New task",
      status: "in_progress",
      project_id: "p1",
    });
    for (const key of roots) {
      expect(qc.getQueryState(key)?.isInvalidated).toBe(true);
    }
    expect(useRecentTasksStore.getState().byWorkspace[WS]?.[0]).toMatchObject({
      id: "new",
      identifier: "UNI-2",
      title: "New task",
    });
  });
});

/** The key one cached rows page sits under, built by the real body/key builders. */
function rowsKey(
  groupKey: string | null,
  opts: { groupBy?: string; filter?: TableFilter; cursor?: string | null } = {},
) {
  return tableRowsPageQuery(
    WS,
    tableRowsPageBody({
      query: { filter: opts.filter },
      groupBy: opts.groupBy ?? "status",
      hierarchy: false,
      groupKey,
      parentId: null,
      cursor: opts.cursor ?? null,
      limit: 50,
    }),
  ).queryKey;
}

function rowsPage(tasks: Task[], opts: { total?: number; nextCursor?: string | null } = {}): TableRowsResult {
  return {
    query_fingerprint: "f",
    group_key: null,
    parent_id: null,
    total: opts.total ?? tasks.length,
    rows: tasks.map((t) => ({ task: t, direct_child_count: 0, labels: [] })),
    next_cursor: opts.nextCursor ?? null,
  };
}

const rowsOf = (qc: QueryClient, key: readonly unknown[]) => qc.getQueryData<TableRowsResult>(key);
const idsOf = (qc: QueryClient, key: readonly unknown[]) => rowsOf(qc, key)?.rows.map((row) => row.task.id);

function groupsKey(opts: { groupBy?: string; filter?: TableFilter } = {}) {
  return taskKeys.tableGroups(
    WS,
    JSON.stringify(tableGroupsBody({ query: { filter: opts.filter }, groupBy: opts.groupBy ?? "status" })),
  );
}

/** Status groups in server order, counts as given; keys are `status:<value>` per the wire contract. */
function groupsResult(counts: Record<string, number>): TableGroupsResult {
  const keys = Object.keys(counts).sort();
  return {
    query_fingerprint: "g",
    total: keys.reduce((sum, key) => sum + counts[key]!, 0),
    groups: keys.map((key) => ({ key: `status:${key}`, value: { kind: "status", status: key }, count: counts[key]! })),
    next_cursor: null,
  };
}
const countsOf = (qc: QueryClient, key: readonly unknown[]) =>
  qc.getQueryData<TableGroupsResult>(key)?.groups.map((group) => [group.key, group.count]);

describe("useUpdateTask optimistic table caches (cursor contract)", () => {
  const A = task("A", { status: "todo", position: 1 });
  const B = task("B", { status: "todo", position: 2 });
  const C = task("C", { status: "done", position: 1 });
  const todoKey = rowsKey("status:todo");
  const doneKey = rowsKey("status:done");

  function mount(qc: QueryClient) {
    return renderHook(() => useUpdateTask(WS), { wrapper: wrapperFor(qc) }).result;
  }

  it("moves a dragged task into the target column's cached first page and moves status group counts, at once", async () => {
    const qc = newClient();
    qc.setQueryData(todoKey, rowsPage([A, B]));
    qc.setQueryData(doneKey, rowsPage([C]));
    const board = groupsKey();
    qc.setQueryData(board, groupsResult({ todo: 2, done: 1 }));
    const release = holdTaskPatch();
    const result = mount(qc);

    act(() => result.current.mutate({ taskId: "A", patch: { status: "done", position: 0.5 } }));

    await waitFor(() => expect(idsOf(qc, todoKey)).toEqual(["B"]));
    expect(idsOf(qc, doneKey)).toEqual(["A", "C"]);
    expect(countsOf(qc, board)).toEqual([
      ["status:done", 2],
      ["status:todo", 1],
    ]);

    release(json({ task: { ...A, status: "done", position: 0.5 } }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it("restores every table cache it wrote — rows pages and status groups — when the server rejects the move", async () => {
    const qc = newClient();
    const todoBefore = rowsPage([A, B]);
    const doneBefore = rowsPage([C]);
    qc.setQueryData(todoKey, todoBefore);
    qc.setQueryData(doneKey, doneBefore);
    const board = groupsKey();
    const boardBefore = groupsResult({ todo: 2, done: 1 });
    qc.setQueryData(board, boardBefore);
    const release = holdTaskPatch();
    const result = mount(qc);

    act(() => result.current.mutate({ taskId: "A", patch: { status: "done", position: 0.5 } }));
    await waitFor(() => expect(idsOf(qc, doneKey)).toEqual(["A", "C"]));

    release(failure());
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(rowsOf(qc, todoKey)).toStrictEqual(todoBefore);
    expect(rowsOf(qc, doneKey)).toStrictEqual(doneBefore);
    expect(qc.getQueryData(board)).toStrictEqual(boardBefore);
  });

  it("reorders a column's cached page at once when a task moves within that column", async () => {
    const qc = newClient();
    qc.setQueryData(todoKey, rowsPage([A, B]));
    const release = holdTaskPatch();
    const result = mount(qc);

    act(() => result.current.mutate({ taskId: "A", patch: { position: 3 } }));

    await waitFor(() => expect(idsOf(qc, todoKey)).toEqual(["B", "A"]));
    release(json({ task: { ...A, position: 3 } }));
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
