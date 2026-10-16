import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../runtime-config";
import { ApiError } from "../api/http";
import { setAccessToken } from "../api/session";
import { isDocumentNotVerifiable } from "../types/document";
import {
  documentFilterKey,
  useArchiveDocument,
  useDocumentArchiveImpact,
  useDocumentList,
  useDocumentTree,
  useEnsureMyFolder,
  useMoveDocument,
  usePurgeDocument,
  useRecentDocuments,
  useSharedByMe,
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
    expect(result.current.data?.pages[0]?.documents[0]?.my_level).toBe("view");
  });

  it("useSharedWithMe follows next_cursor into a second page", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(listBody([summary("d1")], "n1")));
    vi.mocked(fetch).mockResolvedValueOnce(json(listBody([summary("d2")])));
    const { wrapper } = setup();
    const { result } = renderHook(() => useSharedWithMe("w1"), { wrapper });
    await waitFor(() => expect(result.current.hasNextPage).toBe(true));
    await act(async () => {
      await result.current.fetchNextPage();
    });
    await waitFor(() => expect(result.current.data?.pages.length).toBe(2));
    expect(result.current.data?.pages[1]?.documents[0]?.id).toBe("d2");
    expect(String(vi.mocked(fetch).mock.calls[0]![0])).toBe(
      "http://api.test/api/v1/workspaces/w1/documents/shared-with-me?limit=50",
    );
    expect(String(vi.mocked(fetch).mock.calls[1]![0])).toBe(
      "http://api.test/api/v1/workspaces/w1/documents/shared-with-me?cursor=n1&limit=50",
    );
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
    // The observer publishes data after mutateAsync resolves; wait for it instead of racing the re-render.
    await waitFor(() => expect(result.current.data?.batch_id).toBe("b1"));
    expect(qc.getQueryData(documentKeys.detail("w1", "d1"))).toBeDefined();

    vi.mocked(fetch).mockResolvedValueOnce(json({ batch_id: "b2", affected: ["d1"] }));
    const second = renderHook(() => useArchiveDocument("w1"), { wrapper });
    await act(async () => {
      await expectNotVerifiable(() => second.result.current.mutateAsync({ documentId: "d1" }));
    });
  });

  // ---- FD-06 (UNI-1466) ----------------------------------------------------

  it("useDocumentTree passes folders_only through and keys it apart from the full tree", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({ documents: [{ id: "f1", title: "T", kind: "folder", position: 0, children: [] }] }),
    );
    const { qc, wrapper } = setup();
    const { result } = renderHook(() => useDocumentTree("w1", undefined, { foldersOnly: true }), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(String(vi.mocked(fetch).mock.calls[0]![0])).toBe(
      "http://api.test/api/v1/workspaces/w1/documents/tree?folders_only=true",
    );
    expect(qc.getQueryData(documentKeys.tree("w1", "", true))).toBeDefined();
    expect(qc.getQueryData(documentKeys.tree("w1"))).toBeUndefined();
  });

  it("useDocumentList searches titles of documents through the extended filter", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json(listBody([summary("d1", { path: [{ id: "f1", title: "Hợp đồng" }] })])),
    );
    const { result } = renderHook(
      () => useDocumentList("w1", { q: "hop", kind: "document", match: "title" }),
      { wrapper: setup().wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const parsed = new URL(String(vi.mocked(fetch).mock.calls[0]![0]));
    expect(parsed.searchParams.get("kind")).toBe("document");
    expect(parsed.searchParams.get("match")).toBe("title");
    expect(result.current.data?.pages[0]?.documents[0]?.path).toEqual([{ id: "f1", title: "Hợp đồng" }]);
  });

  it("useDocumentArchiveImpact waits for enabled, then reads under the archive-impact key", async () => {
    vi.mocked(fetch).mockResolvedValue(
      json({ folders: 2, documents: 5, total: 8, max_nodes: 1000, too_large: false }),
    );
    const { qc, wrapper } = setup();
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useDocumentArchiveImpact("w1", "d1", { enabled }),
      { wrapper, initialProps: { enabled: false } },
    );
    expect(fetch).not.toHaveBeenCalled();
    rerender({ enabled: true });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(String(vi.mocked(fetch).mock.calls[0]![0])).toBe(
      "http://api.test/api/v1/documents/d1/archive-impact",
    );
    expect(result.current.data).toEqual({ folders: 2, documents: 5, total: 8, max_nodes: 1000, too_large: false });
    expect(qc.getQueryData(documentKeys.archiveImpact("w1", "d1"))).toEqual(result.current.data);
    // staleTime 0: the counts are stale the moment they land, so reopening
    // the dialog always asks again.
    expect(qc.getQueryCache().find({ queryKey: documentKeys.archiveImpact("w1", "d1") })?.isStale()).toBe(true);
  });

  it("useDocumentArchiveImpact turns an unreadable answer into not verifiable, never counts", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ folders: 2 }));
    const { result } = renderHook(() => useDocumentArchiveImpact("w1", "d1", { enabled: true }), {
      wrapper: setup().wrapper,
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(isDocumentNotVerifiable(result.current.error)).toBe(true);
    expect(result.current.data).toBeUndefined();
  });

  it("useDocumentArchiveImpact stays idle without a workspace or a document", () => {
    const { wrapper } = setup();
    renderHook(() => useDocumentArchiveImpact("", "d1", { enabled: true }), { wrapper });
    renderHook(() => useDocumentArchiveImpact("w1", "", { enabled: true }), { wrapper });
    expect(fetch).not.toHaveBeenCalled();
  });

  // ---- MYFOLDER-01 (UNI-1850): useEnsureMyFolder ---------------------------

  it("useEnsureMyFolder caches the detail entry and invalidates the workspace root only", async () => {
    const myFolder = summary("mf1", {
      kind: "folder",
      system_kind: "my_folder",
      title: "My Folder",
      visibility: "restricted",
    });
    vi.mocked(fetch).mockResolvedValueOnce(json({ document: myFolder }));
    const { qc, wrapper } = setup();
    qc.setQueryData(documentKeys.list("w1", ""), listBody([]));
    qc.setQueryData(documentKeys.tree("w1", ""), { documents: [] });
    qc.setQueryData(documentKeys.list("w2", ""), listBody([]));

    const { result } = renderHook(() => useEnsureMyFolder("w1"), { wrapper });
    let ensured: unknown;
    await act(async () => {
      ensured = await result.current.mutateAsync();
    });

    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toBe("http://api.test/api/v1/workspaces/w1/documents/my-folder");
    expect(init?.method).toBe("POST");
    expect(ensured).toMatchObject({ id: "mf1", kind: "folder", system_kind: "my_folder" });
    expect(qc.getQueryData(documentKeys.detail("w1", "mf1"))).toMatchObject({
      id: "mf1",
      system_kind: "my_folder",
    });
    expect(qc.getQueryState(documentKeys.list("w1", ""))?.isInvalidated).toBe(true);
    expect(qc.getQueryState(documentKeys.tree("w1", ""))?.isInvalidated).toBe(true);
    expect(qc.getQueryState(documentKeys.list("w2", ""))?.isInvalidated).toBe(false);
  });

  it("useEnsureMyFolder rejects a malformed response as not verifiable", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ document: { id: "mf1" } }));
    const { wrapper } = setup();
    const { result } = renderHook(() => useEnsureMyFolder("w1"), { wrapper });
    await act(async () => {
      await expectNotVerifiable(() => result.current.mutateAsync());
    });
  });

  // ---- SHAREDBYME-01 (UNI-1851): useSharedByMe -----------------------------

  it("useSharedByMe queries shared_by_me=true under documentKeys.sharedByMe(wsId) and follows next_cursor", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(json(listBody([summary("d1", { visibility: "workspace" })], "n1")))
      .mockResolvedValueOnce(json(listBody([summary("d2", { visibility: "restricted" })])));
    const { qc, wrapper } = setup();
    const { result } = renderHook(() => useSharedByMe("w1"), { wrapper });
    await waitFor(() => expect(result.current.hasNextPage).toBe(true));

    await act(async () => {
      await result.current.fetchNextPage();
    });
    await waitFor(() => expect(result.current.data?.pages.length).toBe(2));
    expect(result.current.data?.pages.flatMap((p) => p.documents.map((d) => d.id))).toEqual(["d1", "d2"]);
    expect(String(vi.mocked(fetch).mock.calls[0]![0])).toBe(
      "http://api.test/api/v1/workspaces/w1/documents?shared_by_me=true&limit=50",
    );
    expect(String(vi.mocked(fetch).mock.calls[1]![0])).toBe(
      "http://api.test/api/v1/workspaces/w1/documents?shared_by_me=true&cursor=n1&limit=50",
    );
    expect(qc.getQueryData(documentKeys.sharedByMe("w1"))).toBeDefined();
  });

  // ---- UNI-1868 (LISTFILTER-01): the type/access chips on every list -------

  it("useRecentDocuments sends the chip filters and keys the combination", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json(listBody([summary("d1", { kind: "file", format: "pdf" })])),
    );
    const { qc, wrapper } = setup();
    const { result } = renderHook(() => useRecentDocuments("w1", { format: "pdf", access: "edit" }), {
      wrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const url = new URL(String(vi.mocked(fetch).mock.calls[0]![0]));
    expect(url.pathname).toBe("/api/v1/workspaces/w1/documents/recent");
    expect(url.searchParams.get("format")).toBe("pdf");
    expect(url.searchParams.get("access")).toBe("edit");
    expect(url.searchParams.get("limit")).toBe("50");
    expect(result.current.data?.pages[0]?.documents[0]?.format).toBe("pdf");
    // The chip combination is its own cache entry, so switching a chip starts
    // from page 1 instead of reusing the unfiltered pages.
    const filtered = documentKeys.recent("w1", documentFilterKey({ format: "pdf", access: "edit" }));
    expect(qc.getQueryData(filtered)).toBeDefined();
    expect(filtered).not.toEqual(documentKeys.recent("w1"));
    expect(qc.getQueryData(documentKeys.recent("w1"))).toBeUndefined();
  });

  it("useSharedWithMe and useSharedByMe take the same chips", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(json(listBody([summary("s1", { my_level: "edit", via: "share" })])))
      .mockResolvedValueOnce(json(listBody([summary("s2")])));
    const { qc, wrapper } = setup();
    const shared = renderHook(() => useSharedWithMe("w1", { access: "edit" }), { wrapper });
    await waitFor(() => expect(shared.result.current.isSuccess).toBe(true));
    const byMe = renderHook(() => useSharedByMe("w1", { format: "docx" }), { wrapper });
    await waitFor(() => expect(byMe.result.current.isSuccess).toBe(true));
    expect(String(vi.mocked(fetch).mock.calls[0]![0])).toBe(
      "http://api.test/api/v1/workspaces/w1/documents/shared-with-me?access=edit&limit=50",
    );
    expect(String(vi.mocked(fetch).mock.calls[1]![0])).toBe(
      "http://api.test/api/v1/workspaces/w1/documents?shared_by_me=true&format=docx&limit=50",
    );
    expect(
      qc.getQueryData(documentKeys.sharedWithMe("w1", documentFilterKey({ access: "edit" }))),
    ).toBeDefined();
    expect(
      qc.getQueryData(documentKeys.sharedByMe("w1", documentFilterKey({ format: "docx" }))),
    ).toBeDefined();
  });

  // ---- RESTORE-01 (UNI-1843): usePurgeDocument -----------------------------

  it("usePurgeDocument awaits the server (no optimistic write) and invalidates the trash list and workspace roots", async () => {
    let resolvePurge!: (res: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          resolvePurge = resolve;
        }),
    );
    const { qc, wrapper } = setup();
    const trashKey = documentKeys.list("w1", documentFilterKey({ archived: true }));
    const parentKey = documentKeys.list("w1", documentFilterKey({ parentId: "f1" }));
    const rootListKey = documentKeys.list("w1", "");
    const treeKey = documentKeys.tree("w1", "");
    const detailKey = documentKeys.detail("w1", "d1");
    const otherWsTrashKey = documentKeys.list("w2", documentFilterKey({ archived: true }));
    qc.setQueryData(trashKey, listBody([summary("d1", { archived_at: "2026-10-16T00:00:00Z" })]));
    qc.setQueryData(parentKey, listBody([]));
    qc.setQueryData(rootListKey, listBody([]));
    qc.setQueryData(treeKey, { documents: [] });
    qc.setQueryData(detailKey, summary("d1", { archived_at: "2026-10-16T00:00:00Z" }));
    qc.setQueryData(otherWsTrashKey, listBody([summary("d9")]));

    const { result } = renderHook(() => usePurgeDocument("w1"), { wrapper });
    let settled = false;
    let promise!: Promise<void>;
    act(() => {
      promise = result.current
        .mutateAsync({ documentId: "d1", idempotencyKey: "pg-key" })
        .then(() => {
          settled = true;
        });
    });

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));

    // While in flight: no optimistic mutation or invalidation has fired.
    expect(settled).toBe(false);
    expect(qc.getQueryState(trashKey)?.isInvalidated).toBe(false);
    expect(qc.getQueryState(treeKey)?.isInvalidated).toBe(false);

    await act(async () => {
      resolvePurge(new Response(null, { status: 204 }));
      await promise;
    });

    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toBe("http://api.test/api/v1/documents/d1/purge");
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("Idempotency-Key")).toBe("pg-key");
    expect(qc.getQueryState(trashKey)?.isInvalidated).toBe(true);
    expect(qc.getQueryState(parentKey)?.isInvalidated).toBe(true);
    expect(qc.getQueryState(rootListKey)?.isInvalidated).toBe(true);
    expect(qc.getQueryState(treeKey)?.isInvalidated).toBe(true);
    expect(qc.getQueryState(detailKey)?.isInvalidated).toBe(true);
    expect(qc.getQueryState(otherWsTrashKey)?.isInvalidated).toBe(false);
  });

  it("usePurgeDocument accepts a bare documentId and leaves the cache untouched when the server refuses", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({ error: { code: "document_not_in_trash", message: "tài liệu không nằm trong thùng rác" } }, 400),
    );
    const { qc, wrapper } = setup();
    const trashKey = documentKeys.list("w1", documentFilterKey({ archived: true }));
    qc.setQueryData(trashKey, listBody([summary("d1")]));

    const { result } = renderHook(() => usePurgeDocument("w1"), { wrapper });
    await act(async () => {
      await expect(result.current.mutateAsync("d1")).rejects.toEqual(
        expect.objectContaining({
          name: "ApiError",
          code: "document_not_in_trash",
          status: 400,
        } satisfies Partial<ApiError>),
      );
    });
    expect(qc.getQueryState(trashKey)?.isInvalidated).toBe(false);
  });
});

