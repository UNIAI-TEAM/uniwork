import { describe, expect, it, vi } from "vitest";
import { createHttpOfficeTransport } from "./office-transport";

const profile = { deploymentId: "lane", apiOrigin: "http://127.0.0.1:8787", clientId: "uniwork-office-dev", channel: "dev" as const };
const credentials = {
  get: () => ({ accountId: "account-1", deviceSessionId: "device-1", sessionId: "session-1", accessToken: "secret", refreshToken: "refresh", expiresIn: 3600, refreshExpiresIn: 7200 }),
  save: () => undefined,
  clear: () => undefined,
};

describe("desktop office HTTP transport", () => {
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
});
