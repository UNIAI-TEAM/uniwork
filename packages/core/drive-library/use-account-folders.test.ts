import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../runtime-config";
import { setAccessToken } from "../api/session";
import { useDriveAccountFolders } from "./use-account-folders";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const sampleFile = (over: Record<string, unknown> = {}) => ({
  id: "df1",
  organization_id: "org1",
  workspace_id: "ws1",
  external_file_id: "ext1",
  name: "Kế hoạch ra mắt Q4",
  mime_type: "application/vnd.google-apps.document",
  icon_kind: "google_doc",
  web_view_link: "https://docs.google.com/document/d/ext1/edit",
  open_url: "https://docs.google.com/document/d/ext1/edit?authuser=minh%40gmail.com",
  owner_display: "Lan",
  sharing_state: "private",
  connection_id: "conn1",
  bound_account_email: "minh@gmail.com",
  bound_connection_lost: false,
  bound_by_id: "u1",
  bound_by_name: "Minh",
  created_by: "u1",
  created_by_kind: "human",
  created_by_name: "Minh",
  created_at: "2026-10-26T08:15:00Z",
  updated_at: "2026-10-26T08:15:00Z",
  viewer_access: "granted",
  viewer_connection_id: "conn1",
  viewer_account_email: "minh@gmail.com",
  can_unlink: true,
  can_rebind: true,
  can_propose: true,
  can_ask: true,
  used_in_count: 0,
  used_in_tasks: [],
  tasks_created: { count: 0 },
  ...over,
});

const inFolder = (id: string, folderId: string | null, name: string | null = null) =>
  sampleFile({ id, drive_folder: folderId ? { id: folderId, name } : null });

function makeWrapper(qc: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: qc }, children);
  };
}

const notFound = () => json({ error: { code: "not_found", message: "no" } }, 404);

/** Routes by path: the folder list answers `folders`, the file list answers `pages` in order. */
function serve(folders: () => Response, pages: Array<() => Response>) {
  let next = 0;
  vi.mocked(fetch).mockImplementation((input) => {
    if (String(input).includes("/drive-folders")) return Promise.resolve(folders());
    const page = pages[Math.min(next, pages.length - 1)];
    next += 1;
    return Promise.resolve(page!());
  });
}

const fileCalls = () => vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes("/drive-files"));
const folderCalls = () => vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes("/drive-folders"));

