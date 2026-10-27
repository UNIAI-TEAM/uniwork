import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../../runtime-config";
import { ApiError } from "../http";
import { setAccessToken } from "../session";
import {
  getDriveFile,
  listDriveFiles,
  rebindDriveFile,
  unlinkDriveFile,
} from "./drive-library";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const validFile = (over: Record<string, unknown> = {}) => ({
  id: "df1",
  organization_id: "org1",
  workspace_id: "ws1",
  external_file_id: "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms",
  name: "Kế hoạch ra mắt Q4",
  mime_type: "application/vnd.google-apps.document",
  icon_kind: "google_doc",
  web_view_link: "https://docs.google.com/document/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit",
  open_url: "https://docs.google.com/document/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit?authuser=uni-work1%40gmail.com",
  owner_display: "Lan",
  sharing_state: "private",
  connection_id: "conn1",
  bound_account_email: "uni-work1@gmail.com",
  bound_connection_lost: false,
  bound_by_id: "u1",
  bound_by_name: "Minh Nguyễn",
  created_by: "u1",
  created_by_kind: "human",
  created_by_name: "Minh Nguyễn",
  created_at: "2026-10-26T08:15:00Z",
  updated_at: "2026-10-26T08:15:00Z",
  viewer_access: "granted",
  viewer_connection_id: "conn1",
  viewer_account_email: "uni-work1@gmail.com",
  can_unlink: true,
  can_rebind: true,
  can_propose: true,
  can_ask: true,
  used_in_count: 1,
  used_in_tasks: [
    {
      task_id: "t1",
      identifier: "UNI-1042",
      title: "Chuẩn bị kế hoạch ra mắt Q4",
      status: "todo",
    },
  ],
  tasks_created: {
    count: 2,
    last_created_at: "2026-10-26T09:58:00Z",
    last_created_by_name: "Minh Nguyễn",
  },
  ...over,
});

