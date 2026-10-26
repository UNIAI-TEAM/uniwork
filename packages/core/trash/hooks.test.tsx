import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setAccessToken } from "../api/session";
import { useArchiveDocument, usePurgeDocument, useRestoreDocument } from "../documents/hooks-collections";
import { configureRuntime, resetRuntimeConfig } from "../runtime-config";
import { useDeleteTask } from "../tasks/hooks";
import { useDeleteProject } from "../tasks/hooks-projects";
import { useBatchDeleteTasks } from "../tasks/hooks-suite";
import { usePurgeProject, usePurgeTask, useRestoreProject, useRestoreTask } from "../tasks/hooks-trash";
import { useTrashList } from "./hooks";
import { trashKeys } from "./keys";

const WS = "ws1";
const archived = {
  document: {
    id: "d1",
    organization_id: "o1",
    workspace_id: "ws1",
    kind: "page",
    title: "Tài liệu",
    visibility: "workspace",
    revision: "1",
    current_version: 0,
    position: 0,
    created_by: "u1",
    created_by_kind: "human",
    updated_by: "u1",
    updated_by_kind: "human",
    created_at: "2026-09-27T09:00:00Z",
    updated_at: "2026-09-27T09:00:00Z",
  },
  batch_id: "b1",
  affected: ["d1"],
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, wrapper };
}

describe("shared trash hooks", () => {
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

  it("useTrashList follows next_cursor and keeps the filters in the request", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(json({ items: [], next_cursor: "c2" }))
      .mockResolvedValueOnce(json({ items: [], next_cursor: "" }));
    const { wrapper } = setup();
    const { result } = renderHook(() => useTrashList(WS, { kind: "task", q: "a" }), { wrapper });
    await waitFor(() => expect(result.current.data?.pages).toHaveLength(1));
    expect(result.current.hasNextPage).toBe(true);
    await act(async () => {
      await result.current.fetchNextPage();
    });
    const second = String(vi.mocked(fetch).mock.calls[1]![0]);
    expect(second).toContain("cursor=c2");
    expect(second).toContain("kind=task");
    expect(second).toContain("q=a");
    await waitFor(() => expect(result.current.hasNextPage).toBe(false));
  });

  it("a filter change is a different list under the same workspace root", () => {
    expect(trashKeys.list(WS, "a")).not.toEqual(trashKeys.list(WS, "b"));
    expect(trashKeys.list(WS, "a").slice(0, 2)).toEqual(trashKeys.workspace(WS));
  });

  type Mutation = { mutateAsync: (arg: unknown) => Promise<unknown> };
  it.each([
    ["useRestoreTask", () => useRestoreTask(WS), { trash_batch_id: "b", ids: ["t1"] }, "t1"],
    ["usePurgeTask", () => usePurgeTask(WS), {}, "t1"],
    ["useRestoreProject", () => useRestoreProject(WS), { status: "ok" }, "p1"],
    ["usePurgeProject", () => usePurgeProject(WS), {}, "p1"],
    ["useDeleteTask", () => useDeleteTask(WS), {}, "t1"],
    ["useBatchDeleteTasks", () => useBatchDeleteTasks(WS), { trash_batch_id: "b", ids: ["t1"] }, ["t1"]],
    ["useDeleteProject", () => useDeleteProject(WS), {}, "p1"],
    ["useRestoreDocument", () => useRestoreDocument(WS), archived, "d1"],
    ["usePurgeDocument", () => usePurgeDocument(WS), {}, "d1"],
    ["useArchiveDocument", () => useArchiveDocument(WS), archived, { documentId: "d1" }],
  ] as const)("%s invalidates the shared trash", async (_name, useHook, body, arg) => {
    vi.mocked(fetch).mockImplementation(() => Promise.resolve(json(body)));
    const { qc, wrapper } = setup();
    const key = trashKeys.list(WS, "x");
    qc.setQueryData(key, {});
    const { result } = renderHook(() => useHook() as unknown as Mutation, { wrapper });
    await act(async () => {
      // The answer may not verify for the document hooks; only the invalidation is under test.
      await result.current.mutateAsync(arg).catch(() => undefined);
    });
    await waitFor(() => expect(qc.getQueryState(key)?.isInvalidated).toBe(true));
  });
});