describe("useDriveAccountFolders", () => {
  let qc: QueryClient;

  beforeEach(() => {
    qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    setAccessToken("tok");
    vi.stubGlobal("fetch", vi.fn());
    configureRuntime({ apiUrl: "http://api.test" });
  });

  afterEach(() => {
    qc.clear();
    vi.unstubAllGlobals();
    resetRuntimeConfig();
    setAccessToken(null);
  });

  it("walks every page of the account and derives folders, counts and unfiled files when the server has no folder list", async () => {
    serve(notFound, [
      () => json({ files: [inFolder("a", "fld-1", "Dự án Beta"), inFolder("b", null)], total_count: 4, next_cursor: "c2" }),
      () => json({ files: [inFolder("c", "fld-1", "Dự án Beta"), inFolder("d", "zz9999")], total_count: 4, next_cursor: null }),
    ]);
    const { result } = renderHook(() => useDriveAccountFolders("ws1", "conn1", { locale: "vi" }), {
      wrapper: makeWrapper(qc),
    });

    await waitFor(() => expect(result.current.files).toHaveLength(4));
    await waitFor(() => expect(result.current.isLoadingMore).toBe(false));
    expect(result.current.folders.map((f) => [f.id, f.name, f.fileCount])).toEqual([
      ["fld-1", "Dự án Beta", 2],
      ["zz9999", null, 1],
    ]);
    expect(result.current.unfiled.map((f) => f.id)).toEqual(["b"]);
    expect(fileCalls()).toHaveLength(2);
  });

  it("does not fetch without an account or while disabled", () => {
    renderHook(() => useDriveAccountFolders("ws1", null), { wrapper: makeWrapper(qc) });
    renderHook(() => useDriveAccountFolders("ws1", "conn1", { enabled: false }), { wrapper: makeWrapper(qc) });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("an old server without drive_folder gives no folders and every file unfiled", async () => {
    serve(notFound, [() => json({ files: [sampleFile({ id: "a" }), sampleFile({ id: "b" })], total_count: 2, next_cursor: null })]);
    const { result } = renderHook(() => useDriveAccountFolders("ws1", "conn1"), { wrapper: makeWrapper(qc) });
    await waitFor(() => expect(result.current.files).toHaveLength(2));
    expect(result.current.folders).toEqual([]);
    expect(result.current.unfiled).toHaveLength(2);
  });

  it("reports a failed first page as an error", async () => {
    serve(notFound, [() => json({ error: "boom" }, 500)]);
    const { result } = renderHook(() => useDriveAccountFolders("ws1", "conn1"), { wrapper: makeWrapper(qc) });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.files).toEqual([]);
  });

  it("keeps what is loaded and offers a retry when a later page fails", async () => {
    serve(notFound, [
      () => json({ files: [inFolder("a", "fld-1", "Dự án Beta")], total_count: 2, next_cursor: "c2" }),
      () => json({ error: "boom" }, 500),
      () => json({ files: [inFolder("b", "fld-1", "Dự án Beta")], total_count: 2, next_cursor: null }),
    ]);
    const { result } = renderHook(() => useDriveAccountFolders("ws1", "conn1", { locale: "vi" }), {
      wrapper: makeWrapper(qc),
    });
    await waitFor(() => expect(result.current.isLoadMoreError).toBe(true));
    expect(result.current.isLoadingMore).toBe(false);
    expect(result.current.files).toHaveLength(1);

    result.current.retryLoadMore();
    await waitFor(() => expect(result.current.files).toHaveLength(2));
    expect(result.current.isLoadMoreError).toBe(false);
  });

  it("stops after 40 pages and reports the account as incomplete, with no partial tree", async () => {
    let n = 0;
    vi.mocked(fetch).mockImplementation((input) => {
      if (String(input).includes("/drive-folders")) return Promise.resolve(notFound());
      n += 1;
      return Promise.resolve(json({ files: [inFolder(`f${n}`, "fld-1", "Dự án Beta")], total_count: 99, next_cursor: `c${n + 1}` }));
    });
    const { result } = renderHook(() => useDriveAccountFolders("ws1", "conn1", { locale: "vi" }), {
      wrapper: makeWrapper(qc),
    });
    await waitFor(() => expect(result.current.isError).toBe(true), { timeout: 8000 });
    expect(fileCalls()).toHaveLength(40);
    expect(result.current.isLoadingMore).toBe(false);
    expect(result.current.folders).toEqual([]);
    expect(result.current.files).toEqual([]);
  });
  describe("with the server folder list", () => {
    const groups = () =>
      json({
        folders: [
          { id: "fld-2", name: "Báo cáo", file_count: 5 },
          { id: "zz9999", name: null, file_count: 1 },
          { id: "fld-1", name: "Dự án Beta", file_count: 2 },
          { id: null, name: null, file_count: 7 },
        ],
      });

    it("takes folders and counts from the list in one request, with no page walk for the tree", async () => {
      serve(groups, [() => json({ files: [], total_count: 0, next_cursor: null })]);
      const { result } = renderHook(
        () => useDriveAccountFolders("ws1", "conn1", { locale: "vi", withFiles: false }),
        { wrapper: makeWrapper(qc) },
      );
      await waitFor(() => expect(result.current.isPending).toBe(false));
      expect(result.current.folders.map((f) => [f.id, f.name, f.fileCount])).toEqual([
        ["fld-2", "Báo cáo", 5],
        ["fld-1", "Dự án Beta", 2],
        ["zz9999", null, 1],
      ]);
      expect(String(folderCalls()[0]![0])).toContain("drive_connection_id=conn1");
      expect(fileCalls()).toHaveLength(0);
      expect(result.current.isLoadingMore).toBe(false);
      expect(result.current.isError).toBe(false);
    });

    it("walks the files for the lists and picks the files with no folder", async () => {
      serve(groups, [
        () => json({ files: [inFolder("a", "fld-1", "Dự án Beta"), inFolder("b", null)], total_count: 3, next_cursor: "c2" }),
        () => json({ files: [inFolder("c", null)], total_count: 3, next_cursor: null }),
      ]);
      const { result } = renderHook(() => useDriveAccountFolders("ws1", "conn1", { locale: "vi" }), {
        wrapper: makeWrapper(qc),
      });
      await waitFor(() => expect(result.current.files).toHaveLength(3));
      expect(result.current.folders.map((f) => f.fileCount)).toEqual([5, 2, 1]);
      expect(result.current.unfiled.map((f) => f.id)).toEqual(["b", "c"]);
    });

    it("an empty list is a valid answer: no folders, no derivation", async () => {
      serve(() => json({ folders: [] }), [() => json({ files: [inFolder("a", "fld-1")], total_count: 1, next_cursor: null })]);
      const { result } = renderHook(() => useDriveAccountFolders("ws1", "conn1", { withFiles: false }), {
        wrapper: makeWrapper(qc),
      });
      await waitFor(() => expect(result.current.isPending).toBe(false));
      expect(result.current.folders).toEqual([]);
      expect(fileCalls()).toHaveLength(0);
    });

    it("falls back to deriving from the files when the answer has no folder list", async () => {
      serve(() => json({ unexpected: true }), [
        () => json({ files: [inFolder("a", "fld-1", "Dự án Beta")], total_count: 1, next_cursor: null }),
      ]);
      const { result } = renderHook(() => useDriveAccountFolders("ws1", "conn1", { withFiles: false }), {
        wrapper: makeWrapper(qc),
      });
      await waitFor(() => expect(result.current.folders).toHaveLength(1));
      expect(result.current.folders[0]).toMatchObject({ id: "fld-1", name: "Dự án Beta", fileCount: 1 });
      expect(fileCalls()).toHaveLength(1);
    });

    it("falls back on a failed request even for the tree, and does not retry a 404", async () => {
      serve(notFound, [() => json({ files: [inFolder("a", "fld-1", "Dự án Beta")], total_count: 1, next_cursor: null })]);
      const retrying = new QueryClient();
      const { result } = renderHook(() => useDriveAccountFolders("ws1", "conn1", { withFiles: false }), {
        wrapper: makeWrapper(retrying),
      });
      await waitFor(() => expect(result.current.folders).toHaveLength(1));
      expect(folderCalls()).toHaveLength(1);
      retrying.clear();
    });

    it("is pending until the list answers", () => {
      vi.mocked(fetch).mockReturnValue(new Promise(() => {}));
      const { result } = renderHook(() => useDriveAccountFolders("ws1", "conn1", { withFiles: false }), {
        wrapper: makeWrapper(qc),
      });
      expect(result.current.isPending).toBe(true);
    });
  });
});