describe("drive-library endpoints", () => {
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

  it("listDriveFiles requests the workspace drive-files endpoint with optional query params", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({ files: [validFile()], total_count: 1, next_cursor: "cur2" }),
    );
    const out = await listDriveFiles("ws1", { connection_id: "conn1", cursor: "cur1", limit: 25 });
    expect(vi.mocked(fetch).mock.calls[0]![0]).toBe(
      "http://api.test/api/v1/workspaces/ws1/drive-files?connection_id=conn1&cursor=cur1&limit=25",
    );
    expect(out.files).toHaveLength(1);
    expect(out.files[0]?.name).toBe("Kế hoạch ra mắt Q4");
    expect(out.total_count).toBe(1);
    expect(out.next_cursor).toBe("cur2");
  });

  it("listDriveFiles omits empty query parameters and accepts omitted optional fields", async () => {
    const minimalFile: Record<string, unknown> = {
      ...validFile(),
      tasks_created: { count: 0 },
    };
    delete minimalFile.viewer_connection_id;
    delete minimalFile.viewer_account_email;
    vi.mocked(fetch).mockResolvedValueOnce(
      json({ files: [minimalFile], total_count: 1, next_cursor: null }),
    );
    const out = await listDriveFiles("ws1", { connection_id: "", cursor: undefined });
    expect(vi.mocked(fetch).mock.calls[0]![0]).toBe(
      "http://api.test/api/v1/workspaces/ws1/drive-files",
    );
    expect(out.files[0]?.tasks_created).toEqual({ count: 0 });
    expect(out.next_cursor).toBeNull();
  });

  it("reads drive_folder leniently: named, unnamed, absent and null parents", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({
        files: [
          validFile({ id: "a", drive_folder: { id: "fld1", name: "Dự án Alpha" } }),
          validFile({ id: "b", drive_folder: { id: "fld2", name: null } }),
          validFile({ id: "c", drive_folder: { id: "fld3" } }),
          validFile({ id: "d", drive_folder: null }),
          validFile({ id: "e" }),
        ],
        total_count: 5,
        next_cursor: null,
      }),
    );
    const out = await listDriveFiles("ws1");
    expect(out.files.map((f) => f.drive_folder)).toEqual([
      { id: "fld1", name: "Dự án Alpha" },
      { id: "fld2", name: null },
      { id: "fld3", name: null },
      null,
      null,
    ]);
  });

  it("treats a malformed drive_folder as unknown without dropping the file or the page", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({
        files: [
          validFile({ id: "a", drive_folder: "fld1" }),
          validFile({ id: "b", drive_folder: { id: 7, name: "x" } }),
          validFile({ id: "c", drive_folder: { id: "", name: "x" } }),
          validFile({ id: "d", drive_folder: { id: "fld4", name: 12 } }),
          validFile({ id: "e", drive_folder: [] }),
        ],
        total_count: 5,
        next_cursor: null,
      }),
    );
    const out = await listDriveFiles("ws1");
    expect(out.files.map((f) => f.id)).toEqual(["a", "b", "c", "d", "e"]);
    expect(out.files.map((f) => f.drive_folder)).toEqual([null, null, null, { id: "fld4", name: null }, null]);
  });

  it("getDriveFile carries drive_folder and survives a malformed one", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({ file: validFile({ drive_folder: { id: "fld1", name: "Hồ sơ" } }) }),
    );
    await expect(getDriveFile("ws1", "df1")).resolves.toMatchObject({
      drive_folder: { id: "fld1", name: "Hồ sơ" },
    });
    vi.mocked(fetch).mockResolvedValueOnce(json({ file: validFile({ drive_folder: 5 }) }));
    await expect(getDriveFile("ws1", "df1")).resolves.toMatchObject({ drive_folder: null });
  });

  it("listDriveFiles degrades to an empty page on a malformed response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ files: "invalid" }));
    await expect(listDriveFiles("ws1")).resolves.toEqual({
      files: [],
      total_count: 0,
      next_cursor: null,
    });
  });

  it("listDriveFiles accepts null for files and used_in_tasks (nil Go slices)", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({ files: null, total_count: 0, next_cursor: null }),
    );
    await expect(listDriveFiles("ws1")).resolves.toEqual({
      files: [],
      total_count: 0,
      next_cursor: null,
    });

    vi.mocked(fetch).mockResolvedValueOnce(
      json({
        files: [validFile({ used_in_tasks: null })],
        total_count: 1,
        next_cursor: null,
      }),
    );
    const withNullTasks = await listDriveFiles("ws1");
    expect(withNullTasks.files[0]?.used_in_tasks).toEqual([]);
  });

  it("listDriveFiles lets future server enum strings pass through", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({
        files: [validFile({ icon_kind: "future_format", sharing_state: "org_wide", viewer_access: "pending" })],
        total_count: 1,
        next_cursor: null,
      }),
    );
    const out = await listDriveFiles("ws1");
    expect(out.files[0]?.icon_kind).toBe("future_format");
    expect(out.files[0]?.sharing_state).toBe("org_wide");
    expect(out.files[0]?.viewer_access).toBe("pending");
  });

  it("getDriveFile returns the file detail with task_creations", async () => {
    const fileWithCreations = validFile({
      task_creations: [
        {
          proposal_id: "prop1",
          created_at: "2026-10-26T09:58:00Z",
          created_by_id: "u1",
          created_by_name: "Minh Nguyễn",
          tasks: [{ task_id: "t1", identifier: "UNI-1051", title: "Chốt phạm vi beta", status: "todo" }],
        },
      ],
    });
    vi.mocked(fetch).mockResolvedValueOnce(json({ file: fileWithCreations }));
    const out = await getDriveFile("ws1", "df1");
    expect(vi.mocked(fetch).mock.calls[0]![0]).toBe(
      "http://api.test/api/v1/workspaces/ws1/drive-files/df1",
    );
    expect(out?.id).toBe("df1");
    expect(out?.task_creations).toHaveLength(1);
    expect(out?.task_creations?.[0]?.tasks[0]?.identifier).toBe("UNI-1051");
  });

  it("getDriveFile accepts null for used_in_tasks, task_creations, and tasks inside task_creations", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({
        file: validFile({
          used_in_tasks: null,
          task_creations: null,
        }),
      }),
    );
    const first = await getDriveFile("ws1", "df1");
    expect(first?.used_in_tasks).toEqual([]);
    expect(first?.task_creations).toEqual([]);

    vi.mocked(fetch).mockResolvedValueOnce(
      json({
        file: validFile({
          task_creations: [
            {
              proposal_id: "prop1",
              created_at: "2026-10-26T09:58:00Z",
              created_by_id: "u1",
              created_by_name: "Minh Nguyễn",
              tasks: null,
            },
          ],
        }),
      }),
    );
    const second = await getDriveFile("ws1", "df1");
    expect(second?.task_creations?.[0]?.tasks).toEqual([]);
  });

  it("getDriveFile returns null on a malformed 200 response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ file: { id: 42 } }));
    await expect(getDriveFile("ws1", "df1")).resolves.toBeNull();
  });

  it("getDriveFile throws ApiError with status 404 so the detail screen can distinguish not-found", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({ error: { code: "not_found", message: "not found" } }, 404),
    );
    await expect(getDriveFile("ws1", "df1")).rejects.toMatchObject({
      name: "ApiError",
      status: 404,
    } satisfies Partial<ApiError>);
  });

  it("unlinkDriveFile sends DELETE and returns true on ok status", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ status: "ok" }));
    const ok = await unlinkDriveFile("ws1", "df1");
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toBe("http://api.test/api/v1/workspaces/ws1/drive-files/df1");
    expect(init?.method).toBe("DELETE");
    expect(ok).toBe(true);
  });

  it("unlinkDriveFile treats a malformed 200 response as success instead of throwing", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ unexpected: true }));
    await expect(unlinkDriveFile("ws1", "df1")).resolves.toBe(true);
  });

  it("rebindDriveFile posts connection_id and returns the rebound file", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({
        file: validFile({
          connection_id: "conn2",
          bound_account_email: "admin@gmail.com",
          bound_by_id: "u2",
          bound_by_name: "Lan Trần",
        }),
      }),
    );
    const out = await rebindDriveFile("ws1", "df1", { connection_id: "conn2" });
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toBe("http://api.test/api/v1/workspaces/ws1/drive-files/df1/rebind");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ connection_id: "conn2" });
    expect(out?.bound_by_id).toBe("u2");
    expect(out?.bound_account_email).toBe("admin@gmail.com");
  });

  it("rebindDriveFile returns null on a malformed response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ file: null }));
    await expect(rebindDriveFile("ws1", "df1", { connection_id: "conn2" })).resolves.toBeNull();
  });
});
