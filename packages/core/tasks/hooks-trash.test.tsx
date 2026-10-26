import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setAccessToken } from "../api/session";
import { configureRuntime, resetRuntimeConfig } from "../runtime-config";
import { useRestoreProject, useRestoreTask } from "./hooks-trash";
import { taskKeys } from "./keys";

const WS = "ws1";
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, wrapper };
}
const invalidated = (qc: QueryClient, key: readonly unknown[]) =>
  qc.getQueryState(key)?.isInvalidated === true;

describe("trash hooks", () => {
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

  it("useRestoreTask invalidates lists, my-tasks, detail and the pins", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ trash_batch_id: "b1", ids: ["t1", "t2"] }));
    const { qc, wrapper } = setup();
    const keys = [
      taskKeys.list(WS),
      taskKeys.myTasks(WS),
      taskKeys.queryRoot(WS),
      taskKeys.tableRoot(WS),
      taskKeys.pins(WS),
      taskKeys.detail("t1"),
      taskKeys.detail("t2"),
    ];
    for (const k of keys) qc.setQueryData(k, {});
    const { result } = renderHook(() => useRestoreTask(WS), { wrapper });
    await act(async () => {
      await result.current.mutateAsync("t1");
    });
    for (const k of keys) expect(invalidated(qc, k)).toBe(true);
  });

  it("useRestoreProject invalidates projects, pins and task lists", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ status: "ok" }));
    const { qc, wrapper } = setup();
    const keys = [
      taskKeys.projects(WS),
      taskKeys.pins(WS),
      taskKeys.list(WS),
      taskKeys.queryRoot(WS),
    ];
    for (const k of keys) qc.setQueryData(k, {});
    const { result } = renderHook(() => useRestoreProject(WS), { wrapper });
    await act(async () => {
      await result.current.mutateAsync("p1");
    });
    for (const k of keys) expect(invalidated(qc, k)).toBe(true);
  });
});
