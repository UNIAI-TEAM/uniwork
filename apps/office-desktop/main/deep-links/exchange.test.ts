import { describe, expect, it } from "vitest";
import { FakeExchangePort, LAUNCH_TICKET_TTL_MS } from "./exchange";

const binding = { accountId: "account-1", deploymentId: "production-eu", deviceSessionId: "device-1" } as const;

describe("fake Office exchange port", () => {
  it("checks account/deployment before a single-use redemption", async () => {
    let now = 1_000;
    const fake = new FakeExchangePort({ now: () => now });
    const issued = fake.issueTicket({ accountId: binding.accountId, deploymentId: binding.deploymentId, operation: "edit" });
    await expect(fake.exchange({ launchTicket: issued.ticket, clientId: "uniwork-office", deploymentId: binding.deploymentId, deviceSessionId: "device-other", accountId: "other-account" })).resolves.toEqual({ kind: "login_required", reason: "account_mismatch" });
    expect(fake.calls).toBe(1);
    await expect(fake.exchange({ launchTicket: issued.ticket, clientId: "uniwork-office", deploymentId: "staging", deviceSessionId: binding.deviceSessionId, accountId: binding.accountId })).resolves.toEqual({ kind: "login_required", reason: "deployment_mismatch" });
    expect(fake.calls).toBe(2);
    await expect(fake.exchange({ launchTicket: issued.ticket, clientId: "uniwork-office", ...binding })).resolves.toMatchObject({ kind: "opened", descriptor: { operation: "edit" } });
    await expect(fake.exchange({ launchTicket: issued.ticket, clientId: "uniwork-office", ...binding })).resolves.toEqual({ kind: "refused", reason: "replayed" });
    now = issued.expiresAt + 1;
    expect(LAUNCH_TICKET_TTL_MS).toBe(120_000);
  });

  it("expires with the explicit clock-skew budget and never returns metadata", async () => {
    let now = 0;
    const fake = new FakeExchangePort({ now: () => now, clockSkewMs: 0 });
    const issued = fake.issueTicket({ accountId: binding.accountId, deploymentId: binding.deploymentId, operation: "view", ttlMs: 10 });
    now = issued.expiresAt;
    await expect(fake.exchange({ launchTicket: issued.ticket, clientId: "uniwork-office", ...binding })).resolves.toEqual({ kind: "refused", reason: "expired" });
    expect(JSON.stringify(await fake.exchange({ launchTicket: "ticket_" + "z".repeat(32), clientId: "uniwork-office", ...binding }))).not.toContain("ticket_");
  });
});
