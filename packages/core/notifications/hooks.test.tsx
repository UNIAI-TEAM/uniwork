import { QueryClient, QueryClientProvider, type InfiniteData } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../runtime-config";
import { setAccessToken } from "../api/session";
import type { NotificationPage } from "../api/endpoints/notifications";
import type { Notification, UnreadCount } from "../types/notification";
import {
  notificationKeys,
  useArchive,
  useDocumentNoticePage,
  useMarkAllRead,
  useMarkRead,
  useMarkUnread,
  useNotificationDocuments,
  useNotificationPages,
} from "./hooks";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const row = (id: string, read?: string): Notification => ({
  id, kind: "task_assigned", workspace_id: "ws1", organization_id: "o1", resource_type: "task", resource_id: "t1",
  resource_deleted: false, resource_access_lost: false, comment_deleted: false, actor_kind: "human", actor_id: "u1", title_key: "notifications.kind.task_assigned",
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

  it("patches and prunes the inbox's paged entry the same way", async () => {
    vi.mocked(fetch).mockImplementation(() => Promise.resolve(json({ status: "ok" })));
    const { qc, wrapper, count } = setup();
    const key = notificationKeys.pages("ws1", false);
    qc.setQueryData<InfiniteData<NotificationPage, string>>(key, {
      pages: [
        { notifications: [row("n1")], next_before: "n1" },
        { notifications: [row("n3")], next_before: "" },
      ],
      pageParams: ["", "n1"],
    });
    const pages = () => qc.getQueryData<InfiniteData<NotificationPage, string>>(key)!.pages;
    const read = renderHook(() => useMarkRead(), { wrapper }).result;
    act(() => {
      read.current.mutate(["n3"]);
    });
    await waitFor(() => expect(pages()[1]!.notifications[0]!.read_at).toBeTruthy());
    expect(count().by_workspace.ws1).toBe(0);
    const archive = renderHook(() => useArchive(), { wrapper }).result;
    act(() => {
      archive.current.mutate(["n1"]);
    });
    await waitFor(() => expect(pages()[0]!.notifications).toHaveLength(0));
    expect(pages()[1]!.notifications).toHaveLength(1);
  });
});

describe("useNotificationPages", () => {
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

  it("follows next_before until a page comes back without one", async () => {
    vi.mocked(fetch).mockImplementation((input) =>
      Promise.resolve(
        String(input).includes("before=n1")
          ? json({ notifications: [row("n2")], next_before: "" })
          : json({ notifications: [row("n1")], next_before: "n1" }),
      ),
    );
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useNotificationPages({ workspaceId: "ws1", pageSize: 1 }), { wrapper });
    await waitFor(() => expect(result.current.hasNextPage).toBe(true));
    expect(String(vi.mocked(fetch).mock.calls[0]![0])).toContain("workspace_id=ws1&limit=1");
    await act(() => result.current.fetchNextPage());
    await waitFor(() =>
      expect(result.current.data?.pages.flatMap((p) => p.notifications.map((n) => n.id))).toEqual(["n1", "n2"]),
    );
    expect(result.current.hasNextPage).toBe(false);
  });
});

describe("useDocumentNoticePage", () => {
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

  const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapperOf = (qc: QueryClient) =>
    function Wrapper({ children }: { children: React.ReactNode }) {
      return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
    };

  it("stays cold until enabled, then reads the first page fresh whatever the Inbox cached", async () => {
    vi.mocked(fetch).mockResolvedValue(json({ notifications: [row("n9")], next_before: "" }));
    const qc = client();
    qc.setQueryData<NotificationPage>(notificationKeys.list("ws1", false), { notifications: [row("n1")], next_before: "" });
    const wrapper = wrapperOf(qc);
    const { result, rerender } = renderHook(({ enabled }) => useDocumentNoticePage({ workspaceId: "ws1", documentId: "d1", enabled }), {
      wrapper,
      initialProps: { enabled: false },
    });
    expect(fetch).not.toHaveBeenCalled();
    rerender({ enabled: true });
    await waitFor(() => expect(result.current.data?.notifications.map((n) => n.id)).toEqual(["n9"]));
    expect(String(vi.mocked(fetch).mock.calls[0]![0])).toContain("workspace_id=ws1&limit=50");
  });

  it("does not retry a failure: the page reads it as unknown", async () => {
    vi.mocked(fetch).mockResolvedValue(json({ error: "boom" }, 500));
    const { result } = renderHook(() => useDocumentNoticePage({ workspaceId: "ws1", documentId: "d1", enabled: true }), {
      wrapper: wrapperOf(client()),
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

// UNI-2056: the documents of a folded document_changed row live under the lists() prefix, so the
// realtime invalidation of lists() refreshes an open list; the row rewrites must not trip over them.
describe("notification documents of a folded row", () => {
  const item = (id: string) => ({ id, title: `Tài liệu ${id}`, kind: "page", trashed: false, shelved: false, deleted: false });
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

  it("keys the documents under lists() so notification.created refreshes them", () => {
    expect(notificationKeys.documents("n1")).toEqual(["notifications", "list", "documents", "n1"]);
  });

  it("pages through the cursor and refetches when the lists are invalidated", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(json({ documents: [item("d1")], next_cursor: "c2" }))
      .mockResolvedValueOnce(json({ documents: [item("d2")], next_cursor: null }))
      .mockResolvedValue(json({ documents: [item("d1"), item("d3")], next_cursor: null }));
    const { qc, wrapper } = setup();
    const { result } = renderHook(() => useNotificationDocuments("n1"), { wrapper });
    await waitFor(() => expect(result.current.data?.pages[0]?.documents[0]?.id).toBe("d1"));
    expect(result.current.hasNextPage).toBe(true);
    await act(async () => {
      await result.current.fetchNextPage();
    });
    await waitFor(() => expect(result.current.data?.pages.flatMap((p) => p.documents.map((i) => i.id))).toEqual(["d1", "d2"]));
    expect(result.current.hasNextPage).toBe(false);
    expect(String(vi.mocked(fetch).mock.calls[1]![0])).toBe("http://api.test/api/v1/me/notifications/n1/documents?cursor=c2");
    await act(async () => {
      await qc.invalidateQueries({ queryKey: notificationKeys.lists() });
    });
    await waitFor(() => expect(result.current.data?.pages.flatMap((p) => p.documents.map((i) => i.id))).toEqual(["d1", "d3"]));
  });

  it("stays cold while disabled", () => {
    const { wrapper } = setup();
    renderHook(() => useNotificationDocuments("n1", { enabled: false }), { wrapper });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("is left untouched, and does not break the mutation, when a row is marked read or archived", async () => {
    vi.mocked(fetch).mockImplementation(() => Promise.resolve(json({ status: "ok" })));
    const { qc, wrapper, list } = setup();
    const data = { pages: [{ documents: [item("d1")], next_cursor: null }], pageParams: [""] };
    qc.setQueryData(notificationKeys.documents("n1"), data);
    const read = renderHook(() => useMarkRead(), { wrapper }).result;
    act(() => {
      read.current.mutate(["n1"]);
    });
    await waitFor(() => expect(read.current.isSuccess).toBe(true));
    expect(list().notifications[0]!.read_at).toBeTruthy();
    const archive = renderHook(() => useArchive(), { wrapper }).result;
    act(() => {
      archive.current.mutate(["n1"]);
    });
    await waitFor(() => expect(archive.current.isSuccess).toBe(true));
    expect(list().notifications.map((n) => n.id)).toEqual(["n2"]);
    expect(qc.getQueryData(notificationKeys.documents("n1"))).toEqual(data);
  });
});
