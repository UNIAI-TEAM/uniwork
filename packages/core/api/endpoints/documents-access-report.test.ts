import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../../runtime-config";
import { ApiError } from "../http";
import { setAccessToken } from "../session";
import { exportDocumentAccessReport, getDocumentAccessReport } from "./documents-access-report";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

// The wire example of the UNI-1643 contract (§3.1), one folder-scoped page.
const report = (over: Record<string, unknown> = {}) => ({
  scope: { kind: "folder", workspace_id: "ws1", folder_id: "f1", folder_title: "Hợp đồng" },
  filter: { person_id: null, level: [], visibility: null },
  generated_at: "2026-10-15T03:40:00Z",
  documents: [
    {
      document: {
        id: "d1",
        title: "Hợp đồng ABC",
        kind: "file",
        visibility: "restricted",
        path: [{ id: "f1", title: "Hợp đồng" }],
        acl_owner: { id: "u1", name: "Nguyễn An" },
        live_link_count: 1,
        updated_at: "2026-10-14T09:00:00Z",
      },
      rows: [
        {
          source: "acl_owner",
          via: "member",
          principal_type: "user",
          principal_id: "u1",
          principal_name: "Nguyễn An",
          level: "manage",
          effective_level: "manage",
          active: true,
          granted_by: null,
          granted_by_name: null,
          granted_by_kind: null,
          granted_at: null,
          share_id: null,
        },
        {
          source: "share",
          via: "share",
          principal_type: "workspace",
          principal_id: "ws9",
          principal_name: "Pháp chế",
          level: "view",
          effective_level: "view",
          active: true,
          granted_by: "u1",
          granted_by_name: "Nguyễn An",
          granted_by_kind: "human",
          granted_at: "2026-10-10T03:00:00Z",
          share_id: "s1",
        },
      ],
    },
  ],
  summary: { candidates: 50, documents: 48, rows: 131, skipped: 2 },
  next_cursor: "cur1",
  ...over,
});

const malformedBodies = [{ nope: true }, { documents: "x" }, { documents: [{ rows: "x" }] }, null, [], "str"];

describe("documents-access-report endpoints (UNI-1643)", () => {
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

  it("parses the page and sends no filter by default", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(report()));
    const out = await getDocumentAccessReport("ws1");
    const url = new URL(String(vi.mocked(fetch).mock.calls[0]![0]));
    expect(url.pathname).toBe("/api/v1/workspaces/ws1/documents/access-report");
    expect(url.search).toBe("");
    expect(out?.scope.folder_title).toBe("Hợp đồng");
    expect(out?.documents[0]?.document.acl_owner?.name).toBe("Nguyễn An");
    expect(out?.documents[0]?.document.live_link_count).toBe(1);
    expect(out?.documents[0]?.rows[1]?.effective_level).toBe("view");
    expect(out?.summary.skipped).toBe(2);
    expect(out?.next_cursor).toBe("cur1");
  });

  it("sends folder_id, person_id, level, visibility, cursor and limit", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(report()));
    await getDocumentAccessReport("ws1", {
      folderId: "f1",
      personId: "u2",
      levels: ["view", "edit"],
      visibility: "restricted",
      cursor: "cur0",
      limit: 25,
    });
    const url = new URL(String(vi.mocked(fetch).mock.calls[0]![0]));
    expect(url.searchParams.get("folder_id")).toBe("f1");
    expect(url.searchParams.get("person_id")).toBe("u2");
    expect(url.searchParams.get("level")).toBe("view,edit");
    expect(url.searchParams.get("visibility")).toBe("restricted");
    expect(url.searchParams.get("cursor")).toBe("cur0");
    expect(url.searchParams.get("limit")).toBe("25");
  });

  it("omits empty filter params", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(report()));
    await getDocumentAccessReport("ws1", { levels: [], visibility: "", personId: "" });
    expect(new URL(String(vi.mocked(fetch).mock.calls[0]![0])).search).toBe("");
  });

  it("keeps unknown levels, sources and a person_level as plain strings", async () => {
    const body = report();
    const doc = body.documents[0]!;
    doc.document = { ...doc.document, person_level: "comment" } as never;
    doc.rows[0] = { ...doc.rows[0]!, source: "break_glass", via: "break_glass", level: "comment" } as never;
    doc.rows[1] = { ...doc.rows[1]!, source: "from_the_future", level: "owner++" } as never;
    vi.mocked(fetch).mockResolvedValueOnce(json(body));
    const out = await getDocumentAccessReport("ws1");
    expect(out?.documents[0]?.document.person_level).toBe("comment");
    expect(out?.documents[0]?.rows[0]?.source).toBe("break_glass");
    expect(out?.documents[0]?.rows[1]?.level).toBe("owner++");
  });

  it("accepts a page without a folder, rows or a cursor", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({
        scope: { kind: "workspace", workspace_id: "ws1", folder_id: null, folder_title: null },
        filter: { person_id: null, level: [], visibility: null },
        generated_at: "2026-10-15T03:40:00Z",
        documents: [],
        summary: { candidates: 5, documents: 0, rows: 0, skipped: 3 },
        next_cursor: null,
      }),
    );
    const out = await getDocumentAccessReport("ws1");
    expect(out?.documents).toEqual([]);
    expect(out?.summary.skipped).toBe(3);
    expect(out?.next_cursor).toBeNull();
  });

  it.each(malformedBodies)("degrades to null on a malformed body %j", async (body) => {
    vi.mocked(fetch).mockResolvedValueOnce(json(body));
    await expect(getDocumentAccessReport("ws1")).resolves.toBeNull();
  });

  it("exports through the transport with the active filter and the server filename", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response("a,b\n", {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": 'attachment; filename="access-report-doi-20261015T0340Z.csv"',
        },
      }),
    );
    const out = await exportDocumentAccessReport("ws1", { folderId: "f1", personId: "u2", levels: ["edit"] }, "csv");
    const url = new URL(String(vi.mocked(fetch).mock.calls[0]![0]));
    expect(url.pathname).toBe("/api/v1/workspaces/ws1/documents/access-report/export");
    expect(url.searchParams.get("format")).toBe("csv");
    expect(url.searchParams.get("folder_id")).toBe("f1");
    expect(url.searchParams.get("person_id")).toBe("u2");
    expect(url.searchParams.get("level")).toBe("edit");
    expect(url.searchParams.has("cursor")).toBe(false);
    expect(out.filename).toBe("access-report-doi-20261015T0340Z.csv");
    expect(out.blob.size).toBeGreaterThan(0);
  });

  it("reports no filename when the browser cannot read Content-Disposition", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response("x", { status: 200 }));
    const out = await exportDocumentAccessReport("ws1", {}, "xlsx");
    expect(new URL(String(vi.mocked(fetch).mock.calls[0]![0])).searchParams.get("format")).toBe("xlsx");
    expect(out.filename).toBeNull();
  });

  it("surfaces the too-large refusal as an ApiError with its code", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({ error: { code: "access_report_too_large", message: "x", fields: { max_rows: 10000 } } }, 422),
    );
    const err = await exportDocumentAccessReport("ws1", {}, "csv").then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe("access_report_too_large");
    expect((err as ApiError).status).toBe(422);
  });
});
