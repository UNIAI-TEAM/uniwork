import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../runtime-config";
import { setAccessToken } from "../api/session";
import { useDriveAccountFolders } from "./use-account-folders";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function makeWrapper(qc: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: qc }, children);
  };
}

const notFound = () => json({ error: { code: "not_found", message: "no" } }, 404);

const groups = () =>
  json({
    folders: [
      { id: "fld-2", name: "Báo cáo", file_count: 5 },
      { id: "zz9999", name: null, file_count: 1 },
      { id: "fld-1", name: "Dự án Beta", file_count: 2 },
      { id: null, name: null, file_count: 7 },
    ],
  });

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

  it("does not fetch without an account or while disabled", () => {
    renderHook(() => useDriveAccountFolders("ws1", null), { wrapper: makeWrapper(qc) });
    renderHook(() => useDriveAccountFolders("ws1", "conn1", { enabled: false }), { wrapper: makeWrapper(qc) });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("takes the folders and their counts from the server list in one request and never reads the files", async () => {
    vi.mocked(fetch).mockImplementation(() => Promise.resolve(groups()));
    const { result } = renderHook(() => useDriveAccountFolders("ws1", "conn1", { locale: "vi" }), {
      wrapper: makeWrapper(qc),
    });
    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(result.current.folders.map((f) => [f.id, f.name, f.fileCount])).toEqual([
      ["fld-2", "Báo cáo", 5],
      ["fld-1", "Dự án Beta", 2],
      ["zz9999", null, 1],
    ]);
    expect(String(folderCalls()[0]![0])).toContain("drive_connection_id=conn1");
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
    expect(result.current.isError).toBe(false);
  });

  it("an empty list is a valid answer: no folders, no error", async () => {
    vi.mocked(fetch).mockImplementation(() => Promise.resolve(json({ folders: [] })));
    const { result } = renderHook(() => useDriveAccountFolders("ws1", "conn1"), { wrapper: makeWrapper(qc) });
    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(result.current.folders).toEqual([]);
    expect(result.current.isError).toBe(false);
  });

  it.each([
    ["a 404", () => notFound()],
    ["a 500", () => json({ error: "boom" }, 500)],
    ["an answer with no folder list", () => json({ unexpected: true })],
  ])("reports %s as an error, with no folders derived from the files", async (_label, answer) => {
    vi.mocked(fetch).mockImplementation(() => Promise.resolve(answer()));
    const { result } = renderHook(() => useDriveAccountFolders("ws1", "conn1"), { wrapper: makeWrapper(qc) });
    await waitFor(() => expect(result.current.isError).toBe(true), { timeout: 5000 }); // a 5xx is retried once
    expect(result.current.isPending).toBe(false);
    expect(result.current.folders).toEqual([]);
    expect(vi.mocked(fetch).mock.calls.every(([url]) => String(url).includes("/drive-folders"))).toBe(true);
  });

  it("refetch asks the folder list again", async () => {
    vi.mocked(fetch).mockImplementation(() => Promise.resolve(groups()));
    const { result } = renderHook(() => useDriveAccountFolders("ws1", "conn1"), { wrapper: makeWrapper(qc) });
    await waitFor(() => expect(result.current.isPending).toBe(false));
    result.current.refetch();
    await waitFor(() => expect(folderCalls()).toHaveLength(2));
  });

  it("is pending until the list answers", () => {
    vi.mocked(fetch).mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useDriveAccountFolders("ws1", "conn1"), { wrapper: makeWrapper(qc) });
    expect(result.current.isPending).toBe(true);
  });
});
