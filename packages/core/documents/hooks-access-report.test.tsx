import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setAccessToken } from "../api/session";
import { configureRuntime, resetRuntimeConfig } from "../runtime-config";
import {
  useDocumentAccessReport,
  useDocumentAccessReportPrincipals,
  useDocumentAccessReportSummary,
} from "./hooks-access-report";
import { documentKeys } from "./keys";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const page = (docId: string, next: string | null, over: Record<string, unknown> = {}) => ({
  scope: { kind: "workspace", workspace_id: "w1", folder_id: null, folder_title: null },
  filter: { person_id: null, level: [], visibility: null },
  generated_at: "2026-10-15T03:40:00Z",
  documents: [
    {
      document: { id: docId, title: docId, kind: "file", visibility: "workspace", path: [], acl_owner: null, live_link_count: 0, updated_at: "" },
      rows: [],
    },
  ],
  summary: { candidates: 1, documents: 1, rows: 0, skipped: 1 },
  next_cursor: next,
  ...over,
});

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, wrapper };
}

describe("useDocumentAccessReport (UNI-1643)", () => {
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

  it("pages on next_cursor and stops when it is null", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(json(page("d1", "c2")))
      .mockResolvedValueOnce(json(page("d2", null)));
    const { wrapper } = setup();
    const { result } = renderHook(() => useDocumentAccessReport("w1", "f1", { levels: ["edit"] }), { wrapper });
    await waitFor(() => expect(result.current.hasNextPage).toBe(true));
    const first = new URL(String(vi.mocked(fetch).mock.calls[0]![0]));
    expect(first.searchParams.get("folder_id")).toBe("f1");
    expect(first.searchParams.get("level")).toBe("edit");
    expect(first.searchParams.has("cursor")).toBe(false);

    await act(async () => {
      await result.current.fetchNextPage();
    });
    await waitFor(() =>
      expect(result.current.data?.pages.flatMap((p) => p.documents.map((d) => d.document.id))).toEqual(["d1", "d2"]),
    );
    expect(new URL(String(vi.mocked(fetch).mock.calls[1]![0])).searchParams.get("cursor")).toBe("c2");
    expect(result.current.hasNextPage).toBe(false);
  });

  it("keys the entry by workspace, folder and the normalized filters", () => {
    const base = documentKeys.accessReport("w1", "f1", { levels: ["edit", "view"], personId: "u1" });
    expect(base.slice(0, 2)).toEqual(["documents", "w1"]);
    expect(base).toContain("f1");
    // Level order and empty filters never split one report across two entries.
    expect(documentKeys.accessReport("w1", "f1", { levels: ["view", "edit"], personId: "u1" })).toEqual(base);
    expect(documentKeys.accessReport("w1", "f1", { personId: "u2" })).not.toEqual(base);
    expect(documentKeys.accessReport("w2", "f1", { levels: ["edit", "view"], personId: "u1" })).not.toEqual(base);
    expect(documentKeys.accessReport("w1", undefined, {})).toEqual(documentKeys.accessReport("w1", "", { levels: [] }));
    expect(documentKeys.accessReport("w1", "f2", { levels: ["edit", "view"], personId: "u1" })).not.toEqual(base);
  });

  it("does not carry rows across workspaces, even for the same folder", async () => {
    vi.mocked(fetch).mockImplementation(async (input) =>
      String(input).includes("/workspaces/w2/") ? new Promise<Response>(() => undefined) : json(page("d1", null)),
    );
    const { wrapper } = setup();
    const { result, rerender } = renderHook(({ ws }) => useDocumentAccessReport(ws, "f1", {}), {
      wrapper,
      initialProps: { ws: "w1" },
    });
    await waitFor(() => expect(result.current.data).toBeDefined());
    rerender({ ws: "w2" });
    expect(result.current.data).toBeUndefined();
  });

  it("fails the query when the answer is not a report, never an empty report", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ nope: true }));
    const { wrapper } = setup();
    const { result } = renderHook(() => useDocumentAccessReport("w1", undefined, {}), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
  });

  it("a cursor the server no longer takes (400) drops it and reads page 1 again", async () => {
    // A cursor minted before the sort/filter-hash change answers 400: the
    // report starts over instead of stopping on an error it cannot get past.
    const pageCalls: string[] = [];
    vi.mocked(fetch).mockImplementation(async (input) => {
      const cursor = new URL(String(input)).searchParams.get("cursor");
      pageCalls.push(cursor ?? "");
      if (cursor === "old") return json({ error: { code: "invalid_request", message: "cursor không hợp lệ" } }, 400);
      return pageCalls.length === 1 ? json(page("d1", "old")) : json(page("d1", "fresh"));
    });
    const { wrapper } = setup();
    const { result } = renderHook(() => useDocumentAccessReport("w1", undefined, {}), { wrapper });
    await waitFor(() => expect(result.current.hasNextPage).toBe(true));
    await act(async () => {
      await result.current.fetchNextPage();
    });
    await waitFor(() => expect(result.current.data?.pages[0]?.next_cursor).toBe("fresh"));
    expect(pageCalls).toEqual(["", "old", ""]);
    expect(result.current.isError).toBe(false);
    expect(result.current.data?.pages).toHaveLength(1);
  });

  it("starts over once per cursor: the same cursor refused again stays an error", async () => {
    vi.mocked(fetch).mockImplementation(async (input) =>
      new URL(String(input)).searchParams.get("cursor") === "bad"
        ? json({ error: { code: "invalid_request", message: "cursor không hợp lệ" } }, 400)
        : json(page("d1", "bad")),
    );
    const { wrapper } = setup();
    const { result } = renderHook(() => useDocumentAccessReport("w1", undefined, {}), { wrapper });
    await waitFor(() => expect(result.current.hasNextPage).toBe(true));
    await act(async () => {
      await result.current.fetchNextPage();
    });
    await waitFor(() => expect(result.current.hasNextPage).toBe(true));
    await act(async () => {
      await result.current.fetchNextPage();
    });
    await waitFor(() => expect(result.current.isFetchNextPageError).toBe(true));
    const cursors = vi.mocked(fetch).mock.calls.map(([u]) => new URL(String(u)).searchParams.get("cursor") ?? "");
    expect(cursors).toEqual(["", "bad", "", "bad"]);
  });

  it("a 400 on the first page is an error, not a restart", async () => {
    vi.mocked(fetch).mockResolvedValue(json({ error: { code: "invalid_request", message: "x" } }, 400));
    const { wrapper } = setup();
    const { result } = renderHook(() => useDocumentAccessReport("w1", undefined, {}), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("does not fetch without a workspace or when disabled", () => {
    const { wrapper } = setup();
    renderHook(() => useDocumentAccessReport("", undefined, {}), { wrapper });
    renderHook(() => useDocumentAccessReport("w1", undefined, {}, { enabled: false }), { wrapper });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("access report keys and hooks (UNI-2039)", () => {
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

  it("splits the page key by sort, order and every new filter", () => {
    const base = documentKeys.accessReport("w1", "f1", {});
    for (const over of [
      { sort: "title" as const },
      { order: "asc" as const },
      { q: "abc" },
      { principal: "user:u1" },
      { scope: "organization" },
      { sources: ["chat"] },
      { flag: "public_link" },
      { nonDefault: true },
    ]) {
      expect(documentKeys.accessReport("w1", "f1", over)).not.toEqual(base);
    }
    // Source order and a padded q do not split one report across two entries.
    expect(documentKeys.accessReport("w1", "f1", { sources: ["chat", "direct"], q: " a " })).toEqual(
      documentKeys.accessReport("w1", "f1", { sources: ["direct", "chat"], q: "a" }),
    );
    expect(documentKeys.accessReport("w1", "f1", { nonDefault: false })).toEqual(base);
  });

  it("hangs every report key off the one access-report root", () => {
    const root = documentKeys.accessReportRoot("w1");
    for (const key of [
      documentKeys.accessReport("w1", "f1", {}),
      documentKeys.accessReportSummary("w1", "f1", {}),
      documentKeys.accessReportPrincipals("w1", {}),
    ]) {
      expect(key.slice(0, root.length)).toEqual(root);
    }
    expect(documentKeys.accessReportRoot("w2")).not.toEqual(root);
  });

  it("keeps the summary key off the sort, and splits it by filter and folder", () => {
    const base = documentKeys.accessReportSummary("w1", "f1", { flag: "public_link" });
    expect(documentKeys.accessReportSummary("w1", "f1", { flag: "direct_manage" })).not.toEqual(base);
    expect(documentKeys.accessReportSummary("w1", "f2", { flag: "public_link" })).not.toEqual(base);
    expect(documentKeys.accessReportSummary("w2", "f1", { flag: "public_link" })).not.toEqual(base);
    expect(documentKeys.accessReportSummary("w1", "f1", { flag: "public_link", sort: "title" } as never)).toEqual(base);
  });

  it("splits the principals key by q, kind, level, sort and order, not by level order", () => {
    const base = documentKeys.accessReportPrincipals("w1", { levels: ["edit", "view"] });
    expect(documentKeys.accessReportPrincipals("w1", { levels: ["view", "edit"] })).toEqual(base);
    for (const over of [{ q: "a" }, { kind: "member" }, { levels: ["edit"] }, { sort: "name" as const }, { order: "asc" as const }]) {
      expect(documentKeys.accessReportPrincipals("w1", over)).not.toEqual(base);
    }
  });

  it("useDocumentAccessReport sends the sort and filters of its params", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(page("d1", null)));
    const { wrapper } = setup();
    const { result } = renderHook(
      () => useDocumentAccessReport("w1", undefined, { sort: "title", order: "asc", flag: "public_link" }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.data).toBeDefined());
    const sp = new URL(String(vi.mocked(fetch).mock.calls[0]![0])).searchParams;
    expect(sp.get("sort")).toBe("title");
    expect(sp.get("order")).toBe("asc");
    expect(sp.get("flag")).toBe("public_link");
  });

  it("useDocumentAccessReportSummary returns the totals", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ tiles: { public_link: 3, outside_workspace: 0, direct_manage: 0, documents: 4, restricted: 0, workspace: 0, organization: 0 }, matching_documents: 4, skipped: 1 }));
    const { wrapper } = setup();
    const { result } = renderHook(() => useDocumentAccessReportSummary("w1", "f1", { q: "x" }), { wrapper });
    await waitFor(() => expect(result.current.data?.tiles.public_link).toBe(3));
    const url = new URL(String(vi.mocked(fetch).mock.calls[0]![0]));
    expect(url.pathname).toBe("/api/v1/workspaces/w1/documents/access-report/summary");
    expect(url.searchParams.get("folder_id")).toBe("f1");
    expect(url.searchParams.get("q")).toBe("x");
  });

  it("useDocumentAccessReportSummary errors on garbage instead of showing zeros", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ nope: true }));
    const { wrapper } = setup();
    const { result } = renderHook(() => useDocumentAccessReportSummary("w1", undefined, {}), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
  });

  it("useDocumentAccessReportPrincipals returns the rows and errors on garbage", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(json({ principals: [{ principal_type: "user", principal_id: "u1", document_count: 2 }] }))
      .mockResolvedValueOnce(json("nope"));
    const { wrapper } = setup();
    const ok = renderHook(() => useDocumentAccessReportPrincipals("w1", { sort: "name" }), { wrapper });
    await waitFor(() => expect(ok.result.current.data?.principals).toHaveLength(1));
    expect(new URL(String(vi.mocked(fetch).mock.calls[0]![0])).searchParams.get("sort")).toBe("name");
    const bad = renderHook(() => useDocumentAccessReportPrincipals("w1", { kind: "link" }), { wrapper });
    await waitFor(() => expect(bad.result.current.isError).toBe(true));
  });

  it("the summary and principals hooks do not fetch without a workspace or when disabled", () => {
    const { wrapper } = setup();
    renderHook(() => useDocumentAccessReportSummary("", undefined, {}), { wrapper });
    renderHook(() => useDocumentAccessReportPrincipals("w1", {}, { enabled: false }), { wrapper });
    expect(fetch).not.toHaveBeenCalled();
  });
});
