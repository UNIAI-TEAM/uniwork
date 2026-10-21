import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../runtime-config";
import { setAccessToken } from "../api/session";
import { DocumentNotVerifiableError } from "../types/document";
import { documentKeys } from "./keys";
import {
  useDocumentFavorites,
  useFavoriteDocument,
  useUnfavoriteDocument,
  useWorkspaceFavoriteDocuments,
} from "./hooks-favorites";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const favoriteBody = (over: Record<string, unknown> = {}) => ({
  document_id: "d1",
  favorite_id: "f1",
  workspace_id: "w1",
  title: "Kế hoạch Q4",
  kind: "page",
  favorited_at: "2026-09-28T08:00:00Z",
  ...over,
});

function wrapperFor(qc: QueryClient) {
  function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  }
  return Wrapper;
}

describe("document favorite hooks", () => {
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

  it("loads the organization's favorites and stays idle without an id", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ favorites: [favoriteBody()] }));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = wrapperFor(qc);
    const idle = renderHook(() => useDocumentFavorites(""), { wrapper });
    expect(idle.result.current.fetchStatus).toBe("idle");

    const list = renderHook(() => useDocumentFavorites("o1"), { wrapper });
    await waitFor(() => expect(list.result.current.isSuccess).toBe(true));
    expect(list.result.current.data?.[0]?.document_id).toBe("d1");
    expect(qc.getQueryData(documentKeys.favorites("o1"))).toHaveLength(1);
  });

  it("favorite/unfavorite invalidate the favorites prefix", async () => {
    vi.mocked(fetch).mockImplementation(() => Promise.resolve(json({ favorite: favoriteBody(), status: "ok" })));
    const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const wrapper = wrapperFor(qc);

    const favorite = renderHook(() => useFavoriteDocument(), { wrapper });
    await act(async () => {
      await favorite.result.current.mutateAsync("d1");
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: documentKeys.favoritesRoot });

    invalidate.mockClear();
    const unfavorite = renderHook(() => useUnfavoriteDocument(), { wrapper });
    await act(async () => {
      await unfavorite.result.current.mutateAsync("d1");
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: documentKeys.favoritesRoot });
  });

  it("pages the workspace's starred rows under the workspace key (SV-2)", async () => {
    const row = (id: string) => ({
      id,
      workspace_id: "w1",
      kind: "page",
      title: `Trang ${id}`,
      revision: "1",
      favorited_at: "2026-10-20T08:00:00Z",
    });
    vi.mocked(fetch)
      .mockResolvedValueOnce(json({ documents: [row("d1")], next_cursor: "c2" }))
      .mockResolvedValueOnce(json({ documents: [row("d2")], next_cursor: null }));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = wrapperFor(qc);
    const idle = renderHook(() => useWorkspaceFavoriteDocuments("w1", { enabled: false }), { wrapper });
    expect(idle.result.current.fetchStatus).toBe("idle");

    const list = renderHook(() => useWorkspaceFavoriteDocuments("w1"), { wrapper });
    await waitFor(() => expect(list.result.current.isSuccess).toBe(true));
    expect(String(vi.mocked(fetch).mock.calls[0]![0])).toBe("http://api.test/api/v1/workspaces/w1/documents/favorites?limit=50");
    await act(async () => {
      await list.result.current.fetchNextPage();
    });
    expect(String(vi.mocked(fetch).mock.calls[1]![0])).toBe("http://api.test/api/v1/workspaces/w1/documents/favorites?cursor=c2&limit=50");
    expect(list.result.current.data?.pages.flatMap((p) => p.documents.map((d) => d.id))).toEqual(["d1", "d2"]);
    // Under the workspace root, so a document.* frame refreshes it like every other list.
    expect(documentKeys.favoriteList("w1").slice(0, 2)).toEqual(documentKeys.workspace("w1"));
    expect(qc.getQueryData(documentKeys.favoriteList("w1"))).toBeDefined();
  });

  it("favorite/unfavorite also refresh every workspace starred list", async () => {
    vi.mocked(fetch).mockImplementation(() => Promise.resolve(json({ favorite: favoriteBody(), status: "ok" })));
    const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    qc.setQueryData(documentKeys.favoriteList("w1"), { pages: [], pageParams: [] });
    qc.setQueryData(documentKeys.favoriteList("w2"), { pages: [], pageParams: [] });
    qc.setQueryData(documentKeys.list("w1"), { pages: [], pageParams: [] });
    const wrapper = wrapperFor(qc);
    const favorite = renderHook(() => useFavoriteDocument(), { wrapper });
    await act(async () => {
      await favorite.result.current.mutateAsync("d1");
    });
    expect(qc.getQueryState(documentKeys.favoriteList("w1"))?.isInvalidated).toBe(true);
    expect(qc.getQueryState(documentKeys.favoriteList("w2"))?.isInvalidated).toBe(true);
    expect(qc.getQueryState(documentKeys.list("w1"))?.isInvalidated).toBe(false);

    qc.setQueryData(documentKeys.favoriteList("w1"), { pages: [], pageParams: [] });
    const unfavorite = renderHook(() => useUnfavoriteDocument(), { wrapper });
    await act(async () => {
      await unfavorite.result.current.mutateAsync("d1");
    });
    expect(qc.getQueryState(documentKeys.favoriteList("w1"))?.isInvalidated).toBe(true);
  });

  it("a malformed favorite answer is not verifiable", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ favorite: { title: "x" } }));
    const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const wrapper = wrapperFor(qc);
    const favorite = renderHook(() => useFavoriteDocument(), { wrapper });
    await act(async () => {
      await expect(favorite.result.current.mutateAsync("d1")).rejects.toBeInstanceOf(
        DocumentNotVerifiableError,
      );
    });
  });

  it("a malformed unfavorite answer is not verifiable", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ nope: true }));
    const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const wrapper = wrapperFor(qc);
    const unfavorite = renderHook(() => useUnfavoriteDocument(), { wrapper });
    await act(async () => {
      await expect(unfavorite.result.current.mutateAsync("d1")).rejects.toBeInstanceOf(
        DocumentNotVerifiableError,
      );
    });
  });
});
