import { describe, expect, it, vi } from "vitest";
import { createDesktopHost } from "../index";
import type { NativeLoginManager } from "../auth/manager";
import type { ProfileImportFlow } from "./import-profile";

const sender = { senderId: 1, frameId: 0, origin: "uniwork-office-app://app", expectedSenderId: 1, expectedFrameId: 0, expectedOrigin: "uniwork-office-app://app", sessionGeneration: "session_1234" };
const windowPreferences = { sandbox: true, contextIsolation: true, nodeIntegration: false } as const;
const request = { sessionGeneration: "session_1234" };

function flow(overrides: Partial<ProfileImportFlow> = {}): ProfileImportFlow {
  return { importProfile: vi.fn(async () => ({ status: "imported" as const })), resetConnection: vi.fn(async () => ({ status: "reset" as const })), isImported: () => true, canImport: () => true, ...overrides };
}

function host(options: { deploymentImport?: ProfileImportFlow; authManager?: NativeLoginManager } = {}) {
  const contents = { on: vi.fn(), setWindowOpenHandler: vi.fn() };
  return createDesktopHost({ window: { webContents: contents, webPreferences: windowPreferences, loadURL: vi.fn(), setUserDataDirectory: vi.fn() }, sender, noDeploymentProfile: "missing", ...options });
}

describe("deployment import IPC", () => {
  it("routes import and reset to the main-owned flow with no renderer input", async () => {
    const deploymentImport = flow();
    const desktop = host({ deploymentImport });
    await expect(desktop.dispatch("desktop:deployment-import", request)).resolves.toEqual({ status: "imported" });
    await expect(desktop.dispatch("desktop:deployment-reset", request)).resolves.toEqual({ status: "reset" });
    expect(deploymentImport.importProfile).toHaveBeenCalledWith();
    expect(deploymentImport.resetConnection).toHaveBeenCalledWith();
  });

  it("refuses a renderer that tries to name a path or send file content", async () => {
    const deploymentImport = flow();
    const desktop = host({ deploymentImport });
    await expect(desktop.dispatch("desktop:deployment-import", { ...request, path: "/tmp/evil.json" } as never)).rejects.toMatchObject({ code: "schema" });
    await expect(desktop.dispatch("desktop:deployment-import", { ...request, profile: { apiOrigin: "https://evil.test" } } as never)).rejects.toMatchObject({ code: "schema" });
    expect(deploymentImport.importProfile).not.toHaveBeenCalled();
  });

  it("answers only the typed statuses", async () => {
    const desktop = host({ deploymentImport: flow({ importProfile: async () => ({ status: "surprise" }) as never }) });
    await expect(desktop.dispatch("desktop:deployment-import", request)).rejects.toThrow();
  });

  it("is not registered without the flow", async () => {
    await expect(host().dispatch("desktop:deployment-import", request)).rejects.toMatchObject({ code: "unknown_channel" });
  });

  it("marks an imported profile resettable on auth-config", async () => {
    const authManager = { getBinding: () => ({ clientId: "uniwork-office-dev", deploymentId: "uniwork-vn" }) } as unknown as NativeLoginManager;
    await expect(host({ authManager, deploymentImport: flow() }).dispatch("desktop:auth-config", request)).resolves.toEqual({ clientId: "uniwork-office-dev", deploymentId: "uniwork-vn", resettable: true });
    await expect(host({ authManager, deploymentImport: flow({ isImported: () => false }) }).dispatch("desktop:auth-config", request)).resolves.toEqual({ clientId: "uniwork-office-dev", deploymentId: "uniwork-vn", resettable: false });
  });

  it("tells the no-profile card whether choosing a file can take effect", async () => {
    await expect(host({ deploymentImport: flow() }).dispatch("desktop:auth-config", request)).resolves.toEqual({ state: "no_deployment_profile", reason: "missing", importable: true });
    await expect(host({ deploymentImport: flow({ canImport: () => false }) }).dispatch("desktop:auth-config", request)).resolves.toEqual({ state: "no_deployment_profile", reason: "missing", importable: false });
  });

  it("passes restart_required through on both channels", async () => {
    const desktop = host({ deploymentImport: flow({ importProfile: async () => ({ status: "restart_required" }), resetConnection: async () => ({ status: "restart_required" }) }) });
    await expect(desktop.dispatch("desktop:deployment-import", request)).resolves.toEqual({ status: "restart_required" });
    await expect(desktop.dispatch("desktop:deployment-reset", request)).resolves.toEqual({ status: "restart_required" });
  });
});
