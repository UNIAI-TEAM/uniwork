import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/http";
import { setAccessToken } from "../api/session";
import { configureRuntime, resetRuntimeConfig } from "../runtime-config";
import { summaryQueryRetry, useCreateTasksFromSummary } from "./summary-hooks";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function newClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}

function wrapperFor(qc: QueryClient) {
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  }
  return Wrapper;
}

const keysCalled = (spy: { mock: { calls: unknown[][] } }) =>
  spy.mock.calls.map((c) => JSON.stringify((c[0] as { queryKey: unknown }).queryKey));

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

describe("summaryQueryRetry", () => {
  it("gives up at once on a 4xx and retries a 5xx or a dropped connection a few times", () => {
    expect(summaryQueryRetry(0, new ApiError("no", "forbidden", 403))).toBe(false);
    expect(summaryQueryRetry(0, new ApiError("boom", "internal", 500))).toBe(true);
    expect(summaryQueryRetry(0, new TypeError("Failed to fetch"))).toBe(true);
    expect(summaryQueryRetry(3, new ApiError("boom", "internal", 500))).toBe(false);
  });
});

describe("useCreateTasksFromSummary", () => {
  const body = { summary_id: "s1", items: [{ index: 0, assignee_id: null, due_date: null, project_id: "" }] };
  const expected = [
    JSON.stringify(["meeting-summary", "m1"]),
    JSON.stringify(["meeting-activity", "m1"]),
    JSON.stringify(["tasks", "ws1"]),
    JSON.stringify(["tasks-query", "ws1"]),
    JSON.stringify(["my-tasks", "ws1"]),
    JSON.stringify(["tasks-table", "ws1"]),
  ];

  it("refreshes the summary, the timeline and every task collection after a create", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ task_ids: ["t1"], items: [{ index: 0, task_id: "t1" }] }));
    const qc = newClient();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useCreateTasksFromSummary("ws1", "m1"), { wrapper: wrapperFor(qc) });

    act(() => {
      result.current.mutate(body);
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ task_ids: ["t1"], items: [{ index: 0, task_id: "t1" }] });
    expect(keysCalled(invalidate)).toEqual(expect.arrayContaining(expected));
  });

  it("refreshes them after a refusal too, since the summary on screen is out of date", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({ error: { code: "summary_item_already_converted", message: "x", fields: { indexes: [0] } } }, 409),
    );
    const qc = newClient();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useCreateTasksFromSummary("ws1", "m1"), { wrapper: wrapperFor(qc) });

    act(() => {
      result.current.mutate(body);
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(keysCalled(invalidate)).toEqual(expect.arrayContaining(expected));
  });
});
