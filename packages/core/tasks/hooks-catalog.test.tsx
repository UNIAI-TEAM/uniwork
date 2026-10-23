import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setAccessToken } from "../api/session";
import { configureRuntime, resetRuntimeConfig } from "../runtime-config";
import type { Task } from "../types/task";
import {
  patchTaskLabelCaches,
  rollbackTaskCacheWrites,
  useSetTaskPropertyValue,
  useUnsetTaskPropertyValue,
  withLabelSorted,
  withoutLabelId,
} from "./hooks-catalog";
import { taskKeys } from "./keys";
import { tableRowsPageBody, tableRowsPageQuery } from "./surface/table-query";
import type { TableRowLabel, TableRowsResult } from "../api/endpoints/tasks-table";

const WS = "ws1";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const failure = () => json({ error: { code: "internal", message: "boom" } }, 500);

function wrapperFor(qc: QueryClient) {
  function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  }
  return Wrapper;
}

function newClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
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
    properties: {},
    created_by: "u1",
    created_by_kind: "human",
    created_at: "2026-09-14T00:00:00Z",
    updated_at: "2026-09-14T00:00:00Z",
    ...over,
  };
}

/** The key one cached rows page sits under, built by the real body/key builders. */
function rowsKey(groupKey: string | null = "status:todo") {
  return tableRowsPageQuery(
    WS,
    tableRowsPageBody({
      query: {},
      groupBy: "status",
      hierarchy: false,
      groupKey,
      parentId: null,
      cursor: null,
      limit: 50,
    }),
  ).queryKey;
}

function rowsPage(tasks: Task[]): TableRowsResult {
  return {
    query_fingerprint: "f",
    group_key: null,
    parent_id: null,
    total: tasks.length,
    rows: tasks.map((t) => ({ task: t, direct_child_count: 0, labels: [] })),
    next_cursor: null,
  };
}

const rowsOf = (qc: QueryClient, key: readonly unknown[]) => qc.getQueryData<TableRowsResult>(key);

/** Every request goes through `respond`; the property PUT/DELETE can be held and released by the test. */
function serve(respond: (path: string, method: string) => Promise<Response> | Response) {
  vi.mocked(fetch).mockImplementation((input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    return Promise.resolve(respond(url.pathname, init?.method ?? "GET"));
  });
}

