import { describe, expect, it } from "vitest";
import { LoginAttemptStore } from "./attempt-store";
import { validateCallback } from "./callback";

const config = { clientId: "com.uniwork.office", deploymentId: "production-eu", redirectUri: "uniwork-office://auth/callback" };

function attemptAt(now = 1_000) {
  return new LoginAttemptStore({ randomBytes: (size) => new Uint8Array(size).fill(8) }).begin({ ...config, now });
}

describe("custom-scheme callback validator", () => {
  it("accepts the exact redirect once the state and query are valid", () => {
    const attempt = attemptAt();
    const result = validateCallback(`${config.redirectUri}?code=opaque-code&state=${encodeURIComponent(attempt.state)}`, attempt, { now: 1_001, expectedClientId: config.clientId, expectedDeploymentId: config.deploymentId });
    expect(result).toMatchObject({ ok: true, code: "opaque-code", attemptId: attempt.attemptId });
  });
  it.each([
    ["wrong redirect", `${config.redirectUri}/?code=x&state=bad`, "wrong_redirect"],
    ["wrong state", `${config.redirectUri}?code=x&state=bad`, "wrong_state"],
    ["duplicate query", `${config.redirectUri}?code=x&code=y&state=bad`, "duplicate_query"],
    ["unexpected query", `${config.redirectUri}?code=x&state=bad&foo=x`, "unexpected_query"],
    ["missing code", `${config.redirectUri}?state=bad`, "missing_code"],
    ["missing state", `${config.redirectUri}?code=x`, "missing_state"],
    ["fragment", `${config.redirectUri}?code=x&state=bad#fragment`, "wrong_redirect"],
  ])("rejects %s with a typed reason", (_label, url, reason) => {
    const attempt = attemptAt();
    expect(validateCallback(url, attempt, { now: 1_001 })).toEqual({ ok: false, reason });
  });
  it("rejects no attempt, expired, restart and binding mismatches without secret-shaped logs", () => {
    const events: Array<Record<string, string>> = [];
    expect(validateCallback("uniwork-office://auth/callback?code=secret&state=secret", undefined, { logger: (event) => events.push(event) })).toEqual({ ok: false, reason: "no_attempt" });
    const expired = attemptAt(1_000);
    expect(validateCallback(`uniwork-office://auth/callback?code=secret&state=${expired.state}`, expired, { now: expired.expiresAt, logger: (event) => events.push(event) })).toEqual({ ok: false, reason: "expired" });
    expect(validateCallback("uniwork-office://auth/callback?code=secret&state=x", { ...expired, verifier: "" }, { now: 1_001 })).toEqual({ ok: false, reason: "verifier_missing" });
    expect(validateCallback("uniwork-office://auth/callback?code=secret&state=x", attemptAt(), { now: 1_001, expectedClientId: "other" })).toEqual({ ok: false, reason: "wrong_client" });
    expect(validateCallback("uniwork-office://auth/callback?code=secret&state=x", attemptAt(), { now: 1_001, expectedDeploymentId: "staging" })).toEqual({ ok: false, reason: "wrong_deployment" });
    expect(events).toEqual([{ event: "auth_callback_rejected", reason: "no_attempt" }, { event: "auth_callback_rejected", attemptId: expect.any(String), reason: "expired" }]);
    expect(JSON.stringify(events)).not.toContain("secret");
  });
  it("does not accept a manager override of the registered redirect", async () => {
    const { NativeLoginManager } = await import("./manager");
    expect(() => new NativeLoginManager({ clientId: config.clientId, deploymentId: config.deploymentId, redirectUri: `${config.redirectUri}/`, browser: { open: () => undefined }, transport: { start: async () => ({ authorizationUrl: "https://auth.invalid", attemptExpiresAt: "" }), exchange: async () => { throw new Error("unused"); } }, credentials: { save: () => undefined, get: () => undefined, clear: () => undefined } })).toThrow(/registered desktop callback/);
  });
});
