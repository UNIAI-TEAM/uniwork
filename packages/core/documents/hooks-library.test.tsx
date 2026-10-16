import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../runtime-config";
import { ApiError } from "../api/http";
import { setAccessToken } from "../api/session";
import {
  useCreateDocument,
  useCreateDocumentFile,
  useEnsureMyFolder as useEnsureMyFolderFromHooks,
  type CreateDocumentFileInput,
  type CreateDocumentInput,
} from "./hooks";
import {
  isEndpointMissing,
  useCreateBlankFile,
  useCreateFolder,
  useDocumentSources,
  useDownloadDocumentSource,
  useEnsureMyFolder,
  useSaveSourceToFolder,
  type CreateBlankFileInput,
  type CreateFolderInput,
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

  // ---- MYFOLDER-01 (UNI-1850): destination: "my_folder" on create hooks ---

  it("useCreateDocument, useCreateDocumentFile, useCreateBlankFile and useCreateFolder forward destination: my_folder", async () => {
    const { wrapper } = setup();

    // 1. useCreateDocument (JSON create page)
    vi.mocked(fetch).mockResolvedValueOnce(json({ document: docBody({ kind: "page", parent_id: "mf1" }) }, 201));
    const createDoc = renderHook(() => useCreateDocument("w1"), { wrapper });
    await act(async () => {
      await createDoc.result.current.mutateAsync({
        title: "Trang mới",
        destination: "my_folder",
      });
    });
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0]![1]?.body))).toEqual({
      title: "Trang mới",
      destination: "my_folder",
    });

    // 2. useCreateDocumentFile (multipart upload field via meta and top-level)
    vi.mocked(fetch).mockResolvedValueOnce(
      json({
        document: docBody({
          kind: "file",
          parent_id: "mf1",
          file: {
            file_id: "f1",
            version_id: "v1",
            version: 1,
            filename: "brief.docx",
            mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            size_bytes: 5,
            checksum_sha256: "abc",
          },
        }),
      }),
    );
    const createFile = renderHook(() => useCreateDocumentFile("w1"), { wrapper });
    await act(async () => {
      await createFile.result.current.mutateAsync({
        file: new File(["bytes"], "brief.docx"),
        meta: { destination: "my_folder", title: "Báo cáo" },
      });
    });
    const fileForm = vi.mocked(fetch).mock.calls[1]![1]?.body as FormData;
    expect(fileForm.get("destination")).toBe("my_folder");
    expect(fileForm.get("parent_id")).toBeNull();
    expect(fileForm.get("title")).toBe("Báo cáo");

    // 3. useCreateBlankFile (JSON blank file)
    vi.mocked(fetch).mockResolvedValueOnce(json({ document: docBody({ parent_id: "mf1" }) }, 201));
    const createBlank = renderHook(() => useCreateBlankFile("w1"), { wrapper });
    await act(async () => {
      await createBlank.result.current.mutateAsync({
        format: "docx",
        title: "Mới",
        destination: "my_folder",
      });
    });
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[2]![1]?.body))).toEqual({
      format: "docx",
      title: "Mới",
      destination: "my_folder",
    });

    // 4. useCreateFolder (JSON folder)
    vi.mocked(fetch).mockResolvedValueOnce(json({ document: docBody({ kind: "folder", parent_id: "mf1" }) }, 201));
    const createFolder = renderHook(() => useCreateFolder("w1"), { wrapper });
    await act(async () => {
      await createFolder.result.current.mutateAsync({
        title: "Thư mục con",
        destination: "my_folder",
      });
    });
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[3]![1]?.body))).toEqual({
      kind: "folder",
      title: "Thư mục con",
      destination: "my_folder",
    });

    // Type-level union: destination and parentId/parent_id cannot both compile.
    // @ts-expect-error destination and parent_id are mutually exclusive
    const badDocInput: CreateDocumentInput = { title: "x", destination: "my_folder", parent_id: "p1" };
    // @ts-expect-error destination and parentId are mutually exclusive
    const badFileInput: CreateDocumentFileInput = {
      file: new File(["x"], "a.docx"),
      destination: "my_folder",
      parentId: "p1",
    };
    // @ts-expect-error destination and parentId are mutually exclusive
    const badBlankInput: CreateBlankFileInput = {
      format: "docx",
      title: "x",
      destination: "my_folder",
      parentId: "p1",
    };
    // @ts-expect-error destination and parentId are mutually exclusive
    const badFolderInput: CreateFolderInput = { title: "x", destination: "my_folder", parentId: "p1" };
    // Cross-level: top-level destination + meta parent, and the reverse.
    // @ts-expect-error a meta parent conflicts with a top-level destination
    const crossA: CreateDocumentFileInput = {
      file: new File(["x"], "a.docx"),
      destination: "my_folder",
      meta: { parentId: "p1" },
    };
    const crossB: CreateDocumentFileInput = {
      file: new File(["x"], "a.docx"),
      parentId: "p1",
      // @ts-expect-error a meta destination conflicts with a top-level parent
      meta: { destination: "my_folder" },
    };
    expect([badDocInput, badFileInput, badBlankInput, badFolderInput, crossA, crossB]).toHaveLength(6);
  });

  it("useCreateDocumentFile refuses a destination plus a parent before any request", async () => {
    const { wrapper } = setup();
    const hook = renderHook(() => useCreateDocumentFile("w1"), { wrapper });
    const bad = {
      file: new File(["x"], "a.docx"),
      destination: "my_folder",
      meta: { parentId: "p1" },
    } as unknown as CreateDocumentFileInput;
    await act(async () => {
      await expect(hook.result.current.mutateAsync(bad)).rejects.toThrow(/mutually exclusive/);
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});


