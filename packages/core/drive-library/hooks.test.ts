import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../runtime-config";
import { setAccessToken } from "../api/session";
import {
  driveLibraryKeys,
  useDriveFile,
  useDriveFiles,
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

  it("useUnlinkDriveFile awaits the server and invalidates ['drive', wsId]", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ status: "ok" }));
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useUnlinkDriveFile("ws1"), {
      wrapper: makeWrapper(qc),
    });

    await result.current.mutateAsync("df1");
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["drive", "ws1"] });
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
});
