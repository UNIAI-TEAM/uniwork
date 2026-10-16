import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../runtime-config";
import { ApiError } from "../api/http";
import { setAccessToken } from "../api/session";
import { useEnsureMyFolder as useEnsureMyFolderFromHooks } from "./hooks";
import {
  isEndpointMissing,
  useCreateBlankFile,
  useCreateFolder,
  useDocumentSources,
  useDownloadDocumentSource,
  useEnsureMyFolder,
  useSaveSourceToFolder,
} from "./hooks-library";
import { documentKeys } from "./keys";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const docBody = (over: Record<string, unknown> = {}) => ({
  id: "d1",
  organization_id: "o1",
  workspace_id: "w1",
  parent_id: null,
  kind: "file",
  title: "Tài liệu",
  visibility: "workspace",
  revision: "1",
  current_version: 1,
  position: 0,
  created_by: "u1",
  created_by_kind: "human",
  updated_by: "u1",
  updated_by_kind: "human",
  created_at: "2026-09-27T09:00:00Z",
  updated_at: "2026-09-27T09:00:00Z",
  ...over,
});

const item = (id: string) => ({
  id,
  source: "chat",
  parent: { kind: "chat_channel", id: "c1", title: "general" },
  name: `${id}.docx`,
});

function setup() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, wrapper };
}

describe("documents library hooks", () => {
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

  it("isEndpointMissing is true for 404 and 501 only", () => {
    expect(isEndpointMissing(new ApiError("x", "not_found", 404))).toBe(true);
    expect(isEndpointMissing(new ApiError("x", "not_implemented", 501))).toBe(true);
    expect(isEndpointMissing(new ApiError("x", "forbidden", 403))).toBe(false);
    expect(isEndpointMissing(new Error("boom"))).toBe(false);
  });

  it("keys sources under the workspace root", () => {
    expect(documentKeys.sources("w1", "f")).toEqual([...documentKeys.workspace("w1"), "sources", "f"]);
  });

  it("useDocumentSources pages on next_cursor", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(json({ items: [item("s1")], next_cursor: "c2" }))
      .mockResolvedValueOnce(json({ items: [item("s2")], next_cursor: null }));
    const { wrapper } = setup();
    const { result } = renderHook(() => useDocumentSources("w1", { source: "chat" }), { wrapper });
    await waitFor(() => expect(result.current.hasNextPage).toBe(true));
    const first = new URL(String(vi.mocked(fetch).mock.calls[0]![0]));
    expect(first.searchParams.get("source")).toBe("chat");
    expect(first.searchParams.get("limit")).toBe("50");
    await act(async () => {
      await result.current.fetchNextPage();
    });
    expect(new URL(String(vi.mocked(fetch).mock.calls[1]![0])).searchParams.get("cursor")).toBe("c2");
    await waitFor(() => expect(result.current.data?.pages).toHaveLength(2));
    expect(result.current.data?.pages.flatMap((p) => p.items.map((i) => i.id))).toEqual(["s1", "s2"]);
    expect(result.current.hasNextPage).toBe(false);
  });

  it("useDocumentSources refetches on window focus and sits under the sources root", async () => {
    vi.mocked(fetch).mockResolvedValue(json({ items: [item("s1")], next_cursor: null }));
    const { qc, wrapper } = setup();
    const { result } = renderHook(() => useDocumentSources("w1", { source: "chat" }), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const [query] = qc.getQueryCache().findAll({ queryKey: documentKeys.sourcesRoot("w1") });
    expect(query).toBeDefined();
    expect(query?.observers[0]?.options.refetchOnWindowFocus).toBe(true);
  });

  it("useDocumentSources does not retry a 404", async () => {
    vi.mocked(fetch).mockResolvedValue(json({ error: "not found", code: "not_found" }, 404));
    // Default retry on: only the hook's own retry rule may stop the loop.
    const qc = new QueryClient();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useDocumentSources("w1"), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(isEndpointMissing(result.current.error)).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("useCreateBlankFile posts the body and invalidates the workspace root", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ document: docBody() }, 201));
    const { qc, wrapper } = setup();
    const spy = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useCreateBlankFile("w1"), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ format: "docx", title: "Mới", parentId: "p1", idempotencyKey: "k1" });
    });
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toBe("http://api.test/api/v1/workspaces/w1/documents/files/blank");
    expect(JSON.parse(String(init?.body))).toEqual({ format: "docx", title: "Mới", parent_id: "p1" });
    expect(new Headers(init?.headers).get("Idempotency-Key")).toBe("k1");
    expect(qc.getQueryData(documentKeys.detail("w1", "d1"))).toMatchObject({ id: "d1" });
    expect(spy).toHaveBeenCalledWith({ queryKey: documentKeys.workspace("w1") });
  });

  it("useCreateFolder sends kind folder", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ document: docBody({ kind: "folder" }) }, 201));
    const { wrapper } = setup();
    const { result } = renderHook(() => useCreateFolder("w1"), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ title: "Thư mục", parentId: "p1" });
    });
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toBe("http://api.test/api/v1/workspaces/w1/documents");
    expect(JSON.parse(String(init?.body))).toEqual({ kind: "folder", title: "Thư mục", parent_id: "p1" });
  });

  it("useSaveSourceToFolder sends parent_id and rejects an unverifiable answer", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ document: docBody() }, 201));
    const { wrapper } = setup();
    const { result } = renderHook(() => useSaveSourceToFolder("w1"), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ sourceId: "s1", parentId: "f1", title: "T" });
    });
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toBe("http://api.test/api/v1/workspaces/w1/documents/sources/s1/save");
    expect(JSON.parse(String(init?.body))).toEqual({ parent_id: "f1", title: "T" });

    vi.mocked(fetch).mockResolvedValueOnce(json({ nope: true }, 201));
    await act(async () => {
      await expect(result.current.mutateAsync({ sourceId: "s1" })).rejects.toBeTruthy();
    });
  });

  it("useDownloadDocumentSource returns the blob", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(new Uint8Array([1, 2])));
    const { wrapper } = setup();
    const { result } = renderHook(() => useDownloadDocumentSource("w1"), { wrapper });
    let blob: Blob | undefined;
    await act(async () => {
      blob = await result.current.mutateAsync({ sourceId: "s1" });
    });
    expect(blob?.size).toBe(2);
    expect(useEnsureMyFolder).toBe(useEnsureMyFolderFromHooks);
  });
});

