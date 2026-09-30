import { describe, expect, it } from "vitest";
import { createHttpAuthTransport, AuthTransportError } from "./auth-transport";
import type { DeploymentProfile } from "../../shared/deployment";

const profile: DeploymentProfile = { deploymentId: "deployment-a", apiOrigin: "https://api.example.test", clientId: "uniwork-office", channel: "stable" };
function response(body: unknown, status = 200): Response { return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }); }

describe("real desktop auth HTTP transport", () => {
  it("sends only the allowlisted TLS routes and parses the server wire", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = async (url: string, init?: RequestInit) => { calls.push({ url, init }); if (url.includes("/start?")) return response({ authorization_url: "https://app.example.test/auth/desktop/authorize?attempt=opaque", attempt_expires_at: "2026-09-30T00:00:00Z" }); return response({ account_id: "account-a", device_session_id: "device-a", session_id: "session-a", deployment_id: "deployment-a", access_token: "access-a", refresh_token: "refresh-a", expires_in: 900, refresh_expires_in: 1000, refresh_rotates: true }); };
    const transport = createHttpAuthTransport(profile, fetchImpl);
    await expect(transport.start({ clientId: profile.clientId, deploymentId: profile.deploymentId, codeChallenge: "a".repeat(43), codeChallengeMethod: "S256", state: "state", redirectUri: "uniwork-office://auth/callback" })).resolves.toMatchObject({ authorizationUrl: expect.stringContaining("https://") });
    await expect(transport.exchange({ clientId: profile.clientId, deploymentId: profile.deploymentId, code: "code", codeVerifier: "v".repeat(43), redirectUri: "uniwork-office://auth/callback" })).resolves.toMatchObject({ accountId: "account-a" });
    expect(calls[0]?.url).toContain("/api/v1/auth/desktop/start?");
    expect(calls[0]?.init?.method).toBe("GET");
    expect(calls[1]?.url).toContain("/api/v1/auth/desktop/exchange");
    expect((calls[1]?.init?.headers as Record<string, string>)["Authorization"]).toBeUndefined();
  });
  it("maps typed revocation/reuse responses and rejects profile mismatch", async () => {
    const fetchImpl = async () => response({ error: { code: "device_revoked" } }, 401);
    const transport = createHttpAuthTransport(profile, fetchImpl);
    await expect(transport.refresh!({ deploymentId: profile.deploymentId, deviceSessionId: "device-a", refreshToken: "refresh-a" })).rejects.toMatchObject({ code: "device_revoked", status: 401 });
    await expect(transport.exchange({ clientId: "wrong-client", deploymentId: profile.deploymentId, code: "code", codeVerifier: "v", redirectUri: "uniwork-office://auth/callback" })).rejects.toMatchObject({ code: "invalid_request" });
    expect(() => createHttpAuthTransport({ ...profile, apiOrigin: "http://evil.example" })).toThrow();
  });
  it("uses bearer auth for refresh, device listing and revocation", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url.endsWith("/devices")) return response({ devices: [{ id: "device-a", client_id: profile.clientId, deployment_id: profile.deploymentId, device_label: "Office", platform: "win32", build: "dev", created_at: "2026-09-30T00:00:00Z", last_used_at: "2026-09-30T00:00:00Z", expires_at: "2026-10-30T00:00:00Z", revoked_at: null, current: true }] });
      if (init?.method === "DELETE") return response({});
      if (url.endsWith("/refresh")) return response({ account_id: "account-a", device_session_id: "device-a", session_id: "session-b", deployment_id: profile.deploymentId, access_token: "access-b", refresh_token: "refresh-b", expires_in: 900, refresh_expires_in: 1000 });
      return response({});
    };
    const transport = createHttpAuthTransport(profile, fetchImpl);
    await expect(transport.refresh!({ deploymentId: profile.deploymentId, deviceSessionId: "device-a", refreshToken: "refresh-a" })).resolves.toMatchObject({ sessionId: "session-b" });
    await expect(transport.logout!({ deploymentId: profile.deploymentId, deviceSessionId: "device-a", scope: "device" }, "access-b")).resolves.toBeUndefined();
    await expect(transport.devices!("access-b")).resolves.toHaveLength(1);
    await expect(transport.revokeDevice!("device-a", "access-b")).resolves.toBeUndefined();
    expect(calls.slice(1).every((call) => (call.init?.headers as Record<string, string>).Authorization === "Bearer access-b")).toBe(true);
  });
  it("maps a revoked snake_case device and rejects malformed device rows", async () => {
    const revokedTransport = createHttpAuthTransport(profile, async () => response({ devices: [{ id: "device-b", client_id: profile.clientId, deployment_id: profile.deploymentId, device_label: "Old laptop", platform: "darwin", build: "1.2.3", created_at: "2026-09-01T00:00:00Z", last_used_at: "2026-09-15T00:00:00Z", expires_at: "2026-10-01T00:00:00Z", revoked_at: "2026-09-20T00:00:00Z", current: false }] }));
    await expect(revokedTransport.devices!("access-b")).resolves.toMatchObject([{ id: "device-b", clientId: profile.clientId, deploymentId: profile.deploymentId, deviceLabel: "Old laptop", revokedAt: "2026-09-20T00:00:00Z", current: false }]);

    const malformedRows: readonly unknown[] = [
      null,
      { client_id: profile.clientId, deployment_id: profile.deploymentId, device_label: "Office", platform: "win32", build: "dev", created_at: "", last_used_at: "", expires_at: "", revoked_at: null, current: true },
      { id: "device-a", client_id: profile.clientId, deployment_id: profile.deploymentId, device_label: "Office", platform: "win32", build: "dev", created_at: "", last_used_at: "", expires_at: "", revoked_at: 42, current: true },
      { id: "device-a", client_id: profile.clientId, deployment_id: profile.deploymentId, device_label: "Office", platform: "win32", build: "dev", created_at: "", last_used_at: "", expires_at: "", revoked_at: null, current: "yes" },
    ];
    for (const row of malformedRows) {
      const malformed = createHttpAuthTransport(profile, async () => response({ devices: [row] }));
      await expect(malformed.devices!("access-b")).rejects.toMatchObject({ code: "malformed_response" });
    }
  });
  it("maps malformed and network responses without exposing payloads", async () => {
    const malformed = createHttpAuthTransport(profile, async () => response({ account_id: "missing" }));
    await expect(malformed.refresh!({ deploymentId: profile.deploymentId, deviceSessionId: "device-a", refreshToken: "refresh-a" })).rejects.toMatchObject({ code: "malformed_response" });
    const offline = createHttpAuthTransport(profile, async () => { throw new Error("socket token secret"); });
    await expect(offline.refresh!({ deploymentId: profile.deploymentId, deviceSessionId: "device-a", refreshToken: "refresh-a" })).rejects.toMatchObject({ code: "network" });
  });
  it("does not expose server messages in transport errors", async () => {
    const transport = createHttpAuthTransport(profile, async () => response({ error: { code: "refresh_reused", message: "raw token abc" } }, 401));
    try { await transport.refresh!({ deploymentId: profile.deploymentId, deviceSessionId: "device-a", refreshToken: "refresh-a" }); } catch (error) { expect(error).toBeInstanceOf(AuthTransportError); expect(String(error)).not.toContain("raw token"); }
  });
});
