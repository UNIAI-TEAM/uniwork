import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  decideConnectConsent,
  getConnectConsent,
  getMcpPolicy,
  listMyConnectedApps,
  listOrgConnectedApps,
  revokeMyConnectedApp,
  revokeOrgConnectedApp,
  setMcpPolicy,
} from "./connect";

const requestMock = vi.fn();
vi.mock("../http", () => ({ request: (...args: unknown[]) => requestMock(...args) }));

const grant = { id: "g1", organization_id: "o1", organization_name: "Acme", user_id: "u1", user_name: "Minh", client_id: "c1", client_name: "Claude", verified: true, scope: "read", created_at: "2026-10-12T08:00:00Z", last_used_at: null };

describe("connect endpoints", () => {
  beforeEach(() => requestMock.mockReset());

  it("parses a consent and fills optional fields", async () => {
    requestMock.mockResolvedValue({ attempt_id: "a1", status: "pending", client: { client_id: "c1", name: "Claude" }, organizations: [{ id: "o1", slug: "acme", name: "Acme", enabled: true }], csrf_token: "x" });
    const c = await getConnectConsent("a1");
    expect(c?.client?.verified).toBe(false);
    expect(c?.organizations[0]?.reason).toBe("");
    expect(requestMock).toHaveBeenCalledWith("/api/v1/auth/connect/attempts/a1");
  });

  it("returns null for a malformed consent", async () => {
    requestMock.mockResolvedValue({ attempt_id: 4 });
    await expect(getConnectConsent("a1")).resolves.toBeNull();
  });

  it("posts a decision and returns null on a malformed result", async () => {
    requestMock.mockResolvedValue({ status: "approved", redirect_to: "https://claude.ai/cb?code=x" });
    await expect(decideConnectConsent("a1", { decision: "approve", csrf_token: "x", organization_id: "o1" })).resolves.toMatchObject({ status: "approved" });
    expect(requestMock).toHaveBeenCalledWith("/api/v1/auth/connect/attempts/a1", expect.objectContaining({ method: "POST" }));
    requestMock.mockResolvedValue({ status: "approved" });
    await expect(decideConnectConsent("a1", { decision: "approve", csrf_token: "x" })).resolves.toBeNull();
  });

  it("lists my connected apps and degrades to an empty list", async () => {
    requestMock.mockResolvedValue({ grants: [grant], mcp_url: "https://api.example.test/mcp" });
    await expect(listMyConnectedApps()).resolves.toMatchObject({ grants: [{ id: "g1" }], mcp_url: "https://api.example.test/mcp" });
    requestMock.mockResolvedValue({ grants: "nope" });
    await expect(listMyConnectedApps()).resolves.toEqual({ grants: [], mcp_url: "" });
  });

  it("lists org apps and degrades to an empty list", async () => {
    requestMock.mockResolvedValue({ grants: [grant] });
    await expect(listOrgConnectedApps("acme")).resolves.toHaveLength(1);
    expect(requestMock).toHaveBeenCalledWith("/api/v1/orgs/acme/connected-apps");
    requestMock.mockResolvedValue(null);
    await expect(listOrgConnectedApps("acme")).resolves.toEqual([]);
  });

  it("revokes by encoded id", async () => {
    requestMock.mockResolvedValue({ status: "ok" });
    await revokeMyConnectedApp("g/1");
    expect(requestMock).toHaveBeenCalledWith("/api/v1/me/connected-apps/g%2F1", { method: "DELETE" });
    await revokeOrgConnectedApp("acme", "g1");
    expect(requestMock).toHaveBeenCalledWith("/api/v1/orgs/acme/connected-apps/g1", { method: "DELETE" });
  });

  it("reads and sets the policy, null when malformed", async () => {
    requestMock.mockResolvedValue({ enabled: true, available: true, enabled_at: null, mcp_url: "https://api.example.test/mcp" });
    await expect(getMcpPolicy("acme")).resolves.toMatchObject({ enabled: true, enabled_by: "" });
    await setMcpPolicy("acme", false);
    expect(requestMock).toHaveBeenLastCalledWith("/api/v1/orgs/acme/mcp-policy", { method: "PUT", body: { enabled: false } });
    requestMock.mockResolvedValue({ enabled: "yes" });
    await expect(getMcpPolicy("acme")).resolves.toBeNull();
  });

  it("returns null when the policy answer to a PUT is malformed", async () => {
    requestMock.mockResolvedValue({ enabled: "yes" });
    await expect(setMcpPolicy("acme", true)).resolves.toBeNull();
    expect(requestMock).toHaveBeenLastCalledWith("/api/v1/orgs/acme/mcp-policy", { method: "PUT", body: { enabled: true } });
    requestMock.mockResolvedValue(undefined);
    await expect(setMcpPolicy("acme", true)).resolves.toBeNull();
  });
});
