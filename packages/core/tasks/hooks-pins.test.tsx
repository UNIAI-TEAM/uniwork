import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setAccessToken } from "../api/session";
import type { TaskPinList } from "../api/endpoints/task-views";
import { configureRuntime, resetRuntimeConfig } from "../runtime-config";
import type { TaskPin } from "../types/task-view";
import { useCreatePin, useDeletePin, useReorderPins } from "./hooks-pins";
import { taskKeys } from "./keys";

const WS = "ws1";
const key = taskKeys.pins(WS);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const failure = () => json({ error: { code: "internal", message: "boom" } }, 500);

function pin(id: string, itemId: string, position: number, itemType = "task"): TaskPin {
  return {
    id,
    organization_id: "o1",
    workspace_id: WS,
    user_id: "u1",
    item_type: itemType,
    item_id: itemId,
    position,
    created_at: "2026-09-29T00:00:00Z",
    updated_at: "2026-09-29T00:00:00Z",
  };
}

const list = (pins: TaskPin[]): TaskPinList => ({ pins, total: pins.length });

function wrapperFor(qc: QueryClient) {
  function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  }
  return Wrapper;
}

function newClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}

type Call = { path: string; method: string; body: unknown };

/** Holds the first write (non-GET) request until the test releases it; GETs answer `refetch`. */
function serveHeld(refetch: () => Response) {
  const calls: Call[] = [];
  let release: (response: Response) => void = () => undefined;
  const held = new Promise<Response>((resolve) => {
    release = resolve;
  });
  vi.mocked(fetch).mockImplementation((input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = init?.method ?? "GET";
    calls.push({ path: url.pathname, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return method === "GET" ? Promise.resolve(refetch()) : held;
  });
  return { calls, release: (response: Response) => release(response) };
}

const cached = (qc: QueryClient) => qc.getQueryData<TaskPinList>(key)?.pins ?? [];

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

describe("useCreatePin", () => {
  it("lists the new pin at the end before the request resolves, then keeps the server's pin", async () => {
    const qc = newClient();
    qc.setQueryData(key, list([pin("p1", "t1", 1)]));
    const saved = pin("p2", "t2", 2);
    const { calls, release } = serveHeld(() => json(list([pin("p1", "t1", 1), saved])));
    const { result } = renderHook(() => useCreatePin(WS), { wrapper: wrapperFor(qc) });

    act(() => result.current.mutate({ item_type: "task", item_id: "t2" }));
    await waitFor(() => expect(cached(qc).map((p) => p.item_id)).toEqual(["t1", "t2"]));
    expect(calls[0]).toMatchObject({ method: "POST", body: { item_type: "task", item_id: "t2" } });

    release(json({ pin: saved }));
    await waitFor(() => expect(cached(qc).map((p) => p.id)).toEqual(["p1", "p2"]));
  });

  it("takes the pin back out when the server refuses it", async () => {
    const qc = newClient();
    qc.setQueryData(key, list([pin("p1", "t1", 1)]));
    const { release } = serveHeld(() => json(list([pin("p1", "t1", 1)])));
    const { result } = renderHook(() => useCreatePin(WS), { wrapper: wrapperFor(qc) });

    act(() => result.current.mutate({ item_type: "project", item_id: "pr1" }));
    await waitFor(() => expect(cached(qc)).toHaveLength(2));
    release(failure());
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(cached(qc).map((p) => p.item_id)).toEqual(["t1"]);
  });
});

describe("useDeletePin", () => {
  it("drops the pin before the request resolves, and restores it when the server refuses", async () => {
    const qc = newClient();
    qc.setQueryData(key, list([pin("p1", "t1", 1), pin("p2", "pr1", 2, "project")]));
    const { calls, release } = serveHeld(() => json(list([pin("p1", "t1", 1), pin("p2", "pr1", 2, "project")])));
    const { result } = renderHook(() => useDeletePin(WS), { wrapper: wrapperFor(qc) });

    act(() => result.current.mutate({ itemType: "project", itemId: "pr1" }));
    await waitFor(() => expect(cached(qc).map((p) => p.id)).toEqual(["p1"]));
    expect(calls[0]).toMatchObject({ method: "DELETE", path: `/api/v1/workspaces/${WS}/pins/project/pr1` });

    release(failure());
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(cached(qc).map((p) => p.id)).toEqual(["p1", "p2"]);
  });
});

describe("useReorderPins", () => {
  it("shows the new order at once and sends each pin's 1-based position", async () => {
    const qc = newClient();
    const a = pin("p1", "t1", 1);
    const b = pin("p2", "t2", 2);
    qc.setQueryData(key, list([a, b]));
    const { calls, release } = serveHeld(() => json(list([a, b])));
    const { result } = renderHook(() => useReorderPins(WS), { wrapper: wrapperFor(qc) });

    act(() => result.current.mutate([b, a]));
    await waitFor(() => expect(cached(qc).map((p) => p.id)).toEqual(["p2", "p1"]));
    expect(calls[0]).toMatchObject({
      method: "PUT",
      path: `/api/v1/workspaces/${WS}/pins/reorder`,
      body: { items: [{ id: "p2", position: 1 }, { id: "p1", position: 2 }] },
    });

    release(failure());
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(cached(qc).map((p) => p.id)).toEqual(["p1", "p2"]);
  });
});
