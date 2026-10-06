import { createHash, randomBytes } from "node:crypto";
import { describe, expect, test } from "vitest";
import { NativeLoginManager } from "../main/auth/manager";
import { createInMemoryCredentialStore, type CredentialSession } from "../main/auth/credentials";
import { createHttpAuthTransport, type AuthTransport, type DesktopSessionResponse } from "../main/transport/auth-transport";

/**
 * AC-2 lane test.  It is deliberately opt-in so the normal desktop unit lane
 * never talks to a developer's server or database.  The AC-2 command sets
 * OFFICE_DESKTOP_REAL_SERVER_URL and OFFICE_DESKTOP_REQUIRE_REAL_SERVER=1;
 * with the latter, a missing URL is an error instead of a silent skip.
 */
const origin = process.env.OFFICE_DESKTOP_REAL_SERVER_URL?.trim().replace(/\/$/, "");
const requireServer = process.env.OFFICE_DESKTOP_REQUIRE_REAL_SERVER === "1";
const profile = origin ? {
  apiOrigin: origin,
  channel: "dev" as const,
  clientId: process.env.OFFICE_DESKTOP_CLIENT_ID?.trim() || "uniwork-office-dev",
  deploymentId: process.env.OFFICE_DESKTOP_DEPLOYMENT_ID?.trim() || "default",
} : undefined;

describe("desktop auth against the real Go server", () => {
  if (!origin || !profile) {
    test("is opt-in (set OFFICE_DESKTOP_REAL_SERVER_URL for AC-2)", () => {
      if (requireServer) throw new Error("OFFICE_DESKTOP_REQUIRE_REAL_SERVER=1 requires OFFICE_DESKTOP_REAL_SERVER_URL");
      expect(true).toBe(true);
    });
    return;
  }

  test("exchanges, single-flights refresh, detects replay/revocation, and logs out server-side", async () => {
    const transport = createHttpAuthTransport(profile);
    const account = await registerAccount(origin);

    // The initial PKCE exchange follows the same consent calls that the
    // browser's hosted page performs.  The verifier never crosses the API.
    const first = await authorizeAndExchange(transport, origin, account.accessToken);
    const credentials = createInMemoryCredentialStore();
    await credentials.save(toCredentialSession(first));
    let refreshRequests = 0;
    const countingTransport: AuthTransport = Object.freeze({
      ...transport,
      refresh: async (request) => {
        refreshRequests += 1;
        return transport.refresh!(request);
      },
    });
    const manager = createManager(countingTransport, credentials);
    expect((await manager.restore()).status).toBe("signed-in");
    const [refreshOne, refreshTwo, refreshThree] = await Promise.all([
      manager.refreshSession(), manager.refreshSession(), manager.refreshSession(),
    ]);
    expect(refreshRequests).toBe(1);
    expect(refreshOne.status).toBe("signed-in");
    expect(refreshTwo.status).toBe("signed-in");
    expect(refreshThree.status).toBe("signed-in");

    // A stale pair is a real replay.  The server revokes the complete family;
    // manager.refreshSession maps refresh_reused to the login-required state.
    const replay = await authorizeAndExchange(transport, origin, account.accessToken);
    const replayRotated = await transport.refresh!({ deviceSessionId: replay.deviceSessionId, refreshToken: replay.refreshToken, deploymentId: profile.deploymentId });
    const staleCredentials = createInMemoryCredentialStore();
    await staleCredentials.save(toCredentialSession(replay));
    const staleManager = createManager(transport, staleCredentials);
    expect((await staleManager.restore()).status).toBe("signed-in");
    expect((await staleManager.refreshSession()).status).toBe("login-required");
    await expect(transport.refresh!({ deviceSessionId: replayRotated.deviceSessionId, refreshToken: replayRotated.refreshToken, deploymentId: profile.deploymentId })).rejects.toMatchObject({ code: "device_revoked" });

    // A server-side device revoke is independently surfaced as login-required.
    const revoked = await authorizeAndExchange(transport, origin, account.accessToken);
    await transport.revokeDevice!(revoked.deviceSessionId, revoked.accessToken);
    const revokedCredentials = createInMemoryCredentialStore();
    await revokedCredentials.save(toCredentialSession(revoked));
    const revokedManager = createManager(transport, revokedCredentials);
    expect((await revokedManager.restore()).status).toBe("signed-in");
    expect((await revokedManager.refreshSession()).status).toBe("login-required");

    // Logout must revoke on the server before the local pair is cleared.
    const loggedOut = await authorizeAndExchange(transport, origin, account.accessToken);
    const logoutCredentials = createInMemoryCredentialStore();
    await logoutCredentials.save(toCredentialSession(loggedOut));
    const logoutManager = createManager(transport, logoutCredentials);
    expect((await logoutManager.restore()).status).toBe("signed-in");
    expect((await logoutManager.logout()).status).toBe("signed-out");
    expect(await logoutCredentials.get()).toBeUndefined();
    await expect(transport.refresh!({ deviceSessionId: loggedOut.deviceSessionId, refreshToken: loggedOut.refreshToken, deploymentId: profile.deploymentId })).rejects.toMatchObject({ code: "device_revoked" });
    const devices = await transport.devices!(account.accessToken);
    const loggedOutDevice = devices.find((device) => device.id === loggedOut.deviceSessionId);
    expect(loggedOutDevice?.revokedAt).toEqual(expect.any(String));
  }, 30_000);
});

