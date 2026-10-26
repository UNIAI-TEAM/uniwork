import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor, act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  driveKeys,
  useDisconnectDriveConnection,
  useDriveConnections,
  useDrivePickerToken,
  useLinkDriveFiles,
  useStartDriveConnect,
  type DriveFileLinkResults,
  type DrivePickerToken,
} from "./hooks";
const requestMock = vi.fn();
vi.mock("../api/http", () => ({ request: (...args: unknown[]) => requestMock(...args) }));

function createWrapper(qc: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

describe("drive hooks", () => {
  beforeEach(() => {
    requestMock.mockReset();
  });

  it("nests connections under driveKeys.workspace(wsId) and driveKeys.all", () => {
    expect(driveKeys.all).toEqual(["drive"]);
    expect(driveKeys.workspace("ws1")).toEqual(["drive", "ws1"]);
    expect(driveKeys.connections("ws1")).toEqual(["drive", "ws1", "connections"]);
  });

  it("useDriveConnections fetches connections for the workspace and skips when disabled", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    requestMock.mockResolvedValueOnce({
      connections: [
        {
          id: "dc_1",
          provider: "google",
          google_email: "uni-work1@gmail.com",
          status: "active",
          needs_reconnect: false,
          linked_file_count: 2,
          connected_at: "2026-10-26T09:42:00Z",
          updated_at: "2026-10-26T09:42:00Z",
        },
      ],
    });

    const disabledHook = renderHook(() => useDriveConnections("ws1", { enabled: false }), {
      wrapper: createWrapper(qc),
    });
    expect(disabledHook.result.current.fetchStatus).toBe("idle");
    expect(requestMock).not.toHaveBeenCalled();

    const enabledHook = renderHook(() => useDriveConnections("ws1"), {
      wrapper: createWrapper(qc),
    });
    await waitFor(() => expect(enabledHook.result.current.isSuccess).toBe(true));
    expect(enabledHook.result.current.data?.connections).toHaveLength(1);
    expect(enabledHook.result.current.data?.connections[0]?.google_email).toBe("uni-work1@gmail.com");
  });

  it("useStartDriveConnect resolves the consent URL with optional reconnect_connection_id", async () => {
    const qc = new QueryClient();
    requestMock.mockResolvedValueOnce({ authorization_url: "https://accounts.google.test/o/oauth2/v2/auth?state=s" });

    const { result } = renderHook(() => useStartDriveConnect("ws1"), {
      wrapper: createWrapper(qc),
    });

    let url: string | null = null;
    await act(async () => {
      url = await result.current.mutateAsync({ reconnect_connection_id: "dc_1" });
    });

    expect(url).toBe("https://accounts.google.test/o/oauth2/v2/auth?state=s");
    expect(requestMock).toHaveBeenCalledWith(
      "/api/v1/workspaces/ws1/drive-connections/google/start",
      { method: "POST", body: { reconnect_connection_id: "dc_1" } },
    );
  });

  it("useDisconnectDriveConnection awaits the server and invalidates driveKeys.workspace(wsId)", async () => {
    const qc = new QueryClient();
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
    requestMock.mockResolvedValueOnce({ status: "ok" });

    const { result } = renderHook(() => useDisconnectDriveConnection("ws1"), {
      wrapper: createWrapper(qc),
    });

    await act(async () => {
      await result.current.mutateAsync("dc_1");
    });

    expect(requestMock).toHaveBeenCalledWith(
      "/api/v1/workspaces/ws1/drive-connections/dc_1",
      { method: "DELETE" },
    );
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: driveKeys.workspace("ws1") });
  });

  it("useDrivePickerToken fetches a short-lived picker token imperatively without caching", async () => {
    const qc = new QueryClient();
    const tokenPayload = {
      access_token: "picker-tok",
      expires_at: "2026-10-26T11:00:00Z",
      developer_key: "dev-key",
      app_id: "app-1",
    };
    requestMock.mockResolvedValueOnce(tokenPayload);

    const { result } = renderHook(() => useDrivePickerToken("ws1"), {
      wrapper: createWrapper(qc),
    });

    let token: DrivePickerToken | null = null;
    await act(async () => {
      token = await result.current.mutateAsync("dc_1");
    });

    expect(token).toEqual(tokenPayload);
    expect(requestMock).toHaveBeenCalledWith(
      "/api/v1/workspaces/ws1/drive-connections/dc_1/picker-token",
      { method: "POST", body: {} },
    );
    expect(qc.getQueryCache().getAll()).toHaveLength(0);
  });

  it("useLinkDriveFiles awaits the server and invalidates driveKeys.workspace(wsId)", async () => {
    const qc = new QueryClient();
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
    requestMock.mockResolvedValueOnce({
      results: [
        {
          external_file_id: "gdoc_1",
          outcome: "linked",
          file: {
            id: "df_1",
            workspace_id: "ws1",
            external_file_id: "gdoc_1",
            name: "Kế hoạch ra mắt Q4",
            mime_type: "application/vnd.google-apps.document",
            icon_kind: "google_doc",
            sharing_state: "private",
            web_view_link: "https://docs.google.com/document/d/gdoc_1/edit",
            open_url: "https://docs.google.com/document/d/gdoc_1/edit?authuser=uni-work1%40gmail.com",
            viewer_access: "granted",
          },
        },
      ],
    });

    const { result } = renderHook(() => useLinkDriveFiles("ws1"), {
      wrapper: createWrapper(qc),
    });

    let response: DriveFileLinkResults | undefined;
    await act(async () => {
      response = await result.current.mutateAsync({
        connection_id: "dc_1",
        external_file_ids: ["gdoc_1"],
        task_id: "task_1",
      });
    });

    expect(requestMock).toHaveBeenCalledWith("/api/v1/workspaces/ws1/drive-files", {
      method: "POST",
      body: {
        connection_id: "dc_1",
        external_file_ids: ["gdoc_1"],
        task_id: "task_1",
      },
    });
    expect(response?.results).toHaveLength(1);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: driveKeys.workspace("ws1") });
  });
});
