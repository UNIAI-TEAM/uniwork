import { describe, expect, it, vi } from "vitest";
import { createHttpOfficeTransport } from "./office-transport";

const profile = { deploymentId: "lane", apiOrigin: "http://127.0.0.1:8787", clientId: "uniwork-office-dev", channel: "dev" as const };
const credentials = {
  get: () => ({ accountId: "account-1", deviceSessionId: "device-1", sessionId: "session-1", accessToken: "secret", refreshToken: "refresh", expiresIn: 3600, refreshExpiresIn: 7200 }),
  save: () => undefined,
  clear: () => undefined,
};

describe("desktop office HTTP transport", () => {
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
      if (input.endsWith("/orgs/org-1/workspaces")) return new Response(JSON.stringify({ workspaces: [{ id: "ws-1", name: "Workspace" }] }), { status: 200 });
      if (input.includes("/workspaces/ws-1/documents")) return new Response(JSON.stringify({ documents: [], next_cursor: null }), { status: 200 });
      return new Response(JSON.stringify({}), { status: 404 });
    });
    const transport = createHttpOfficeTransport({ profile, credentials, fetchImpl });
    await expect(transport.context()).resolves.toMatchObject({ organizations: [{ id: "org-1" }], workspaces: [{ id: "ws-1" }] });
    await expect(transport.list({ workspaceId: "ws-1", mode: "list" })).resolves.toMatchObject({ documents: [], nextCursor: null, engineAvailable: true });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
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
      engineAvailable: true,
    });
  });

  it("drops a list row whose title has no recognised office extension", async () => {
    const pageRow = { id: "page-1", kind: "page", title: "Notes", revision: "1", current_version: 0, position: 0, created_by: "user-1", created_by_kind: "human", updated_by: "user-1", updated_by_kind: "human", created_at: "2026-09-30T00:00:00Z", updated_at: "2026-09-30T00:00:00Z" };
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ documents: [pageRow], next_cursor: null }), { status: 200 }));
    const transport = createHttpOfficeTransport({ profile, credentials, fetchImpl });
    await expect(transport.list({ workspaceId: "ws-1", mode: "list" })).resolves.toMatchObject({ documents: [] });
  });
});
