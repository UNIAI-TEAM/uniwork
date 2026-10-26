import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDriveTaskProposal,
  disconnectDriveConnection,
  getDrivePickerToken,
  getDriveTaskProposal,
  grantDriveFileAccess,
  isDriveConnectionLost,
  linkDriveFiles,
  listDriveConnections,
  listTaskDriveFiles,
  removeTaskDriveFile,
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

    const controller = new AbortController();
    requestMock.mockResolvedValueOnce({ results: [] });
    await linkDriveFiles(
      "ws1",
      {
        connection_id: "dc_1",
        external_file_ids: ["gdoc_1"],
      },
      controller.signal,
    );
    expect(requestMock).toHaveBeenLastCalledWith("/api/v1/workspaces/ws1/drive-files", {
      method: "POST",
      body: {
        connection_id: "dc_1",
        external_file_ids: ["gdoc_1"],
      },
      signal: controller.signal,
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

  it("listTaskDriveFiles parses task Drive cards, fills defaults, and preserves tasks_created", async () => {
    requestMock.mockResolvedValueOnce({
      files: [
        {
          id: "df_1",
          task_id: "t_1",
          workspace_id: "ws_1",
          external_file_id: "gdoc_1",
          name: "Kế hoạch ra mắt Q4",
          mime_type: "application/vnd.google-apps.document",
          icon_kind: "google_doc",
          sharing_state: "private",
          owner_display: "Lan",
          drive_modified_at: "2026-10-26T07:30:00Z",
          drive_modified_by_display: "Lan",
          connection_id: "dc_1",
          bound_account_email: "uni-work1@gmail.com",
          bound_connection_lost: false,
          bound_by_id: "u_1",
          bound_by_name: "Minh Nguyễn",
          created_by: "u_1",
          created_by_name: "Minh Nguyễn",
          linked_at: "2026-10-26T08:20:00Z",
          viewer_access: "granted",
          viewer_connection_id: "dc_1",
          viewer_account_email: "uni-work1@gmail.com",
          open_url: "https://docs.google.com/document/d/gdoc_1/edit?authuser=uni-work1%40gmail.com",
          can_remove_from_task: true,
          can_propose: true,
          can_ask: true,
          tasks_created: {
            count: 4,
            last_created_at: "2026-10-26T09:58:00Z",
            last_created_by_name: "Minh Nguyễn",
          },
        },
      ],
    });

    const cards = await listTaskDriveFiles("t 1");
    expect(requestMock).toHaveBeenCalledWith("/api/v1/tasks/t%201/drive-files");
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      id: "df_1",
      name: "Kế hoạch ra mắt Q4",
      icon_kind: "google_doc",
      viewer_access: "granted",
      can_remove_from_task: true,
      tasks_created: {
        count: 4,
        last_created_at: "2026-10-26T09:58:00Z",
        last_created_by_name: "Minh Nguyễn",
      },
    });
  });

  it("listTaskDriveFiles degrades a malformed response to an empty list and drops only malformed items", async () => {
    requestMock.mockResolvedValueOnce({ files: "not-an-array" });
    await expect(listTaskDriveFiles("t1")).resolves.toEqual([]);

    requestMock.mockResolvedValueOnce(null);
    await expect(listTaskDriveFiles("t1")).resolves.toEqual([]);

    requestMock.mockResolvedValueOnce({
      files: [
        { id: 123 },
        {
          id: "df_2",
          task_id: "t1",
          workspace_id: "ws1",
          external_file_id: "gdoc_2",
          name: "Slide pitch",
          mime_type: "application/vnd.google-apps.presentation",
          connection_id: "dc_1",
          bound_account_email: "uni-work1@gmail.com",
          bound_by_id: "u_1",
          created_by: "u_1",
          linked_at: "2026-10-26T08:20:00Z",
          open_url: "https://docs.google.com/presentation/d/gdoc_2/edit",
        },
      ],
    });
    const partial = await listTaskDriveFiles("t1");
    expect(partial).toHaveLength(1);
    expect(partial[0]?.id).toBe("df_2");
    expect(partial[0]?.icon_kind).toBe("generic");
    expect(partial[0]?.viewer_access).toBe("unknown");
    expect(partial[0]?.tasks_created).toEqual({ count: 0 });
  });

  it("removeTaskDriveFile deletes by encoded task and drive file ids and degrades a malformed body without throwing", async () => {
    requestMock.mockResolvedValueOnce({ status: "ok" });
    await expect(removeTaskDriveFile("t 1", "df 1")).resolves.toBeUndefined();
    expect(requestMock).toHaveBeenCalledWith("/api/v1/tasks/t%201/drive-files/df%201", {
      method: "DELETE",
    });

    requestMock.mockResolvedValueOnce(null);
    await expect(removeTaskDriveFile("t1", "df1")).resolves.toBeUndefined();
  });

  it("grantDriveFileAccess posts connection_id and parses the DriveFileSDO response", async () => {
    requestMock.mockResolvedValueOnce({
      file: {
        id: "df_1",
        organization_id: "org_1",
        workspace_id: "ws_1",
        external_file_id: "gdoc_1",
        name: "Kế hoạch ra mắt Q4",
        mime_type: "application/vnd.google-apps.document",
        icon_kind: "google_doc",
        web_view_link: "https://docs.google.com/document/d/gdoc_1/edit",
        open_url: "https://docs.google.com/document/d/gdoc_1/edit?authuser=mai%40gmail.com",
        owner_display: "Lan",
        sharing_state: "shared",
        connection_id: "dc_1",
        bound_account_email: "uni-work1@gmail.com",
        bound_connection_lost: false,
        bound_by_id: "u_1",
        bound_by_name: "Minh Nguyễn",
        created_by: "u_1",
        created_by_kind: "human",
        created_by_name: "Minh Nguyễn",
        created_at: "2026-10-26T08:15:00Z",
        updated_at: "2026-10-26T08:25:00Z",
        viewer_access: "granted",
        viewer_connection_id: "dc_2",
        viewer_account_email: "mai@gmail.com",
        can_unlink: false,
        can_rebind: false,
        can_propose: true,
        can_ask: true,
        used_in_count: 1,
        used_in_tasks: [
          {
            task_id: "t_1",
            identifier: "UNI-1042",
            title: "Chuẩn bị kế hoạch ra mắt Q4",
            status: "todo",
          },
        ],
        tasks_created: { count: 0 },
      },
    });

    const file = await grantDriveFileAccess("ws 1", "df 1", "dc_2");
    expect(requestMock).toHaveBeenCalledWith(
      "/api/v1/workspaces/ws%201/drive-files/df%201/access",
      { method: "POST", body: { connection_id: "dc_2" } },
    );
    expect(file?.id).toBe("df_1");
    expect(file?.viewer_access).toBe("granted");
    expect(file?.viewer_account_email).toBe("mai@gmail.com");
  });

  it("grantDriveFileAccess degrades a malformed response to null", async () => {
    requestMock.mockResolvedValueOnce({ file: { id: 42 } });
    await expect(grantDriveFileAccess("ws1", "df1", "dc2")).resolves.toBeNull();
  });

  it("createDriveTaskProposal posts prompt/project/parent/context and parses DriveTaskProposalSDO", async () => {
    requestMock.mockResolvedValueOnce({
      proposal: {
        id: "dtp_1",
        workspace_id: "ws_1",
        drive_file_id: "df_1",
        drive_file_name: "Kế hoạch ra mắt Q4",
        drive_file_mime_type: "application/vnd.google-apps.document",
        drive_file_icon_kind: "google_doc",
        sharing_state: "shared",
        connection_id: "dc_1",
        reader_account_email: "uni-work1@gmail.com",
        requested_by: "u_1",
        prompt: "Tạo việc cho mục Phân công",
        project_id: "p_1",
        parent_task_id: "t_1042",
        context_task_id: "t_1042",
        truncated: true,
        status: "ready",
        items: [
          {
            index: 0,
            title: "Chốt phạm vi tính năng beta",
            assignee_member_id: "m_1",
            assignee_basis: "Tài liệu: 'Lan chốt phạm vi'",
            assignee_drive_access: "granted",
            priority: "high",
            priority_basis: "Chặn các việc sau",
            start_date: "2026-10-27",
            due_date: "2026-11-05",
            due_basis: "Mục 3: 'trước 05/11'",
            label_ids: ["l_1"],
            goal: "Chốt danh sách tính năng beta",
            checklist: ["Liệt kê tính năng", "Họp chốt"],
            excerpt: { section: "Mục 2", quote: "Nhóm sản phẩm chốt phạm vi beta" },
            blocked_by_indexes: [],
            possible_duplicate: {
              task_id: "t_1037",
              identifier: "UNI-1037",
              title: "Chốt phạm vi beta",
            },
          },
          {
            index: "not-a-number",
            title: "Malformed item dropped",
          },
        ],
        tasks_created: {
          count: 4,
          last_created_at: "2026-10-25T10:00:00Z",
          last_created_by_name: "Lan",
        },
        prior_creations: [
          {
            proposal_id: "dtp_prev",
            created_at: "2026-10-25T10:00:00Z",
            created_by_id: "u_2",
            created_by_name: "Lan",
            tasks: [
              {
                task_id: "t_1051",
                identifier: "UNI-1051",
                title: "Việc trước",
                status: "todo",
              },
            ],
          },
        ],
        created_at: "2026-10-26T10:00:00Z",
        expires_at: "2026-11-02T10:00:00Z",
      },
    });

    const controller = new AbortController();
    const proposal = await createDriveTaskProposal(
      "ws 1",
      "df 1",
      {
        prompt: "Tạo việc cho mục Phân công",
        project_id: "p_1",
        parent_task_id: "t_1042",
        context_task_id: "t_1042",
      },
      controller.signal,
    );

    expect(requestMock).toHaveBeenCalledWith(
      "/api/v1/workspaces/ws%201/drive-files/df%201/task-proposals",
      {
        method: "POST",
        body: {
          prompt: "Tạo việc cho mục Phân công",
          project_id: "p_1",
          parent_task_id: "t_1042",
          context_task_id: "t_1042",
        },
        signal: controller.signal,
      },
    );
    expect(proposal?.id).toBe("dtp_1");
    expect(proposal?.truncated).toBe(true);
    expect(proposal?.items).toHaveLength(1);
    expect(proposal?.items[0]?.title).toBe("Chốt phạm vi tính năng beta");
    expect(proposal?.items[0]?.possible_duplicate?.identifier).toBe("UNI-1037");
    expect(proposal?.tasks_created).toEqual({
      count: 4,
      last_created_at: "2026-10-25T10:00:00Z",
      last_created_by_name: "Lan",
    });
    expect(proposal?.prior_creations).toHaveLength(1);
  });

  it("createDriveTaskProposal omits blank prompt and degrades malformed responses to null", async () => {
    requestMock.mockResolvedValueOnce({ proposal: { id: 123 } });
    const result = await createDriveTaskProposal("ws1", "df1", { prompt: "   " });
    expect(requestMock).toHaveBeenCalledWith(
      "/api/v1/workspaces/ws1/drive-files/df1/task-proposals",
      { method: "POST", body: {}, signal: undefined },
    );
    expect(result).toBeNull();
  });

  it("createDriveTaskProposal degrades malformed optional proposal fields to defaults via .catch without losing the proposal", async () => {
    requestMock.mockResolvedValueOnce({
      proposal: {
        id: "dtp_catch",
        workspace_id: "ws_1",
        drive_file_id: "df_1",
        drive_file_name: "Kế hoạch ra mắt Q4",
        drive_file_mime_type: 123,
        drive_file_icon_kind: { bad: true },
        sharing_state: 456,
        connection_id: "dc_1",
        reader_account_email: null,
        requested_by: "u_1",
        status: 789,
        items: [{ index: 0, title: "Việc hợp lệ" }],
        created_at: "2026-10-26T10:00:00Z",
        expires_at: "2026-11-02T10:00:00Z",
      },
    });

    const proposal = await createDriveTaskProposal("ws1", "df1");
    expect(proposal).not.toBeNull();
    expect(proposal?.id).toBe("dtp_catch");
    expect(proposal?.drive_file_mime_type).toBe("");
    expect(proposal?.drive_file_icon_kind).toBe("generic");
    expect(proposal?.sharing_state).toBe("unknown");
    expect(proposal?.reader_account_email).toBe("");
    expect(proposal?.status).toBe("ready");
    expect(proposal?.items).toHaveLength(1);
    expect(proposal?.items[0]?.title).toBe("Việc hợp lệ");
  });

  it("getDriveTaskProposal fetches by encoded proposal ID and degrades malformed responses to null", async () => {
    requestMock.mockResolvedValueOnce({
      proposal: {
        id: "dtp_2",
        workspace_id: "ws_1",
        drive_file_id: "df_1",
        drive_file_name: "Kế hoạch ra mắt Q4",
        connection_id: "dc_1",
        requested_by: "u_1",
        created_at: "2026-10-26T10:00:00Z",
        expires_at: "2026-11-02T10:00:00Z",
      },
    });

    const proposal = await getDriveTaskProposal("ws 1", "dtp 2");
    expect(requestMock).toHaveBeenCalledWith(
      "/api/v1/workspaces/ws%201/drive-task-proposals/dtp%202",
      { signal: undefined },
    );
    expect(proposal?.id).toBe("dtp_2");
    expect(proposal?.status).toBe("ready");
    expect(proposal?.items).toEqual([]);
    expect(proposal?.tasks_created).toEqual({ count: 0 });
    expect(proposal?.prior_creations).toEqual([]);

    requestMock.mockResolvedValueOnce("not-an-object");
    await expect(getDriveTaskProposal("ws1", "dtp2")).resolves.toBeNull();
  });
});
