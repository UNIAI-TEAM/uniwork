import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setAccessToken } from "../api/session";
import { configureRuntime, resetRuntimeConfig } from "../runtime-config";
import { useConvertMeetingActionItems, useDismissMeetingActionItem } from "./action-item-hooks";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const invalidate = vi.spyOn(qc, "invalidateQueries");
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  }
  const keys = () => invalidate.mock.calls.map((c) => JSON.stringify((c[0] as { queryKey: unknown }).queryKey));
  return { Wrapper, keys };
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

describe("useConvertMeetingActionItems", () => {
  const body = { items: [{ action_item_id: "a1", assignee_id: null, due_date: null, project_id: "" }] };
  const expected = [
    JSON.stringify(["meeting-action-items", "m1"]),
    JSON.stringify(["meeting-activity", "m1"]),
    JSON.stringify(["tasks", "ws1"]),
    JSON.stringify(["my-tasks", "ws1"]),
  ];

  it("refreshes the items, the timeline and the task collections after a conversion", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ links: [{ action_item_id: "a1", task_id: "t1" }] }));
    const { Wrapper, keys } = setup();
    const { result } = renderHook(() => useConvertMeetingActionItems("ws1", "m1"), { wrapper: Wrapper });
    act(() => result.current.mutate(body));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ links: [{ action_item_id: "a1", task_id: "t1" }] });
    expect(keys()).toEqual(expect.arrayContaining(expected));
  });

  it("refreshes them after a refusal too, since the list on screen is out of date", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({ error: { code: "action_item_not_pending", message: "x", fields: { action_item_ids: ["a1"] } } }, 409),
    );
    const { Wrapper, keys } = setup();
    const { result } = renderHook(() => useConvertMeetingActionItems("ws1", "m1"), { wrapper: Wrapper });
    act(() => result.current.mutate(body));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(keys()).toEqual(expect.arrayContaining(expected));
  });
});

describe("useDismissMeetingActionItem", () => {
  it("refreshes only the meeting's items", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ status: "ok" }));
    const { Wrapper, keys } = setup();
    const { result } = renderHook(() => useDismissMeetingActionItem("m1"), { wrapper: Wrapper });
    act(() => result.current.mutate({ itemId: "a1", reason: "" }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(keys()).toEqual([JSON.stringify(["meeting-action-items", "m1"])]);
  });
});
