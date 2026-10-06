import { describe, expect, it, vi } from "vitest";
import { createHttpOfficeTransport } from "./office-transport";
import { desktopPublicConfigResponseSchema } from "../../shared/ipc";
import { blankDocxBytes } from "../files/blank-docx";

const profile = { deploymentId: "lane", apiOrigin: "http://127.0.0.1:8787", clientId: "uniwork-office-dev", channel: "dev" as const };
const credentials = {
  get: () => ({ accountId: "account-1", deviceSessionId: "device-1", sessionId: "session-1", accessToken: "secret", refreshToken: "refresh", expiresIn: 3600, refreshExpiresIn: 7200 }),
  save: () => undefined,
  clear: () => undefined,
};

describe("desktop office HTTP transport", () => {
  it("creates a valid blank DOCX through file creation and opens the committed bytes without an engine", async () => {
    const bytes = blankDocxBytes();
    expect(Buffer.from(bytes).subarray(0, 4).toString("hex")).toBe("504b0304");
    expect(Buffer.from(bytes).toString()).toContain("word/document.xml");
    expect(Buffer.from(bytes).toString()).toContain("<w:p/>");
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/documents/files")) {
        expect(init?.method).toBe("POST");
        const form = init?.body as FormData;
        expect(new Uint8Array(await (form.get("file") as Blob).arrayBuffer())).toEqual(bytes);
        expect(new Headers(init?.headers).get("Idempotency-Key")).toMatch(/^desktop-create-/);
        return new Response(JSON.stringify({ document: { id: "new-doc", kind: "file", title: "Blank.docx", current_version: 1, revision: "1", my_level: "manage" } }));
      }
      if (url.includes("/download")) return new Response(bytes as BodyInit, { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document" } });
      throw new Error("Unexpected engine call");
    });
    const transport = createHttpOfficeTransport({ profile, credentials, fetchImpl });
    const result = await transport.create({ workspaceId: "ws", title: "Blank.docx", format: "docx" });
    expect(result.document).toMatchObject({ id: "new-doc", version: 1, canEdit: true });
    expect(Buffer.from(result.dataBase64, "base64")).toEqual(Buffer.from(bytes));
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
  it("refreshes once across concurrent expired requests and replays with the rotated token", async () => {
    let session = credentials.get();
    let finishRefresh!: () => void;
    const refreshSession = vi.fn(async () => {
      await new Promise<void>((resolve) => { finishRefresh = resolve; });
      session = { ...session, accessToken: "renewed" };
    });
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => new Headers(init?.headers).get("Authorization") === "Bearer renewed"
      ? new Response(JSON.stringify({ documents: [] })) : new Response(null, { status: 401 }));
    const transport = createHttpOfficeTransport({ profile, credentials: { ...credentials, get: () => session }, fetchImpl, refreshSession });
    const results = Promise.all([transport.list({ workspaceId: "ws", mode: "list" }), transport.list({ workspaceId: "ws", mode: "recent" })]);
    await vi.waitFor(() => expect(refreshSession).toHaveBeenCalledTimes(1));
    finishRefresh();
    await expect(results).resolves.toHaveLength(2);
    expect(refreshSession).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it("reports login_required when refresh fails without replaying", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 401 }));
    const refreshSession = vi.fn(async () => { throw new Error("revoked"); });
    const transport = createHttpOfficeTransport({ profile, credentials, fetchImpl, refreshSession });
    await expect(transport.list({ workspaceId: "ws", mode: "list" })).rejects.toThrow("login_required");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(refreshSession).toHaveBeenCalledTimes(1);
  });

  it("stops after one replay if the replacement token also receives 401", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 401 }));
    const refreshSession = vi.fn(async () => undefined);
    const transport = createHttpOfficeTransport({ profile, credentials, fetchImpl, refreshSession });
    await expect(transport.list({ workspaceId: "ws", mode: "list" })).rejects.toThrow("login_required");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(refreshSession).toHaveBeenCalledTimes(1);
  });

  it("answers a 404 with its own code, keeps 403 as forbidden, and leaves every other status transient", async () => {
    for (const [status, code] of [[404, "office_document_gone"], [403, "forbidden"], [500, "office_request_failed"], [429, "office_request_failed"]] as const) {
      const fetchImpl = vi.fn(async () => new Response(null, { status }));
      const transport = createHttpOfficeTransport({ profile, credentials, fetchImpl });
      await expect(transport.open({ workspaceId: "ws", documentId: "doc-1" })).rejects.toThrow(code);
    }
  });

  it("does not replay a request into a different account after refresh", async () => {
    let session = credentials.get();
    const fetchImpl = vi.fn(async () => new Response(null, { status: 401 }));
    const transport = createHttpOfficeTransport({ profile, credentials: { ...credentials, get: () => session }, fetchImpl,
      refreshSession: async () => { session = { ...session, accountId: "other-account" }; } });
    await expect(transport.list({ workspaceId: "ws", mode: "list" })).rejects.toThrow("login_required");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("uses only profile-bound routes and keeps bearer credentials in main", async () => {
    const fetchImpl = vi.fn(async (input: string, init?: RequestInit) => {
      expect(input).toMatch(/^http:\/\/127\.0\.0\.1:8787\/api\/v1\//);
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer secret");
      if (input.endsWith("/orgs")) return new Response(JSON.stringify({ organizations: [{ id: "org-1", name: "Org" }] }), { status: 200 });
      if (input.endsWith("/me")) return new Response(JSON.stringify({ user: { display_name: "Test User", email: "test@example.com" } }));
      if (input.endsWith("/orgs/org-1/workspaces")) return new Response(JSON.stringify({ workspaces: [{ id: "ws-1", name: "Workspace" }] }), { status: 200 });
      if (input.includes("/workspaces/ws-1/documents")) return new Response(JSON.stringify({ documents: [], next_cursor: null }), { status: 200 });
      return new Response(JSON.stringify({}), { status: 404 });
    });
    const transport = createHttpOfficeTransport({ profile, credentials, fetchImpl });
    await expect(transport.context()).resolves.toMatchObject({ organizations: [{ id: "org-1" }], workspaces: [{ id: "ws-1" }] });
    await expect(transport.list({ workspaceId: "ws-1", mode: "list" })).resolves.toMatchObject({ documents: [], nextCursor: null, engineAvailable: false });
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it("rejects an origin outside the deployment profile policy", () => {
    expect(() => createHttpOfficeTransport({ profile: { ...profile, apiOrigin: "https://api.example.test/path" }, credentials })).toThrow(/origin/);
  });

  // DocumentSummaryDTO (server/internal/handler/dto/sdo/document.go) is the
  // real shape of a list/recent/search row: it never carries `file`, only the
  // single-document GET (DocumentDTO) does. A row shaped like this must still
  // map to a DOCX library entry, or the library renders empty forever.
  it("maps a list row with no file metadata using the title's extension", async () => {
    const summaryRow = {
      id: "doc-1",
      organization_id: "org-1",
      workspace_id: "ws-1",
      kind: "file",
      title: "docx-simple.docx",
      visibility: "workspace",
      revision: "1",
      current_version: 1,
      position: 0,
      my_level: "edit",
      created_by: "user-1",
      created_by_kind: "human",
      updated_by: "user-1",
      updated_by_kind: "human",
      created_at: "2026-09-30T00:00:00Z",
      updated_at: "2026-09-30T00:00:00Z",
    };
    const fetchImpl = vi.fn(async (input: string) => {
      if (input.includes("/workspaces/ws-1/documents")) return new Response(JSON.stringify({ documents: [summaryRow], next_cursor: null }), { status: 200 });
      return new Response(JSON.stringify({}), { status: 404 });
    });
    const transport = createHttpOfficeTransport({ profile, credentials, fetchImpl });
    await expect(transport.list({ workspaceId: "ws-1", mode: "list" })).resolves.toMatchObject({
      documents: [{ id: "doc-1", workspaceId: "ws-1", title: "docx-simple.docx", kind: "file", format: "docx", canEdit: true }],
      engineAvailable: false,
    });
  });

  it("drops a list row whose title has no recognised office extension", async () => {
    const pageRow = { id: "page-1", kind: "page", title: "Notes", revision: "1", current_version: 0, position: 0, created_by: "user-1", created_by_kind: "human", updated_by: "user-1", updated_by_kind: "human", created_at: "2026-09-30T00:00:00Z", updated_at: "2026-09-30T00:00:00Z" };
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ documents: [pageRow], next_cursor: null }), { status: 200 }));
    const transport = createHttpOfficeTransport({ profile, credentials, fetchImpl });
    await expect(transport.list({ workspaceId: "ws-1", mode: "list" })).resolves.toMatchObject({ documents: [] });
  });
  it("maps an xlsx list row and download by its spreadsheet MIME/extension", async () => {
    const summaryRow = { id: "doc-x", organization_id: "org-1", workspace_id: "ws-1", kind: "file", title: "budget.xlsx", visibility: "workspace", revision: "2", current_version: 1, position: 0, my_level: "edit", created_by: "user-1", created_by_kind: "human", updated_by: "user-1", updated_by_kind: "human", created_at: "2026-09-30T00:00:00Z", updated_at: "2026-09-30T00:00:00Z" };
    const fetchImpl = vi.fn(async (input: string) => {
      if (input.includes("/workspaces/ws-1/documents")) return new Response(JSON.stringify({ documents: [summaryRow], next_cursor: null }), { status: 200 });
      if (input.includes("/documents/doc-x/download")) {
        return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": "attachment; filename=\"budget.xlsx\"" } });
      }
      return new Response(JSON.stringify({}), { status: 404 });
    });
    const transport = createHttpOfficeTransport({ profile, credentials, fetchImpl });
    await expect(transport.list({ workspaceId: "ws-1", mode: "list" })).resolves.toMatchObject({ documents: [{ id: "doc-x", format: "xlsx", canEdit: true }] });
    await expect(transport.download({ workspaceId: "ws-1", documentId: "doc-x" })).resolves.toMatchObject({ mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", filename: "budget.xlsx" });
  });

  it("runs an xlsx edit job through start, poll and output and reports the staged bytes", async () => {
    const output = new TextEncoder().encode("PK\x03\x04staged");
    let polls = 0;
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/documents/doc-x/office/jobs") && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as { operation: string; format: string; base_revision: string; edits: unknown[] };
        expect(body).toMatchObject({ operation: "edit", format: "xlsx", base_revision: "2" });
        expect(body.edits).toEqual([{ op: "set_cell", target: { sheet: "Data", cell: "A1" }, attributes: { value: 7 } }]);
        expect(new Headers(init.headers).get("Idempotency-Key")).toMatch(/^desktop-job-/);
        return new Response(JSON.stringify({ job_id: "job-1", state: "accepted" }), { status: 202 });
      }
      if (url.endsWith("/office/jobs/job-1")) { polls += 1; return new Response(JSON.stringify({ job_id: "job-1", state: polls > 1 ? "completed" : "running" }), { status: 200 }); }
      if (url.endsWith("/office/jobs/job-1/output")) return new Response(output, { status: 200, headers: { "Content-Type": "application/octet-stream" } });
      throw new Error("unexpected " + url);
    });
    const transport = createHttpOfficeTransport({ profile, credentials, fetchImpl });
    const result = await transport.officeJob({ workspaceId: "ws-1", documentId: "doc-x", format: "xlsx", operation: "edit", baseRevision: "2", edits: [{ op: "set_cell", target: { sheet: "Data", cell: "A1" }, attributes: { value: 7 } }] });
    expect(result.state).toBe("completed");
    expect(Buffer.from(result.outputBase64 ?? "", "base64")).toEqual(Buffer.from(output));
    expect(result.outputChecksum).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(polls).toBe(2);
  }, 20_000);

  it.each([
    ["xlsx_rule_sets_dropped:[[\"cf\",[1]]]", "xlsx_rule_sets_dropped:[[\"cf\",[1]]]"],
    ["cannot open Budget Q3 confidential.xlsx", undefined],
  ])("passes a failed job's reason to the renderer only for the rule-set refusal (%s)", async (reason, expected) => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/documents/doc-x/office/jobs") && init?.method === "POST") return new Response(JSON.stringify({ job_id: "job-1", state: "accepted" }), { status: 202 });
      if (url.endsWith("/office/jobs/job-1")) return new Response(JSON.stringify({ job_id: "job-1", state: "failed", error: { code: "unsupported_operation", reason } }), { status: 200 });
      throw new Error("unexpected " + url);
    });
    const transport = createHttpOfficeTransport({ profile, credentials, fetchImpl });
    const result = await transport.officeJob({ workspaceId: "ws-1", documentId: "doc-x", format: "xlsx", operation: "edit", baseRevision: "2", edits: [] });
    expect(result.state).toBe("failed");
    expect(result.errorReason).toBe(expected);
  }, 20_000);

  it("reads the public flags through the session and keeps only boolean ones", async () => {
    const fetchImpl = vi.fn(async (input: string, init?: RequestInit) => {
      expect(input).toBe("http://127.0.0.1:8787/api/v1/config");
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer secret");
      return new Response(JSON.stringify({ flags: { office_engine: true, office_docx: false, rum_sampling: "yes", Bad_Key: true }, rum_sample_rate: 0.1 }), { status: 200 });
    });
    const transport = createHttpOfficeTransport({ profile, credentials, fetchImpl });
    await expect(transport.publicConfig()).resolves.toEqual({ flags: { office_engine: true, office_docx: false } });
  });

  it("asks for the selected organization so its overrides evaluate", async () => {
    const fetchImpl = vi.fn(async (input: string) => {
      expect(input).toBe("http://127.0.0.1:8787/api/v1/config?organization_id=org%2F1");
      return new Response(JSON.stringify({ flags: { office_engine: true } }), { status: 200 });
    });
    const transport = createHttpOfficeTransport({ profile, credentials, fetchImpl });
    await expect(transport.publicConfig("org/1")).resolves.toEqual({ flags: { office_engine: true } });
  });

  it("truncates a flag catalogue past the cap instead of overflowing the response schema", async () => {
    const flags = Object.fromEntries(Array.from({ length: 200 }, (_, index) => [`flag_${index}`, true]));
    const transport = createHttpOfficeTransport({ profile, credentials, fetchImpl: vi.fn(async () => new Response(JSON.stringify({ flags }), { status: 200 })) });
    const answer = await transport.publicConfig();
    expect(Object.keys(answer.flags)).toHaveLength(128);
    expect(desktopPublicConfigResponseSchema.safeParse(answer).success).toBe(true);
  });

  it("answers no flags for a malformed config body", async () => {
    const transport = createHttpOfficeTransport({ profile, credentials, fetchImpl: vi.fn(async () => new Response(JSON.stringify({ flags: [1, 2] }), { status: 200 })) });
    await expect(transport.publicConfig()).resolves.toEqual({ flags: {} });
  });

  it("registers a document context without downloading bytes for a metadata-only open", async () => {
    const summaryRow = { id: "doc-x", organization_id: "org-1", workspace_id: "ws-1", kind: "file", title: "budget.xlsx", visibility: "workspace", revision: "2", current_version: 1, position: 0, my_level: "edit", created_by: "user-1", created_by_kind: "human", updated_by: "user-1", updated_by_kind: "human", created_at: "2026-09-30T00:00:00Z", updated_at: "2026-09-30T00:00:00Z" };
    const fetchImpl = vi.fn(async (input: string) => {
      if (input.endsWith("/documents/doc-x")) return new Response(JSON.stringify({ document: summaryRow }), { status: 200 });
      throw new Error("unexpected " + input);
    });
    const transport = createHttpOfficeTransport({ profile, credentials, fetchImpl });
    await expect(transport.openContext({ workspaceId: "ws-1", documentId: "doc-x" })).resolves.toMatchObject({ document: { id: "doc-x", format: "xlsx" } });
    // No /download call: the metadata-only open never hauls the raw bytes.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls.some(([url]) => String(url).includes("/download"))).toBe(false);
  });
});