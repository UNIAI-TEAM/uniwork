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
  it("does not expose server messages in transport errors", async () => {
    const transport = createHttpAuthTransport(profile, async () => response({ error: { code: "refresh_reused", message: "raw token abc" } }, 401));
    try { await transport.refresh!({ deploymentId: profile.deploymentId, deviceSessionId: "device-a", refreshToken: "refresh-a" }); } catch (error) { expect(error).toBeInstanceOf(AuthTransportError); expect(String(error)).not.toContain("raw token"); }
  });
});
