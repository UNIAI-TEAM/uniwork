import { describe, expect, it, vi } from "vitest";
import { createDesktopHost } from "../index";
import { DeploymentProfileResolutionError } from "../../shared/deployment";
import { resolveProfileOutcome } from "./no-profile";

const sender = { senderId: 1, frameId: 0, origin: "uniwork-office-app://app", expectedSenderId: 1, expectedFrameId: 0, expectedOrigin: "uniwork-office-app://app", sessionGeneration: "session_1234" };
const windowPreferences = { sandbox: true, contextIsolation: true, nodeIntegration: false } as const;
const request = { sessionGeneration: "session_1234" };

function hostWithout(reason?: "missing" | "invalid" | "channel_mismatch") {
  const contents = { on: vi.fn(), setWindowOpenHandler: vi.fn() };
  return createDesktopHost({ window: { webContents: contents, webPreferences: windowPreferences, loadURL: vi.fn(), setUserDataDirectory: vi.fn() }, sender, ...(reason ? { noDeploymentProfile: reason } : {}) });
}

describe("no deployment profile", () => {
  it("keeps every auth channel registered and answers a typed no_deployment_profile state", async () => {
    const host = hostWithout("missing");
    await expect(host.dispatch("desktop:auth-config", request)).resolves.toEqual({ state: "no_deployment_profile", reason: "missing" });
    await expect(host.dispatch("desktop:auth-session", request)).resolves.toEqual({ status: "signed-out" });
    await expect(host.dispatch("desktop:auth-start", { ...request, clientId: "uniwork-office", deploymentId: "production-eu" })).resolves.toEqual({ status: "no_deployment_profile", reason: "missing" });
    await expect(host.dispatch("desktop:auth-cancel", { ...request, attemptId: "attempt_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKL" })).resolves.toEqual({ status: "signed-out" });
    await expect(host.dispatch("desktop:auth-logout", { ...request, scope: "device" })).resolves.toEqual({ status: "signed-out" });
  });

  it("keeps the reason for diagnostics and no path, profile field or message", async () => {
    for (const reason of ["invalid", "channel_mismatch"] as const) {
      const answer = await hostWithout(reason).dispatch("desktop:auth-config", request);
      expect(answer).toEqual({ state: "no_deployment_profile", reason });
      expect(Object.keys(answer as object).sort()).toEqual(["reason", "state"]);
    }
  });

  it("keeps IPC validation strict: a malformed request is still refused", async () => {
    await expect(hostWithout("missing").dispatch("desktop:auth-config", { sessionGeneration: "session_1234", extra: 1 } as never)).rejects.toMatchObject({ code: "schema" });
  });

  it("leaves the channels unregistered for a host that names neither a manager nor a reason", async () => {
    await expect(hostWithout().dispatch("desktop:auth-config", request)).rejects.toMatchObject({ code: "unknown_channel" });
  });
});

describe("resolveProfileOutcome", () => {
  const profile = { deploymentId: "production-eu", apiOrigin: "https://app.example.test", clientId: "uniwork-office", channel: "stable" } as const;
  it("returns the profile when one resolves", () => {
    expect(resolveProfileOutcome(() => profile, { packaged: true })).toEqual({ profile });
  });
  it("maps an absent profile to missing", () => {
    expect(resolveProfileOutcome(() => ({ kind: "no_deployment_profile", message: "m" }), { packaged: true })).toEqual({ reason: "missing" });
  });
  it("lets a packaged app survive an invalid or mismatched profile", () => {
    expect(resolveProfileOutcome(() => { throw new DeploymentProfileResolutionError("invalid", "x"); }, { packaged: true })).toEqual({ reason: "invalid" });
    expect(resolveProfileOutcome(() => { throw new DeploymentProfileResolutionError("channel_mismatch", "x"); }, { packaged: true })).toEqual({ reason: "channel_mismatch" });
    expect(resolveProfileOutcome(() => { throw new DeploymentProfileResolutionError("no_deployment_profile", "x"); }, { packaged: true })).toEqual({ reason: "missing" });
  });
  it("keeps today's failure for an unpackaged run and for an unexpected error", () => {
    expect(() => resolveProfileOutcome(() => { throw new DeploymentProfileResolutionError("invalid", "x"); }, { packaged: false })).toThrow("x");
    expect(() => resolveProfileOutcome(() => { throw new Error("disk"); }, { packaged: true })).toThrow("disk");
  });
});
