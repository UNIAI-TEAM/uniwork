import { describe, expect, it, vi } from "vitest";
import { DESKTOP_IDENTITY } from "../../shared/identity";
import { CredentialStoreError, type CredentialStore } from "./credentials";
import { NativeLoginManager } from "./manager";
import type { AuthTransport } from "../transport/auth-transport";

const sessionResponse = { accountId: "account-a", deviceSessionId: "device-a", sessionId: "session-a", deploymentId: "deployment-a", accessToken: "access-secret", refreshToken: "refresh-secret", expiresIn: 900, refreshExpiresIn: 1_000 };

function keyringRefusingStore(): CredentialStore {
  return {
    save: () => { throw new CredentialStoreError("keyring_required"); },
    get: () => { throw new CredentialStoreError("keyring_required"); },
    clear: () => { throw new CredentialStoreError("keyring_required"); },
  };
}

function createManager(credentials: CredentialStore, logger = vi.fn()) {
  const transport: AuthTransport = {
    start: async () => ({ authorizationUrl: "https://app.uniwork.ai/auth/desktop?attempt=1", attemptExpiresAt: new Date(Date.now() + 60_000).toISOString() }),
    exchange: async () => sessionResponse,
  };
  return new NativeLoginManager({
    clientId: "com.uniwork.office.dev",
    deploymentId: "deployment-a",
    browser: { open: async () => undefined },
    transport,
    credentials,
    logger,
  });
}

describe("login manager credential failures", () => {
  it("names the missing keyring on restore so the UI can show its fix", async () => {
    const manager = createManager(keyringRefusingStore());
    await expect(manager.restore()).resolves.toEqual({ status: "locked", lockedReason: "keyring" });
  });

  it("keeps ordinary locked and corrupt stores on their existing states", async () => {
    const locked = createManager({ save: () => undefined, get: () => { throw new CredentialStoreError("locked"); }, clear: () => undefined });
    await expect(locked.restore()).resolves.toEqual({ status: "locked" });
    const corrupt = createManager({ save: () => undefined, get: () => { throw new CredentialStoreError("corrupt"); }, clear: () => undefined });
    await expect(corrupt.restore()).resolves.toEqual({ status: "login-required" });
  });

  it("returns the typed locked state when the callback cannot persist the session", async () => {
    const logger = vi.fn();
    const manager = createManager(keyringRefusingStore(), logger);
    await manager.startLogin();
    const attempt = manager.getCurrentAttempt();
    expect(attempt).toBeDefined();
    const result = await manager.handleCallback(`${DESKTOP_IDENTITY.authCallback}?code=code_abc&state=${attempt!.state}`);
    expect(result).toEqual({ ok: false, reason: "store_locked" });
    expect(manager.getMetadata()).toEqual({ status: "locked", lockedReason: "keyring" });
    expect(logger).toHaveBeenCalledWith(expect.objectContaining({ event: "auth_credential_store_failed", reason: "keyring_required" }));
    expect(JSON.stringify(logger.mock.calls)).not.toContain("access-secret");
  });

  it("does not add a keyring reason for a generic locked store", async () => {
    const manager = createManager({ save: () => { throw new CredentialStoreError("locked"); }, get: () => undefined, clear: () => undefined });
    await manager.startLogin();
    const attempt = manager.getCurrentAttempt();
    const result = await manager.handleCallback(`${DESKTOP_IDENTITY.authCallback}?code=code_abc&state=${attempt!.state}`);
    expect(result).toEqual({ ok: false, reason: "store_locked" });
    expect(manager.getMetadata()).toEqual({ status: "locked" });
  });
});
