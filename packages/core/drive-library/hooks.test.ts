import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../runtime-config";
import { setAccessToken } from "../api/session";
import {
  driveLibraryKeys,
  useAttachDriveFileToTask,
  useDriveFile,
  useDriveFiles,
  useDriveFolders,
  useNameDriveFolder,
  useRebindDriveFile,
  useUnlinkDriveFile,
} from "./hooks";

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

function makeWrapper(qc: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: qc }, children);
  };
}

describe("driveLibraryKeys and hooks", () => {
  let qc: QueryClient;

  beforeEach(() => {
    qc = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
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

  it("pins all drive-library keys under the ['drive', wsId] prefix (driveKeys.workspace)", () => {
    expect(driveLibraryKeys.workspace("ws-1")).toEqual(["drive", "ws-1"]);
    expect(driveLibraryKeys.list("ws-1").slice(0, 2)).toEqual(["drive", "ws-1"]);
    expect(driveLibraryKeys.list("ws-1", "conn-1").slice(0, 2)).toEqual(["drive", "ws-1"]);
    expect(driveLibraryKeys.detail("ws-1", "df-1").slice(0, 2)).toEqual(["drive", "ws-1"]);
  });

  it("useDriveFiles loads pages and enables refetchOnWindowFocus", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({ files: [sampleFile()], total_count: 1, next_cursor: null }),
    );
    const { result } = renderHook(() => useDriveFiles("ws1", { connectionId: "conn1" }), {
      wrapper: makeWrapper(qc),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.pages[0]?.files[0]?.name).toBe("Kế hoạch ra mắt Q4");
    const query = qc.getQueryCache().find({ queryKey: driveLibraryKeys.list("ws1", "conn1") });
    expect((query?.options as { refetchOnWindowFocus?: boolean } | undefined)?.refetchOnWindowFocus).toBe(true);
  });

  describe("useDriveFiles with a drive folder filter", () => {
    const rows = [
      { id: "a", folder: "fld-1234567890" },
      { id: "b", folder: "fld-1234567890" },
      { id: "c", folder: "fld-1234567890" },
      { id: "d", folder: "fld-other-abcdef" },
      { id: "e", folder: null },
    ];

    /** A server that filters by `drive_folder_id` (`none` = no parent), counts the filtered set and pages by offset cursor. */
    function serveFiltered() {
      vi.mocked(fetch).mockImplementation((input) => {
        const params = new URL(String(input)).searchParams;
        const filter = params.get("drive_folder_id");
        const matching = rows.filter((r) => (filter === null ? true : filter === "none" ? r.folder === null : r.folder === filter));
        const offset = Number(params.get("cursor") ?? 0);
        const limit = Number(params.get("limit"));
        const page = matching.slice(offset, offset + limit);
        const more = offset + limit < matching.length;
        return Promise.resolve(
          json({
            files: page.map((r) => sampleFile({ id: r.id, drive_folder: r.folder ? { id: r.folder, name: null } : null })),
            total_count: matching.length,
            next_cursor: more ? String(offset + limit) : null,
            drive_folder_id: filter,
          }),
        );
      });
    }
    const requested = () => vi.mocked(fetch).mock.calls.map(([url]) => new URL(String(url)).searchParams);

    it("sends the folder id with the connection and pages it with the filtered total", async () => {
      serveFiltered();
      const { result } = renderHook(
        () => useDriveFiles("ws1", { connectionId: "conn1", driveFolderId: "fld-1234567890", limit: 2 }),
        { wrapper: makeWrapper(qc) },
      );
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data?.pages[0]?.files.map((f) => f.id)).toEqual(["a", "b"]);
      expect(result.current.data?.pages[0]?.total_count).toBe(3);
      expect(result.current.hasNextPage).toBe(true);
      expect(requested()[0]!.get("connection_id")).toBe("conn1");
      expect(requested()[0]!.get("drive_folder_id")).toBe("fld-1234567890");

      await result.current.fetchNextPage();
      await waitFor(() => expect(result.current.data?.pages).toHaveLength(2));
      expect(result.current.data?.pages.flatMap((p) => p.files.map((f) => f.id))).toEqual(["a", "b", "c"]);
      expect(requested()[1]!.get("cursor")).toBe("2");
      expect(requested()[1]!.get("drive_folder_id")).toBe("fld-1234567890");
      expect(result.current.hasNextPage).toBe(false);
    });

    it("none asks for the files with no known parent folder", async () => {
      serveFiltered();
      const { result } = renderHook(() => useDriveFiles("ws1", { connectionId: "conn1", driveFolderId: "none" }), {
        wrapper: makeWrapper(qc),
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data?.pages[0]?.files.map((f) => f.id)).toEqual(["e"]);
      expect(requested()[0]!.get("drive_folder_id")).toBe("none");
    });

    it("an unknown well-shaped folder id is an empty page, not an error", async () => {
      serveFiltered();
      const { result } = renderHook(
        () => useDriveFiles("ws1", { connectionId: "conn1", driveFolderId: "fld-unknown-0000" }),
        { wrapper: makeWrapper(qc) },
      );
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data?.pages[0]).toMatchObject({ files: [], total_count: 0, next_cursor: null });
      expect(result.current.hasNextPage).toBe(false);
    });

    it("keeps a cache entry per folder, apart from the unfiltered list", async () => {
      serveFiltered();
      const wrapper = makeWrapper(qc);
      const first = renderHook(() => useDriveFiles("ws1", { connectionId: "conn1", driveFolderId: "fld-1234567890" }), { wrapper });
      const second = renderHook(() => useDriveFiles("ws1", { connectionId: "conn1", driveFolderId: "fld-other-abcdef" }), { wrapper });
      const whole = renderHook(() => useDriveFiles("ws1", { connectionId: "conn1" }), { wrapper });
      await waitFor(() => expect(first.result.current.isSuccess && second.result.current.isSuccess && whole.result.current.isSuccess).toBe(true));
      expect(first.result.current.data?.pages[0]?.files.map((f) => f.id)).toEqual(["a", "b", "c"]);
      expect(second.result.current.data?.pages[0]?.files.map((f) => f.id)).toEqual(["d"]);
      expect(whole.result.current.data?.pages[0]?.files).toHaveLength(5);

      const folderKey = driveLibraryKeys.list("ws1", "conn1", "fld-1234567890");
      const noneKey = driveLibraryKeys.list("ws1", "conn1", "none");
      const keys = [
        driveLibraryKeys.list("ws1", "conn1"),
        folderKey,
        driveLibraryKeys.list("ws1", "conn1", "fld-other-abcdef"),
        noneKey,
      ];
      expect(new Set(keys.map((k) => JSON.stringify(k))).size).toBe(4);
      expect(qc.getQueryCache().find({ queryKey: folderKey, exact: true })).toBeDefined();
      expect(qc.getQueryCache().find({ queryKey: noneKey, exact: true })).toBeUndefined();
      // Every folder key stays under the workspace lists prefix, so drive_file.* invalidation reaches it.
      expect(keys.every((k) => driveLibraryKeys.lists("ws1").every((part, i) => k[i] === part))).toBe(true);
    });
  });

  it("useDriveFile fetches file detail and enables refetchOnWindowFocus", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ file: sampleFile() }));
    const { result } = renderHook(() => useDriveFile("ws1", "df1"), {
      wrapper: makeWrapper(qc),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.id).toBe("df1");
    const query = qc.getQueryCache().find({ queryKey: driveLibraryKeys.detail("ws1", "df1") });
    expect((query?.options as { refetchOnWindowFocus?: boolean } | undefined)?.refetchOnWindowFocus).toBe(true);
  });

  it("useUnlinkDriveFile awaits the server, invalidates sibling ['drive', wsId, ...] keys, marks the detail stale without refetching while mounted", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ file: sampleFile() }));
    const detailHook = renderHook(() => useDriveFile("ws1", "df1"), {
      wrapper: makeWrapper(qc),
    });
    await waitFor(() => expect(detailHook.result.current.isSuccess).toBe(true));

    const siblingKey = ["drive", "ws1", "connections"] as const;
    qc.setQueryData(siblingKey, [{ id: "conn1" }]);
    expect(qc.getQueryState(siblingKey)?.isInvalidated).toBe(false);
    expect(qc.getQueryState(driveLibraryKeys.detail("ws1", "df1"))?.isInvalidated).toBe(false);

    vi.mocked(fetch).mockResolvedValueOnce(json({ status: "ok" }));
    const removeSpy = vi.spyOn(qc, "removeQueries");
    const { result } = renderHook(() => useUnlinkDriveFile("ws1"), {
      wrapper: makeWrapper(qc),
    });

    await result.current.mutateAsync("df1");
    expect(removeSpy).not.toHaveBeenCalled();
    expect(qc.getQueryState(siblingKey)?.isInvalidated).toBe(true);
    expect(qc.getQueryState(driveLibraryKeys.detail("ws1", "df1"))?.isInvalidated).toBe(true);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
  });

  it("useRebindDriveFile awaits the server, updates detail cache, and invalidates ['drive', wsId]", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({
        file: sampleFile({
          connection_id: "conn2",
          bound_account_email: "lan@gmail.com",
          bound_by_id: "u2",
          bound_by_name: "Lan",
        }),
      }),
    );
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useRebindDriveFile("ws1", "df1"), {
      wrapper: makeWrapper(qc),
    });

    const updated = await result.current.mutateAsync({ connection_id: "conn2" });
    expect(updated.bound_account_email).toBe("lan@gmail.com");
    expect(qc.getQueryData< { bound_account_email: string }>(driveLibraryKeys.detail("ws1", "df1"))?.bound_account_email).toBe("lan@gmail.com");
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["drive", "ws1"] });
  });

  it("useRebindDriveFile still invalidates ['drive', wsId] when a 200 response body is malformed", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ file: null }));
    const siblingKey = ["drive", "ws1", "connections"] as const;
    qc.setQueryData(siblingKey, [{ id: "conn1" }]);
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useRebindDriveFile("ws1", "df1"), {
      wrapper: makeWrapper(qc),
    });

    await expect(result.current.mutateAsync({ connection_id: "conn2" })).rejects.toThrow(
      "drive file rebind not verifiable",
    );
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["drive", "ws1"] });
    expect(qc.getQueryState(siblingKey)?.isInvalidated).toBe(true);
  });

  it("useAttachDriveFileToTask posts to /drive-files with task_id and invalidates detail, list, and task drive-files keys", async () => {
    qc.setQueryData(driveLibraryKeys.detail("ws1", "df1"), sampleFile());
    qc.setQueryData(driveLibraryKeys.list("ws1"), { pages: [], pageParams: [] });
    qc.setQueryData(driveLibraryKeys.task("ws1", "t1"), []);

    vi.mocked(fetch).mockResolvedValueOnce(
      json({
        results: [
          {
            external_file_id: "ext1",
            outcome: "already_linked",
            account_email: "minh@gmail.com",
          },
        ],
      }),
    );

    const { result } = renderHook(() => useAttachDriveFileToTask("ws1"), {
      wrapper: makeWrapper(qc),
    });

    await result.current.mutateAsync({
      driveFileId: "df1",
      connectionId: "conn1",
      externalFileId: "ext1",
      taskId: "t1",
    });

    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      "http://api.test/api/v1/workspaces/ws1/drive-files",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          connection_id: "conn1",
          external_file_ids: ["ext1"],
          task_id: "t1",
        }),
      }),
    );
    expect(qc.getQueryState(driveLibraryKeys.detail("ws1", "df1"))?.isInvalidated).toBe(true);
    expect(qc.getQueryState(driveLibraryKeys.list("ws1"))?.isInvalidated).toBe(true);
    expect(qc.getQueryState(driveLibraryKeys.task("ws1", "t1"))?.isInvalidated).toBe(true);
  });
  it("keys the folder lists under the workspace Drive prefix, per connection", () => {
    expect(driveLibraryKeys.folderLists("ws-1")).toEqual(["drive", "ws-1", "library-folders"]);
    expect(driveLibraryKeys.folders("ws-1", "c1")).toEqual(["drive", "ws-1", "library-folders", "c1"]);
    expect(driveLibraryKeys.folders("ws-1")).toEqual(["drive", "ws-1", "library-folders", "all"]);
  });

  it("useDriveFolders reads the list of one connection and stays idle without a workspace", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ folders: [{ id: "fld1", name: "Hợp đồng", file_count: 2 }] }));
    const { result } = renderHook(() => useDriveFolders("ws1", "conn1"), { wrapper: makeWrapper(qc) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([{ id: "fld1", name: "Hợp đồng", file_count: 2 }]);
    renderHook(() => useDriveFolders("", "conn1"), { wrapper: makeWrapper(qc) });
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it("useNameDriveFolder awaits the server, then marks folder lists, file lists and details stale", async () => {
    const folderKey = driveLibraryKeys.folders("ws1", "conn1");
    const listKey = driveLibraryKeys.list("ws1", "conn1");
    const detailKey = driveLibraryKeys.detail("ws1", "df1");
    const otherKey = ["drive", "ws1", "connections"] as const;
    qc.setQueryData(folderKey, []);
    qc.setQueryData(listKey, { pages: [], pageParams: [] });
    qc.setQueryData(detailKey, null);
    qc.setQueryData(otherKey, []);

    vi.mocked(fetch).mockResolvedValueOnce(json({ drive_folder: { id: "fld1", name: "Hợp đồng" }, updated_count: 3 }));
    const { result } = renderHook(() => useNameDriveFolder("ws1"), { wrapper: makeWrapper(qc) });
    const out = await result.current.mutateAsync({ folderId: "fld1", connectionId: "conn1" });

    expect(out.updated_count).toBe(3);
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toBe("http://api.test/api/v1/workspaces/ws1/drive-folders/fld1/name");
    expect(JSON.parse(String(init?.body))).toEqual({ drive_connection_id: "conn1" });
    for (const key of [folderKey, listKey, detailKey]) {
      expect(qc.getQueryState(key)?.isInvalidated).toBe(true);
    }
    expect(qc.getQueryState(otherKey)?.isInvalidated).toBe(false);
  });

  it("useNameDriveFolder leaves the caches alone when the server refuses", async () => {
    const folderKey = driveLibraryKeys.folders("ws1", "conn1");
    qc.setQueryData(folderKey, []);
    vi.mocked(fetch).mockResolvedValueOnce(json({ error: { code: "drive_folder_not_found", message: "x" } }, 404));
    const { result } = renderHook(() => useNameDriveFolder("ws1"), { wrapper: makeWrapper(qc) });
    await expect(result.current.mutateAsync({ folderId: "fld1", connectionId: "conn1" })).rejects.toMatchObject({
      status: 404,
    });
    expect(qc.getQueryState(folderKey)?.isInvalidated).toBe(false);
  });
});
