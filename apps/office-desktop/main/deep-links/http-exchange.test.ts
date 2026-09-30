import { describe, expect, it, vi } from "vitest";
import type { DeploymentProfile } from "../../shared/deployment";
import { createInMemoryCredentialStore } from "../auth/credentials";
import { createHttpExchangePort } from "./http-exchange";

const profile: DeploymentProfile = { deploymentId: "deployment-a", apiOrigin: "https://api.example.test", clientId: "uniwork-office", channel: "stable" };
const request = { launchTicket: "ticket_0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_-abcde", clientId: profile.clientId, deploymentId: profile.deploymentId, deviceSessionId: "device-a", accountId: "account-a" } as const;
const descriptor = { id: "01J8X4DOC0N1P2Q3R4S5T6U7", organization_id: "01J8X4ORGN1P2Q3R4S5T6U7V8", workspace_id: "01J8X4WS0N1P2Q3R4S5T6U7V8", title: "Q4 plan", kind: "file", operation: "edit", version: 0, revision: "41", contract_version: "uniwork-office-engine-contract/1", protocol_version: "1", download_path: "/api/v1/documents/01J8X4DOC0N1P2Q3R4S5T6U7/download" };

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("profile-bound Office launch exchange", () => {
  it("sends the ticket only in the main-process request and returns a metadata receipt", async () => {
    const credentials = createInMemoryCredentialStore();
    await credentials.save({ accountId: "account-a", deviceSessionId: "device-a", sessionId: "session-a", accessToken: "access-secret", refreshToken: "refresh-secret", expiresIn: 900, refreshExpiresIn: 900 });
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ Authorization: "Bearer access-secret" });
      expect(String(init?.body)).toContain('"launch_ticket":"ticket_0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_-abcde"');
      return response({ receipt_id: "01J8X4RECEIPT1P2Q3R4S5T6U7", document: descriptor, redeemed_at: "2026-10-01T00:00:00Z" });
    });
    await expect(createHttpExchangePort({ profile, credentials, fetchImpl }).exchange(request)).resolves.toMatchObject({ kind: "opened", receiptId: "01J8X4RECEIPT1P2Q3R4S5T6U7" });
  });

  it("does not call the server for a stale account binding", async () => {
    const credentials = createInMemoryCredentialStore();
    await credentials.save({ accountId: "other-account", deviceSessionId: "device-a", sessionId: "session-a", accessToken: "secret", refreshToken: "refresh", expiresIn: 900, refreshExpiresIn: 900 });
    const fetchImpl = vi.fn();
    await expect(createHttpExchangePort({ profile, credentials, fetchImpl }).exchange(request)).resolves.toEqual({ kind: "login_required", reason: "account_mismatch" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects a response that tries to hand back a storage URL", async () => {
    const credentials = createInMemoryCredentialStore();
    await credentials.save({ accountId: "account-a", deviceSessionId: "device-a", sessionId: "session-a", accessToken: "secret", refreshToken: "refresh", expiresIn: 900, refreshExpiresIn: 900 });
    const fetchImpl = vi.fn(async () => response({ receipt_id: "r", document: { ...descriptor, download_path: "https://storage.example/signed" }, redeemed_at: "2026-10-01T00:00:00Z" }));
    await expect(createHttpExchangePort({ profile, credentials, fetchImpl }).exchange(request)).rejects.toThrow("exchange_failed");
  });

  it("rejects an incompatible engine descriptor or malformed receipt", async () => {
    const credentials = createInMemoryCredentialStore();
    await credentials.save({ accountId: "account-a", deviceSessionId: "device-a", sessionId: "session-a", accessToken: "secret", refreshToken: "refresh", expiresIn: 900, refreshExpiresIn: 900 });
    const fetchImpl = vi.fn(async () => response({
      receipt_id: "", redeemed_at: "not-a-time",
      document: { ...descriptor, contract_version: "future", protocol_version: "garbage" },
    }));
    await expect(createHttpExchangePort({ profile, credentials, fetchImpl }).exchange(request)).rejects.toThrow("exchange_failed");
  });

  it("accepts the first-party versioned download path for historical read-only opens", async () => {
    const credentials = createInMemoryCredentialStore();
    await credentials.save({ accountId: "account-a", deviceSessionId: "device-a", sessionId: "session-a", accessToken: "secret", refreshToken: "refresh", expiresIn: 900, refreshExpiresIn: 900 });
    const fetchImpl = vi.fn(async () => response({
      receipt_id: "01J8X4RECEIPT1P2Q3R4S5T6U7", redeemed_at: "2026-10-01T00:00:00Z",
      document: { ...descriptor, operation: "view", version: 3, download_path: `${descriptor.download_path}?version=3` },
    }));
    await expect(createHttpExchangePort({ profile, credentials, fetchImpl }).exchange(request)).resolves.toMatchObject({ kind: "opened", descriptor: { version: 3 } });
  });
});
