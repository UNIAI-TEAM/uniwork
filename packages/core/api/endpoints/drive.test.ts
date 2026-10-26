import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  disconnectDriveConnection,
  getDrivePickerToken,
  isDriveConnectionLost,
  linkDriveFiles,
  listDriveConnections,
  startDriveConnect,
} from "./drive";

const requestMock = vi.fn();
vi.mock("../http", () => ({ request: (...args: unknown[]) => requestMock(...args) }));

const connection = {
  id: "dc_1",
  provider: "google",
  google_email: "uni-work1@gmail.com",
  status: "active",
  needs_reconnect: false,
  linked_file_count: 3,
  connected_at: "2026-10-26T09:42:00Z",
  updated_at: "2026-10-26T09:42:00Z",
};

describe("drive endpoints", () => {
  beforeEach(() => requestMock.mockReset());

  it("listDriveConnections parses connections and fills optional fields", async () => {
    requestMock.mockResolvedValueOnce({ connections: [connection] });
    const res = await listDriveConnections("ws 1");
    expect(requestMock).toHaveBeenCalledWith("/api/v1/workspaces/ws%201/drive-connections");
    expect(res).toEqual({
      connections: [
        {
          ...connection,
          auth_failed_reason: "",
        },
      ],
    });
    expect(isDriveConnectionLost(res.connections[0]!)).toBe(false);
  });

  it("listDriveConnections keeps unknown status as active-but-unknown and marks needs_reconnect as lost", async () => {
    const unknownStatus = { ...connection, id: "dc_2", status: "future_state" };
    const failedStatus = { ...connection, id: "dc_3", status: "needs_reconnect" };
    const failedFlag = {
      ...connection,
      id: "dc_4",
      status: "active",
      needs_reconnect: true,
      auth_failed_at: "2026-10-26T10:00:00Z",
      auth_failed_reason: "invalid_grant",
    };
    requestMock.mockResolvedValueOnce({
      connections: [unknownStatus, failedStatus, failedFlag],
    });
    const res = await listDriveConnections("ws1");
    expect(res.connections).toHaveLength(3);
    expect(res.connections[0]!.status).toBe("future_state");
    expect(isDriveConnectionLost(res.connections[0]!)).toBe(false);
    expect(isDriveConnectionLost(res.connections[1]!)).toBe(true);
    expect(isDriveConnectionLost(res.connections[2]!)).toBe(true);
    expect(res.connections[2]!.auth_failed_at).toBe("2026-10-26T10:00:00Z");

    const driftedAuthFailedAt = { ...connection, id: "dc_5", auth_failed_at: null };
    requestMock.mockResolvedValueOnce({ connections: [driftedAuthFailedAt] });
    const driftedRes = await listDriveConnections("ws1");
    expect(driftedRes.connections[0]!.auth_failed_at).toBeUndefined();
  });

  it("listDriveConnections degrades a malformed response to an empty list", async () => {
    requestMock.mockResolvedValueOnce({ connections: [{ id: 123 }] });
    await expect(listDriveConnections("ws1")).resolves.toEqual({ connections: [] });

    requestMock.mockResolvedValueOnce("not-json");
    await expect(listDriveConnections("ws1")).resolves.toEqual({ connections: [] });
  });

  it("startDriveConnect posts an empty object by default and reconnect_connection_id when reconnecting", async () => {
    requestMock.mockResolvedValueOnce({
      authorization_url: "https://accounts.google.test/o/oauth2/v2/auth?state=s1",
    });
    await expect(startDriveConnect("ws 1")).resolves.toBe(
      "https://accounts.google.test/o/oauth2/v2/auth?state=s1",
    );
    expect(requestMock).toHaveBeenCalledWith(
      "/api/v1/workspaces/ws%201/drive-connections/google/start",
      { method: "POST", body: {} },
    );

    requestMock.mockResolvedValueOnce({
      authorization_url: "https://accounts.google.test/o/oauth2/v2/auth?state=s2",
    });
    await expect(
      startDriveConnect("ws1", { reconnect_connection_id: "dc_1" }),
    ).resolves.toBe("https://accounts.google.test/o/oauth2/v2/auth?state=s2");
    expect(requestMock).toHaveBeenLastCalledWith(
      "/api/v1/workspaces/ws1/drive-connections/google/start",
      { method: "POST", body: { reconnect_connection_id: "dc_1" } },
    );
  });

  it("startDriveConnect degrades a malformed response to null", async () => {
    requestMock.mockResolvedValueOnce({ authorization_url: 42 });
    await expect(startDriveConnect("ws1")).resolves.toBeNull();

    requestMock.mockResolvedValueOnce({});
    await expect(startDriveConnect("ws1")).resolves.toBeNull();
  });

  it("disconnectDriveConnection deletes by encoded id and degrades a malformed body without throwing", async () => {
    requestMock.mockResolvedValueOnce({ status: "ok" });
    await expect(disconnectDriveConnection("ws 1", "dc/1")).resolves.toBeUndefined();
    expect(requestMock).toHaveBeenCalledWith(
      "/api/v1/workspaces/ws%201/drive-connections/dc%2F1",
      { method: "DELETE" },
    );

    requestMock.mockResolvedValueOnce({ status: 123 });
    await expect(disconnectDriveConnection("ws1", "dc_1")).resolves.toBeUndefined();

    requestMock.mockResolvedValueOnce("not-an-object");
    await expect(disconnectDriveConnection("ws1", "dc_1")).resolves.toBeUndefined();
  });

  it("getDrivePickerToken posts an empty body and parses the picker token SDO", async () => {
    const tokenPayload = {
      access_token: "picker-tok",
      expires_at: "2026-10-26T11:00:00Z",
      developer_key: "dev-key",
      app_id: "app-1",
    };
    requestMock.mockResolvedValueOnce(tokenPayload);
    const res = await getDrivePickerToken("ws 1", "dc/1");
    expect(requestMock).toHaveBeenCalledWith(
      "/api/v1/workspaces/ws%201/drive-connections/dc%2F1/picker-token",
      { method: "POST", body: {} },
    );
    expect(res).toEqual(tokenPayload);
  });

  it("getDrivePickerToken degrades a malformed response to null", async () => {
    requestMock.mockResolvedValueOnce({ access_token: "" });
    await expect(getDrivePickerToken("ws1", "dc_1")).resolves.toBeNull();

    requestMock.mockResolvedValueOnce({ access_token: 42 });
    await expect(getDrivePickerToken("ws1", "dc_1")).resolves.toBeNull();

    requestMock.mockResolvedValueOnce("bad-json");
    await expect(getDrivePickerToken("ws1", "dc_1")).resolves.toBeNull();
  });

  it("linkDriveFiles posts connection_id, external_file_ids, and optional task_id and parses receipts", async () => {
    const receipt = {
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
      viewer_connection_id: "dc_1",
      viewer_account_email: "uni-work1@gmail.com",
    };
    requestMock.mockResolvedValueOnce({
      results: [
        { external_file_id: "gdoc_1", outcome: "linked", file: receipt },
        {
          external_file_id: "gdoc_2",
          outcome: "already_linked",
          file: { ...receipt, id: "df_2", external_file_id: "gdoc_2", drive_id: "sd_1" },
          account_email: "uni-work1@gmail.com",
        },
        {
          external_file_id: "gdoc_3",
          outcome: "error",
          error_code: "drive_grant_required",
          error_message: "User has not authorized file",
        },
      ],
    });

    const res = await linkDriveFiles("ws 1", {
      connection_id: "dc_1",
      external_file_ids: ["gdoc_1", "gdoc_2", "gdoc_3"],
      task_id: "task_1",
    });

    expect(requestMock).toHaveBeenCalledWith("/api/v1/workspaces/ws%201/drive-files", {
      method: "POST",
      body: {
        connection_id: "dc_1",
        external_file_ids: ["gdoc_1", "gdoc_2", "gdoc_3"],
        task_id: "task_1",
      },
    });
    expect(res.results).toHaveLength(3);
    expect(res.results[0]?.outcome).toBe("linked");
    expect(res.results[0]?.file?.sharing_state).toBe("private");
    expect(res.results[1]?.account_email).toBe("uni-work1@gmail.com");
    expect(res.results[1]?.file?.drive_id).toBe("sd_1");
    expect(res.results[2]?.error_code).toBe("drive_grant_required");

    requestMock.mockResolvedValueOnce({ results: [] });
    await linkDriveFiles("ws1", {
      connection_id: "dc_1",
      external_file_ids: ["gdoc_1"],
      task_id: null,
    });
    expect(requestMock).toHaveBeenLastCalledWith("/api/v1/workspaces/ws1/drive-files", {
      method: "POST",
      body: {
        connection_id: "dc_1",
        external_file_ids: ["gdoc_1"],
      },
    });
  });

  it("linkDriveFiles degrades a malformed response to an empty results list and drops only malformed items in a batch", async () => {
    requestMock.mockResolvedValueOnce({ results: [{ external_file_id: 99 }] });
    await expect(
      linkDriveFiles("ws1", { connection_id: "dc_1", external_file_ids: ["gdoc_1"] }),
    ).resolves.toEqual({ results: [] });

    requestMock.mockResolvedValueOnce(null);
    await expect(
      linkDriveFiles("ws1", { connection_id: "dc_1", external_file_ids: ["gdoc_1"] }),
    ).resolves.toEqual({ results: [] });

    requestMock.mockResolvedValueOnce({
      results: [
        { external_file_id: 99 },
        {
          external_file_id: "gdoc_2",
          outcome: "linked",
        },
      ],
    });
    const partial = await linkDriveFiles("ws1", {
      connection_id: "dc_1",
      external_file_ids: ["gdoc_1", "gdoc_2"],
    });
    expect(partial.results).toEqual([
      {
        external_file_id: "gdoc_2",
        outcome: "linked",
        file: undefined,
        account_email: undefined,
        error_code: undefined,
        error_message: undefined,
      },
    ]);
  });
});
