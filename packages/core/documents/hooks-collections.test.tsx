import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../runtime-config";
import { setAccessToken } from "../api/session";
import { isDocumentNotVerifiable } from "../types/document";
import {
  documentFilterKey,
  useArchiveDocument,
  useDocumentList,
  useDocumentTree,
  useMoveDocument,
  useSharedWithMe,
} from "./hooks-collections";
import { documentKeys } from "./keys";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const summary = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  organization_id: "o1",
  workspace_id: "w1",
  kind: "page",
  title: `Tài liệu ${id}`,
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
  ...over,
});

const listBody = (documents: unknown[], next: string | null = null) => ({ documents, next_cursor: next });

function setup() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, wrapper };
}

/** Run a mutation expected to fail verification; the caller keeps its state. */
async function expectNotVerifiable(run: () => Promise<unknown>): Promise<void> {
  const err = await run().then(
    () => null,
    (e: unknown) => e,
  );
  expect(isDocumentNotVerifiable(err)).toBe(true);
}

describe("documentKeys scoping (G1-05b)", () => {
  it("keeps every collection key under the workspace root", () => {
    const root = documentKeys.workspace("w1");
    expect(documentKeys.list("w1", "")).toEqual([...root, "list", ""]);
    expect(documentKeys.recent("w1")).toEqual([...root, "recent"]);
    expect(documentKeys.sharedWithMe("w1")).toEqual([...root, "shared"]);
    expect(documentKeys.tree("w1", "d1")).toEqual([...root, "tree", "d1"]);
    // Two filters never share a cache entry.
    expect(documentKeys.list("w1", "a")).not.toEqual(documentKeys.list("w1", "b"));
    expect(documentKeys.tree("w1", "a")).not.toEqual(documentKeys.tree("w1", "b"));
  });

  it("keeps shares/access-log under the document and public/settings apart", () => {
    const detail = documentKeys.detail("w1", "d1");
    expect(documentKeys.shares("w1", "d1")).toEqual([...detail, "shares"]);
    expect(documentKeys.accessLogs("w1", "d1", "view")).toEqual([...detail, "access-logs", "view"]);
    expect(documentKeys.accessLogs("w1", "d1", "")).not.toEqual(
      documentKeys.accessLogs("w1", "d1", "download"),
    );
    expect(documentKeys.public("t1")).toEqual(["documents", "public", "t1"]);
    expect(documentKeys.settings("o1")).toEqual(["documents", "settings", "o1"]);
  });

  it("has a deterministic filter key", () => {
    expect(documentFilterKey({ q: "a", kind: "page" })).toBe(
      documentFilterKey({ kind: "page", q: "a" }),
    );
    expect(documentFilterKey({ q: "a" })).not.toBe(documentFilterKey({ q: "b" }));
    expect(documentFilterKey({ q: undefined })).toBe("[]");
  });
});

describe("documents collection hooks", () => {
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

  it("useDocumentList pages on next_cursor and keys the filter", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(json(listBody([summary("d1")], "c2")))
      .mockResolvedValueOnce(json(listBody([summary("d2")])));
    const { qc, wrapper } = setup();
    const { result } = renderHook(() => useDocumentList("w1", { parentId: "" }), { wrapper });
    await waitFor(() => expect(result.current.hasNextPage).toBe(true));

    await act(async () => {
      await result.current.fetchNextPage();
    });
    await waitFor(() =>
      expect(result.current.data?.pages.flatMap((p) => p.documents.map((d) => d.id))).toEqual([
        "d1",
        "d2",
      ]),
    );
    expect(String(vi.mocked(fetch).mock.calls[0]![0])).toBe(
      "http://api.test/api/v1/workspaces/w1/documents?parent_id=&limit=50",
    );
    expect(String(vi.mocked(fetch).mock.calls[1]![0])).toContain("cursor=c2");
    expect(
      qc.getQueryData(documentKeys.list("w1", documentFilterKey({ parentId: "" }))),
    ).toBeDefined();
  });

  it("useDocumentTree keys itself by root", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({ documents: [{ id: "d1", title: "T", kind: "page", position: 0, children: [] }] }),
    );
    const { qc, wrapper } = setup();
    const { result } = renderHook(() => useDocumentTree("w1", "d1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(String(vi.mocked(fetch).mock.calls[0]![0])).toBe(
      "http://api.test/api/v1/workspaces/w1/documents/tree?root=d1",
    );
    expect(qc.getQueryData(documentKeys.tree("w1", "d1"))).toBeDefined();
  });

  it("useSharedWithMe carries the resolved access per row", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json(listBody([summary("d9", { my_level: "view", via: "share" })])),
    );
    const { wrapper } = setup();
    const { result } = renderHook(() => useSharedWithMe("w1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.documents[0]?.my_level).toBe("view");
  });

  it("useMoveDocument writes the detail and invalidates the workspace root", async () => {
    const moved = summary("d1", { parent_id: "p1", revision: "2" });
    vi.mocked(fetch).mockResolvedValueOnce(json({ document: moved }));
    const { qc, wrapper } = setup();
    qc.setQueryData(documentKeys.list("w1", ""), listBody([summary("d1")]));
    const { result } = renderHook(() => useMoveDocument("w1"), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ documentId: "d1", parent_id: "p1", revision: "1" });
    });
    const cached = qc.getQueryData(documentKeys.detail("w1", "d1")) as Record<string, unknown> | undefined;
    expect(cached?.id).toBe("d1");
    expect(cached?.parent_id).toBe("p1");
    expect(cached?.revision).toBe("2");
    expect(qc.getQueryState(documentKeys.list("w1", ""))?.isInvalidated).toBe(true);
  });

  it("useMoveDocument reports unverified instead of a fake success", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ document: { id: "d1" } }));
    const { wrapper } = setup();
    const { result } = renderHook(() => useMoveDocument("w1"), { wrapper });

    await act(async () => {
      await expectNotVerifiable(() => result.current.mutateAsync({ documentId: "d1", revision: "1" }));
    });
  });

  it("useArchiveDocument returns the batch and refuses an unverifiable one", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({ document: summary("d1", { archived_at: "x" }), batch_id: "b1", affected: ["d1"] }),
    );
    const { qc, wrapper } = setup();
    const { result } = renderHook(() => useArchiveDocument("w1"), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ documentId: "d1" });
    });
    expect(result.current.data?.batch_id).toBe("b1");
    expect(qc.getQueryData(documentKeys.detail("w1", "d1"))).toBeDefined();

    vi.mocked(fetch).mockResolvedValueOnce(json({ batch_id: "b2", affected: ["d1"] }));
    const second = renderHook(() => useArchiveDocument("w1"), { wrapper });
    await act(async () => {
      await expectNotVerifiable(() => second.result.current.mutateAsync({ documentId: "d1" }));
    });
  });
});