function holdPropertyRequest(method: "PUT" | "DELETE") {
  let release: (response: Response) => void = () => undefined;
  const held = new Promise<Response>((resolve) => {
    release = resolve;
  });
  serve((path, reqMethod) =>
    reqMethod === method && path.startsWith("/api/v1/tasks/") && path.includes("/properties/") ? held : failure(),
  );
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

describe("useSetTaskPropertyValue", () => {
  const A = task("A");
  const key = rowsKey();

  it("sets the value in every cached rows page and in the task detail before the request resolves", async () => {
    const qc = newClient();
    qc.setQueryData(key, rowsPage([A]));
    qc.setQueryData(taskKeys.detail("A"), A);
    const release = holdPropertyRequest("PUT");
    const { result } = renderHook(() => useSetTaskPropertyValue(WS), { wrapper: wrapperFor(qc) });

    act(() => result.current.mutate({ taskId: "A", propertyId: "p1", value: "high" }));

    await waitFor(() =>
      expect(rowsOf(qc, key)?.rows[0]?.task.properties).toEqual({ p1: "high" }),
    );
    expect(qc.getQueryData<Task>(taskKeys.detail("A"))?.properties).toEqual({ p1: "high" });

    release(json({ task: { ...A, properties: { p1: "high" } } }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it("restores the rows page and the detail cache when the server rejects the write", async () => {
    const qc = newClient();
    const before = rowsPage([A]);
    qc.setQueryData(key, before);
    qc.setQueryData(taskKeys.detail("A"), A);
    const release = holdPropertyRequest("PUT");
    const { result } = renderHook(() => useSetTaskPropertyValue(WS), { wrapper: wrapperFor(qc) });

    act(() => result.current.mutate({ taskId: "A", propertyId: "p1", value: "high" }));
    await waitFor(() =>
      expect(rowsOf(qc, key)?.rows[0]?.task.properties).toEqual({ p1: "high" }),
    );

    release(failure());
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(rowsOf(qc, key)).toStrictEqual(before);
    expect(qc.getQueryData<Task>(taskKeys.detail("A"))).toStrictEqual(A);
  });

  it("invalidates the table root and the task detail once the mutation settles", async () => {
    const qc = newClient();
    qc.setQueryData(key, rowsPage([A]));
    qc.setQueryData(taskKeys.detail("A"), A);
    serve((_path, method) => (method === "PUT" ? json({ task: { ...A, properties: { p1: "high" } } }) : failure()));
    const { result } = renderHook(() => useSetTaskPropertyValue(WS), { wrapper: wrapperFor(qc) });

    await act(async () => {
      await result.current.mutateAsync({ taskId: "A", propertyId: "p1", value: "high" });
    });

    expect(qc.getQueryState(key)?.isInvalidated).toBe(true);
    expect(qc.getQueryState(taskKeys.detail("A"))?.isInvalidated).toBe(true);
  });
});

describe("useUnsetTaskPropertyValue", () => {
  const A = task("A", { properties: { p1: "high" } });
  const key = rowsKey();

  it("removes the value from every cached rows page and the task detail before the request resolves", async () => {
    const qc = newClient();
    qc.setQueryData(key, rowsPage([A]));
    qc.setQueryData(taskKeys.detail("A"), A);
    const release = holdPropertyRequest("DELETE");
    const { result } = renderHook(() => useUnsetTaskPropertyValue(WS), { wrapper: wrapperFor(qc) });

    act(() => result.current.mutate({ taskId: "A", propertyId: "p1" }));

    await waitFor(() => expect(rowsOf(qc, key)?.rows[0]?.task.properties).toEqual({}));
    expect(qc.getQueryData<Task>(taskKeys.detail("A"))?.properties).toEqual({});

    release(json({ task: { ...A, properties: {} } }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it("restores the rows page and the detail cache when the server rejects the delete", async () => {
    const qc = newClient();
    const before = rowsPage([A]);
    qc.setQueryData(key, before);
    qc.setQueryData(taskKeys.detail("A"), A);
    const release = holdPropertyRequest("DELETE");
    const { result } = renderHook(() => useUnsetTaskPropertyValue(WS), { wrapper: wrapperFor(qc) });

    act(() => result.current.mutate({ taskId: "A", propertyId: "p1" }));
    await waitFor(() => expect(rowsOf(qc, key)?.rows[0]?.task.properties).toEqual({}));

    release(failure());
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(rowsOf(qc, key)).toStrictEqual(before);
    expect(qc.getQueryData<Task>(taskKeys.detail("A"))).toStrictEqual(A);
  });
});

describe("withLabelSorted / withoutLabelId", () => {
  it("inserts a label kept sorted by name, case-insensitively", () => {
    const zulu: TableRowLabel = { id: "l2", name: "Zulu", color: "#000000" };
    const bug: TableRowLabel = { id: "l1", name: "bug", color: "#ef4444" };
    expect(withLabelSorted([zulu], bug)).toEqual([bug, zulu]);
  });

  it("replaces an existing entry with the same id instead of duplicating it", () => {
    const before: TableRowLabel = { id: "l1", name: "Bug", color: "#ef4444" };
    const renamed: TableRowLabel = { id: "l1", name: "Bug (renamed)", color: "#ef4444" };
    expect(withLabelSorted([before], renamed)).toEqual([renamed]);
  });

  it("removes a label by id", () => {
    const bug: TableRowLabel = { id: "l1", name: "Bug", color: "#ef4444" };
    const frontend: TableRowLabel = { id: "l2", name: "Frontend", color: "#3b82f6" };
    expect(withoutLabelId([bug, frontend], "l1")).toEqual([frontend]);
  });
});

describe("patchTaskLabelCaches / rollbackTaskCacheWrites", () => {
  const A = task("A");
  const key = rowsKey();
  const bug: TableRowLabel = { id: "l1", name: "Bug", color: "#ef4444" };

  it("writes the task's labels in every cached rows page that holds it", () => {
    const qc = newClient();
    qc.setQueryData(key, rowsPage([A]));

    patchTaskLabelCaches(qc, WS, "A", (current) => withLabelSorted(current, bug));

    expect(rowsOf(qc, key)?.rows[0]?.labels).toEqual([bug]);
  });

  it("leaves another task's row in the same page untouched", () => {
    const qc = newClient();
    const B = task("B");
    qc.setQueryData(key, rowsPage([A, B]));

    patchTaskLabelCaches(qc, WS, "A", (current) => withLabelSorted(current, bug));

    expect(rowsOf(qc, key)?.rows[1]?.labels).toEqual([]);
  });

  it("restores a page nothing else has rewritten since", () => {
    const qc = newClient();
    const before = rowsPage([A]);
    qc.setQueryData(key, before);

    const writes = patchTaskLabelCaches(qc, WS, "A", (current) => withLabelSorted(current, bug));
    rollbackTaskCacheWrites(qc, writes);

    expect(rowsOf(qc, key)).toStrictEqual(before);
  });

  it("is a no-op once a later write has already replaced the page", () => {
    const qc = newClient();
    qc.setQueryData(key, rowsPage([A]));
    const writes = patchTaskLabelCaches(qc, WS, "A", (current) => withLabelSorted(current, bug));

    const settled = rowsPage([task("A", { title: "Renamed" })]);
    qc.setQueryData(key, settled);
    rollbackTaskCacheWrites(qc, writes);

    expect(rowsOf(qc, key)).toStrictEqual(settled);
  });
});