function createManager(transport: AuthTransport, credentials: ReturnType<typeof createInMemoryCredentialStore>): NativeLoginManager {
  return new NativeLoginManager({
    clientId: profile!.clientId,
    deploymentId: profile!.deploymentId,
    browser: { open: () => undefined },
    transport,
    credentials,
  });
}

async function registerAccount(serverOrigin: string): Promise<{ accessToken: string }> {
  const email = `desktop-ac2-${Date.now()}-${randomBytes(4).toString("hex")}@example.test`;
  const response = await fetch(`${serverOrigin}/api/v1/auth/register`, {
    method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ email, password: "password123", display_name: "Desktop AC2" }),
  });
  const body = await json(response);
  if (!response.ok || typeof body.access_token !== "string") throw new Error(`register failed (${response.status})`);
  return { accessToken: body.access_token };
}

async function authorizeAndExchange(transport: AuthTransport, serverOrigin: string, accountAccessToken: string): Promise<DesktopSessionResponse> {
  const verifier = base64Url(randomBytes(48));
  const challenge = base64Url(createHash("sha256").update(verifier).digest());
  const state = base64Url(randomBytes(24));
  const redirectUri = "uniwork-office://auth/callback";
  const started = await transport.start({ clientId: profile!.clientId, codeChallenge: challenge, codeChallengeMethod: "S256", state, redirectUri, deploymentId: profile!.deploymentId, deviceLabel: "AC-2 integration", platform: "windows", build: "integration" });
  const attemptUrl = new URL(started.authorizationUrl);
  const attemptId = attemptUrl.searchParams.get("attempt_id");
  if (!attemptId) throw new Error("desktop start returned no attempt id");
  const authHeaders = { Accept: "application/json", Authorization: `Bearer ${accountAccessToken}` };
  const consentResponse = await fetch(`${serverOrigin}/api/v1/auth/desktop/authorize?attempt_id=${encodeURIComponent(attemptId)}`, { headers: authHeaders });
  const consent = await json(consentResponse);
  if (!consentResponse.ok || typeof consent.csrf_token !== "string") throw new Error(`consent failed (${consentResponse.status})`);
  const approvedResponse = await fetch(`${serverOrigin}/api/v1/auth/desktop/authorize`, { method: "POST", headers: { ...authHeaders, "Content-Type": "application/json" }, body: JSON.stringify({ attempt_id: attemptId, csrf_token: consent.csrf_token, decision: "approve" }) });
  const approved = await json(approvedResponse);
  if (!approvedResponse.ok || typeof approved.callback_url !== "string") throw new Error(`consent approval failed (${approvedResponse.status})`);
  const callback = new URL(approved.callback_url);
  if (callback.searchParams.get("state") !== state || !callback.searchParams.get("code")) throw new Error("consent callback state/code mismatch");
  return transport.exchange({ clientId: profile!.clientId, code: callback.searchParams.get("code")!, codeVerifier: verifier, redirectUri, deploymentId: profile!.deploymentId, deviceLabel: "AC-2 integration", platform: "windows", build: "integration" });
}

async function json(response: Response): Promise<Record<string, any>> {
  try { return await response.json() as Record<string, any>; } catch { return {}; }
}

function base64Url(value: Uint8Array): string {
  return Buffer.from(value).toString("base64").replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function toCredentialSession(session: DesktopSessionResponse): CredentialSession {
  return { accountId: session.accountId, deviceSessionId: session.deviceSessionId, sessionId: session.sessionId, accessToken: session.accessToken, refreshToken: session.refreshToken, expiresIn: session.expiresIn, refreshExpiresIn: session.refreshExpiresIn };
}
