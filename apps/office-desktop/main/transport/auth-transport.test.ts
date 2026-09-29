import { describe, expect, it } from "vitest";
import { LoginAttemptStore } from "../auth/attempt-store";
import { NativeLoginManager } from "../auth/manager";
import { createInMemoryCredentialStore } from "../auth/credentials";
import { createSystemBrowserLauncher } from "../auth/browser";
import { createAllowlistedAuthTransport } from "./auth-transport";
import { FAKE_AUTH_CODE_TTL_MS, FakeAuthServer } from "./fake-auth-server";

const binding = { clientId: "com.uniwork.office", deploymentId: "production-eu", redirectUri: "uniwork-office://auth/callback" };

describe("desktop auth transport and fake contract", () => {
  it("allows only bound start/exchange operations and rejects arbitrary routes", async () => {
    const server = new FakeAuthServer({ now: () => 1_000 });
    const transport = createAllowlistedAuthTransport({ origin: "https://api.example.test", ...binding, server });
    const response = await transport.start({ ...binding, codeChallenge: "a".repeat(43), codeChallengeMethod: "S256", state: "s", redirectUri: binding.redirectUri });
    expect(response.authorizationUrl).toContain("/auth/desktop/authorize?");
    expect(FAKE_AUTH_CODE_TTL_MS).toBe(120_000);
    expect(() => createAllowlistedAuthTransport({ origin: "http://evil.example", ...binding, server })).toThrow();
  });
  it("runs a happy-path exchange once and rejects replay", async () => {
    let now = 1_000;
    const server = new FakeAuthServer({ now: () => now, accountId: "account-1" });
    const transport = createAllowlistedAuthTransport({ origin: "https://api.example.test", ...binding, server });
    const opened: string[] = [];
    const attempts = new LoginAttemptStore({ randomBytes: (size) => new Uint8Array(size).fill(5) });
    const manager = new NativeLoginManager({ ...binding, attempts, browser: createSystemBrowserLauncher((url) => { opened.push(url); }), transport, credentials: createInMemoryCredentialStore(), now: () => now });
    const start = await manager.startLogin();
    expect(opened).toHaveLength(1);
    const current = manager.getCurrentAttempt(now);
    expect(current?.attemptId).toBe(start.attemptId);
    const callback = server.issueCallback({ state: current!.state, clientId: binding.clientId, deploymentId: binding.deploymentId, redirectUri: binding.redirectUri });
    await expect(manager.handleCallback(callback)).resolves.toMatchObject({ ok: true, metadata: { status: "signed-in", accountId: "account-1" } });
    await expect(manager.handleCallback(callback)).resolves.toEqual({ ok: false, reason: "no_attempt" });
    now += 1;
  });
  it("cancels before callback and never opens a credential-shaped IPC result", async () => {
    const server = new FakeAuthServer({ now: () => 1_000 });
    const manager = new NativeLoginManager({ ...binding, browser: createSystemBrowserLauncher(() => undefined), transport: createAllowlistedAuthTransport({ origin: "https://api.example.test", ...binding, server }), credentials: createInMemoryCredentialStore(), now: () => 1_000 });
    const start = await manager.startLogin();
    expect(manager.cancelLogin(start.attemptId)).toEqual({ status: "signed-out" });
    expect(manager.getCurrentAttempt(1_000)).toBeUndefined();
  });
  it("fails closed when the browser or exchange binding is invalid", async () => {
    const server = new FakeAuthServer({ now: () => 1_000 });
    const transport = createAllowlistedAuthTransport({ origin: "https://api.example.test", ...binding, server });
    const manager = new NativeLoginManager({ ...binding, browser: createSystemBrowserLauncher(() => { throw new Error("browser unavailable"); }), transport, credentials: createInMemoryCredentialStore(), now: () => 1_000 });
    await expect(manager.startLogin()).rejects.toThrow(/browser/);
    expect(manager.getMetadata()).toEqual({ status: "signed-out" });
    const badTransport = { ...transport, exchange: async () => ({ accountId: "a", deviceSessionId: "d", sessionId: "s", deploymentId: "staging", accessToken: "a", refreshToken: "r", expiresIn: 1, refreshExpiresIn: 1 }) };
    const manager2 = new NativeLoginManager({ ...binding, browser: createSystemBrowserLauncher(() => { }), transport: badTransport, credentials: createInMemoryCredentialStore(), now: () => 1_000 });
    await manager2.startLogin();
    const current = manager2.getCurrentAttempt(1_000)!;
    const callback = server.issueCallback({ state: current.state, clientId: binding.clientId, deploymentId: binding.deploymentId, redirectUri: binding.redirectUri });
    await expect(manager2.handleCallback(callback)).resolves.toEqual({ ok: false, reason: "exchange_failed" });
  });
});
