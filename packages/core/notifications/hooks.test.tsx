import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../runtime-config";
import { setAccessToken } from "../api/session";
import type { NotificationPage } from "../api/endpoints/notifications";
import type { UnreadCount } from "../types/notification";
import { notificationKeys, useArchive, useMarkAllRead, useMarkRead, useMarkUnread } from "./hooks";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const row = (id: string, read?: string) => ({
  id, kind: "task_assigned", workspace_id: "ws1", organization_id: "o1", resource_type: "task", resource_id: "t1",
  resource_deleted: false, actor_kind: "human", actor_id: "u1", title_key: "notifications.kind.task_assigned",
  params: {}, count: 1, created_at: "2026-09-06T08:00:00Z", ...(read ? { read_at: read } : {}),
});

function setup() {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  qc.setQueryData<NotificationPage>(notificationKeys.list("ws1", false), {
    notifications: [row("n1"), row("n2", "2026-09-06T09:00:00Z")],
    next_before: "",
  });
  qc.setQueryData<UnreadCount>(notificationKeys.unreadCount(), { total: 3, by_workspace: { ws1: 1, ws2: 2 } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  const list = () => qc.getQueryData<NotificationPage>(notificationKeys.list("ws1", false))!;
  const count = () => qc.getQueryData<UnreadCount>(notificationKeys.unreadCount())!;
  return { qc, wrapper, list, count };
}

describe("notification mutations", () => {
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

  it("marks read optimistically, moving the badge with the row, and refetches after", async () => {
    let resolve!: (r: Response) => void;
    vi.mocked(fetch).mockImplementation(() => new Promise<Response>((r) => (resolve = r)));
    const { wrapper, list, count } = setup();
    const { result } = renderHook(() => useMarkRead(), { wrapper });
    act(() => {
      result.current.mutate(["n1"]);
    });
    await waitFor(() => expect(list().notifications[0]!.read_at).toBeTruthy());
    expect(count()).toEqual({ total: 2, by_workspace: { ws1: 0, ws2: 2 } });
    resolve(json({ status: "ok" }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it("rolls back both the row and the badge when the API fails", async () => {
    vi.mocked(fetch).mockImplementation(() => Promise.resolve(json({ error: { code: "not_found" } }, 404)));
    const { wrapper, list, count } = setup();
    const { result } = renderHook(() => useMarkRead(), { wrapper });
    act(() => {
      result.current.mutate(["n1"]);
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(list().notifications[0]!.read_at).toBeUndefined();
    expect(count()).toEqual({ total: 3, by_workspace: { ws1: 1, ws2: 2 } });
  });

  it("mark unread raises the badge only for rows that were read", async () => {
    vi.mocked(fetch).mockImplementation(() => Promise.resolve(json({ status: "ok" })));
    const { wrapper, list, count } = setup();
    const { result } = renderHook(() => useMarkUnread(), { wrapper });
    act(() => {
      result.current.mutate(["n1", "n2"]);
    });
    await waitFor(() => expect(list().notifications[1]!.read_at).toBeUndefined());
    expect(count().total).toBe(4);
    expect(count().by_workspace.ws1).toBe(2);
  });

  it("mark all read for one workspace zeroes that workspace only", async () => {
    vi.mocked(fetch).mockImplementation(() => Promise.resolve(json({ status: "ok" })));
    const { wrapper, list, count } = setup();
    const { result } = renderHook(() => useMarkAllRead(), { wrapper });
    act(() => {
      result.current.mutate("ws1");
    });
    await waitFor(() => expect(list().notifications.every((n) => !!n.read_at)).toBe(true));
    expect(count()).toEqual({ total: 2, by_workspace: { ws1: 0, ws2: 2 } });
  });

  it("archive removes the row and an unread one leaves the badge", async () => {
    vi.mocked(fetch).mockImplementation(() => Promise.resolve(json({ status: "ok" })));
    const { wrapper, list, count } = setup();
    const { result } = renderHook(() => useArchive(), { wrapper });
    act(() => {
      result.current.mutate(["n1", "n2"]);
    });
    await waitFor(() => expect(list().notifications).toHaveLength(0));
    expect(count()).toEqual({ total: 2, by_workspace: { ws1: 0, ws2: 2 } });
  });
});
