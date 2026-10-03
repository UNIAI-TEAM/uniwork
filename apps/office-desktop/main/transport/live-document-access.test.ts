import { describe, expect, it, vi } from "vitest";
import { createHttpOfficeTransport } from "./office-transport";

const profile = { deploymentId: "lane", apiOrigin: "http://127.0.0.1:8787", clientId: "uniwork-office-dev", channel: "dev" as const };
const credentials = { get: () => ({ accountId: "account", deviceSessionId: "device", sessionId: "session", accessToken: "test-token", refreshToken: "test-refresh", expiresIn: 3600, refreshExpiresIn: 7200 }), save: () => undefined, clear: () => undefined };
const scope = { workspaceId: "ws", documentId: "doc" };
const detail = { id: "doc", workspace_id: "ws", kind: "file", title: "Cloud.docx", revision: "1", current_version: 1 };

describe("main fresh document detail access", () => {
  it("F-1 regression: uses detail ACL when the list summary omits my_level", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("/workspaces/ws/documents")) return new Response(JSON.stringify({ documents: [{ ...detail }] }));
      if (url.endsWith("/documents/doc")) return new Response(JSON.stringify({ document: { ...detail, my_level: "manage" } }));
      return new Response(null, { status: 404 });
    });
    const transport = createHttpOfficeTransport({ profile, credentials, fetchImpl });
    const listed = await transport.list({ workspaceId: "ws", mode: "list" });
    expect(listed.documents[0]?.canEdit).toBe(false);
    await expect(transport.readDocumentAccess(scope)).resolves.toBe("edit");
    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([
      "http://127.0.0.1:8787/api/v1/workspaces/ws/documents?limit=50&kind=file",
      "http://127.0.0.1:8787/api/v1/workspaces/ws/members",
      "http://127.0.0.1:8787/api/v1/documents/doc",
    ]);
  });

  it.each(["edit", "manage"])("uses live %s detail even when the list omits my_level, without downloading bytes", async (level) => {
    let liveLevel = level;
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer test-token");
      expect(init?.cache).toBe("no-store");
      if (url.includes("/workspaces/ws/documents")) return new Response(JSON.stringify({ documents: [detail] }));
      if (url.endsWith("/documents/doc")) return new Response(JSON.stringify({ document: { ...detail, my_level: liveLevel } }));
      return new Response(null, { status: 404 });
    });
    const transport = createHttpOfficeTransport({ profile, credentials, fetchImpl });
    expect((await transport.list({ workspaceId: "ws", mode: "list" })).documents[0]?.canEdit).toBe(false);
    const calls = fetchImpl.mock.calls.length;
    await expect(transport.readDocumentAccess(scope)).resolves.toBe("edit");
    expect(fetchImpl.mock.calls.slice(calls).map(([url]) => url)).toEqual(["http://127.0.0.1:8787/api/v1/documents/doc"]);
    liveLevel = "view";
    await expect(transport.readDocumentAccess(scope)).resolves.toBe("none");
    expect(fetchImpl.mock.calls.some(([url]) => url.includes("/download"))).toBe(false);
  });

  it.each([
    ["view", { ...detail, my_level: "view" }],
    ["missing ACL", detail],
    ["unknown ACL", { ...detail, my_level: "owner" }],
    ["malformed ACL", { ...detail, my_level: { edit: true } }],
    ["wrong document", { ...detail, id: "other", my_level: "edit" }],
    ["wrong workspace", { ...detail, workspace_id: "other", my_level: "edit" }],
    ["missing workspace", { id: "doc", my_level: "edit" }],
    ["null", null], ["array", []], ["string", "edit"],
  ])("fails closed for %s", async (_name, document) => {
    const transport = createHttpOfficeTransport({ profile, credentials, fetchImpl: async () => new Response(JSON.stringify({ document })) });
    await expect(transport.readDocumentAccess(scope)).resolves.toBe("none");
  });

  it.each([401, 403, 404, 500])("fails closed for HTTP %s", async (status) => {
    const transport = createHttpOfficeTransport({ profile, credentials, fetchImpl: async () => new Response(null, { status }) });
    await expect(transport.readDocumentAccess(scope)).resolves.toBe("none");
  });

  it("fails closed for absent credentials, invalid JSON and network failure", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ document: { ...detail, my_level: "edit" } })));
    const loggedOut = createHttpOfficeTransport({ profile, credentials: { ...credentials, get: () => undefined }, fetchImpl });
    await expect(loggedOut.readDocumentAccess(scope)).resolves.toBe("none");
    expect(fetchImpl).not.toHaveBeenCalled();
    const malformed = createHttpOfficeTransport({ profile, credentials, fetchImpl: async () => new Response("{invalid") });
    await expect(malformed.readDocumentAccess(scope)).resolves.toBe("none");
    const offline = createHttpOfficeTransport({ profile, credentials, fetchImpl: async () => { throw new Error("offline"); } });
    await expect(offline.readDocumentAccess(scope)).resolves.toBe("none");
  });
});
