import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveDeploymentProfile } from "../../shared/deployment";
import type { CredentialSession, SafeStorageAdapter } from "../auth/credentials";
import { createSecureCredentialStore, credentialNamespace, wipeDeploymentCredentials } from "../credentials/secure-store";
import { MAX_PROFILE_BYTES, createProfileImport, profileConfirmation, type ProfileImportOptions } from "./import-profile";

const valid = { deploymentId: "uniwork-vn", apiOrigin: "https://uniwork.example.vn", clientId: "uniwork-office-dev", channel: "dev" } as const;
let root: string;
let downloads: string;
let userData: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "uniwork-import-profile-"));
  downloads = join(root, "Downloads");
  userData = join(root, "userData");
  for (const dir of [downloads, userData]) mkdirSync(dir, { recursive: true });
});
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

function picked(contents: string | object | Uint8Array, name = "deployment-profile.json"): string {
  const file = join(downloads, name);
  writeFileSync(file, typeof contents === "string" || contents instanceof Uint8Array ? contents : JSON.stringify(contents));
  return file;
}

function setup(overrides: Partial<ProfileImportOptions> = {}) {
  const relaunch = vi.fn(async () => true);
  const wipeCredentials = vi.fn();
  const confirmImport = vi.fn(async () => true);
  const confirmReset = vi.fn(async () => true);
  const isConfigured = () => {
    try { return !("kind" in resolveDeploymentProfile({ userDataDirectory: userData, buildChannel: "dev", env: {} })); }
    catch { return false; }
  };
  const flow = createProfileImport({ userDataDirectory: userData, buildChannel: "dev", isConfigured, pickFile: async () => undefined, confirmImport, confirmReset, wipeCredentials, relaunch, ...overrides });
  return { flow, relaunch, wipeCredentials, confirmImport, confirmReset };
}

const imported = () => join(userData, "deployment-profile.json");

describe("profile import", () => {
  it("imports a valid profile after confirmation, writes it atomically and relaunches", async () => {
    const file = picked(valid);
    const { flow, relaunch, confirmImport } = setup({ pickFile: async () => file });
    await expect(flow.importProfile()).resolves.toEqual({ status: "imported" });
    expect(confirmImport).toHaveBeenCalledWith({ host: "uniwork.example.vn", rawHost: "uniwork.example.vn", deploymentId: "uniwork-vn" });
    expect(JSON.parse(readFileSync(imported(), "utf8"))).toEqual(valid);
    expect(readdirSync(userData)).toEqual(["deployment-profile.json"]);
    if (process.platform !== "win32") expect(statSync(imported()).mode & 0o777).toBe(0o600);
    expect(relaunch).toHaveBeenCalledOnce();
    expect(resolveDeploymentProfile({ userDataDirectory: userData, buildChannel: "dev", env: {} })).toEqual(valid);
  });

  it("leaves no file when the picker or the confirmation is cancelled", async () => {
    const file = picked(valid);
    for (const overrides of [{ pickFile: async () => undefined }, { pickFile: async () => file, confirmImport: async () => false }]) {
      const { flow, relaunch } = setup(overrides);
      await expect(flow.importProfile()).resolves.toEqual({ status: "cancelled" });
      expect(existsSync(imported())).toBe(false);
      expect(relaunch).not.toHaveBeenCalled();
    }
  });

  it.each([
    ["malformed JSON", "{ not json"],
    ["an unknown key", { ...valid, extra: 1 }],
    ["HTTP outside loopback", { ...valid, apiOrigin: "http://uniwork.example.vn" }],
    ["a path in the origin", { ...valid, apiOrigin: "https://uniwork.example.vn/login" }],
    ["a wrong client id", { ...valid, clientId: "uniwork-office" }],
    ["invalid UTF-8", Uint8Array.from([0x7b, 0xff, 0x7d])],
  ])("refuses %s as invalid without confirming", async (_label, contents) => {
    const file = picked(contents);
    const { flow, confirmImport } = setup({ pickFile: async () => file });
    await expect(flow.importProfile()).resolves.toEqual({ status: "invalid" });
    expect(confirmImport).not.toHaveBeenCalled();
    expect(existsSync(imported())).toBe(false);
  });

  it("refuses a file over 4 KiB and a directory", async () => {
    const big = picked({ ...valid, padding: "x".repeat(MAX_PROFILE_BYTES) });
    await expect(setup({ pickFile: async () => big }).flow.importProfile()).resolves.toEqual({ status: "invalid" });
    await expect(setup({ pickFile: async () => downloads }).flow.importProfile()).resolves.toEqual({ status: "invalid" });
  });

  it("accepts HTTP loopback only because this is a dev build", async () => {
    const file = picked({ ...valid, apiOrigin: "http://127.0.0.1:8080" });
    await expect(setup({ pickFile: async () => file }).flow.importProfile()).resolves.toEqual({ status: "imported" });
    rmSync(imported());
    const stable = createProfileImport({ userDataDirectory: userData, buildChannel: "stable", isConfigured: () => false, pickFile: async () => picked({ ...valid, channel: "stable", clientId: "uniwork-office", apiOrigin: "http://127.0.0.1:8080" }), confirmImport: async () => true, confirmReset: async () => true, wipeCredentials: () => undefined, relaunch: async () => true });
    await expect(stable.importProfile()).resolves.toEqual({ status: "invalid" });
  });

  it("refuses a profile of another channel", async () => {
    const file = picked({ ...valid, channel: "stable", clientId: "uniwork-office" });
    await expect(setup({ pickFile: async () => file }).flow.importProfile()).resolves.toEqual({ status: "channel_mismatch" });
    expect(existsSync(imported())).toBe(false);
  });

  it("refuses while a profile already resolves or the installer owns one, before opening the picker", async () => {
    writeFileSync(imported(), JSON.stringify(valid));
    const pickFile = vi.fn(async () => picked({ ...valid, apiOrigin: "https://evil.example.test" }));
    await expect(setup({ pickFile }).flow.importProfile()).resolves.toEqual({ status: "already_configured" });
    rmSync(imported());
    const installed = join(root, "resources-profile.json");
    writeFileSync(installed, "{}");
    await expect(setup({ pickFile, installedProfilePath: installed }).flow.importProfile()).resolves.toEqual({ status: "already_configured" });
    expect(pickFile).not.toHaveBeenCalled();
    expect(JSON.parse(readFileSync(installed, "utf8"))).toEqual({});
  });

  it("replaces an invalid imported profile (the no-profile card stays reachable)", async () => {
    writeFileSync(imported(), "{ damaged");
    const file = picked(valid);
    await expect(setup({ pickFile: async () => file }).flow.importProfile()).resolves.toEqual({ status: "imported" });
    expect(JSON.parse(readFileSync(imported(), "utf8"))).toEqual(valid);
  });

  it("refuses when a profile appears while the dialogs are open, writing nothing", async () => {
    const file = picked(valid);
    const other = { ...valid, apiOrigin: "https://other.example.vn" };
    const confirmImport = vi.fn(async () => { writeFileSync(imported(), JSON.stringify(other)); return true; });
    const { flow, relaunch } = setup({ pickFile: async () => file, confirmImport });
    await expect(flow.importProfile()).resolves.toEqual({ status: "already_configured" });
    expect(JSON.parse(readFileSync(imported(), "utf8"))).toEqual(other);
    expect(relaunch).not.toHaveBeenCalled();
  });

  it("follows a picked symlink only to read it, and refuses one that points at a directory", async (context) => {
    const target = picked(valid, "real-profile.json");
    const link = join(downloads, "deployment-profile.json");
    const folderLink = join(downloads, "folder-link.json");
    try {
      symlinkSync(target, link, "file");
      symlinkSync(userData, folderLink, "dir");
    } catch {
      // Windows without Developer Mode cannot create symlinks.
      context.skip();
    }
    await expect(setup({ pickFile: async () => folderLink }).flow.importProfile()).resolves.toEqual({ status: "invalid" });
    await expect(setup({ pickFile: async () => link }).flow.importProfile()).resolves.toEqual({ status: "imported" });
    expect(JSON.parse(readFileSync(imported(), "utf8"))).toEqual(valid);
    expect(JSON.parse(readFileSync(target, "utf8"))).toEqual(valid);
  });

  it("keeps the saved profile and says restart is required when the leave dialog keeps the app open; the next call retries only the restart", async () => {
    const file = picked(valid);
    const pickFile = vi.fn(async () => file);
    const relaunch = vi.fn(async () => false);
    const { flow } = setup({ pickFile, relaunch });
    await expect(flow.importProfile()).resolves.toEqual({ status: "restart_required" });
    expect(JSON.parse(readFileSync(imported(), "utf8"))).toEqual(valid);
    relaunch.mockResolvedValueOnce(true);
    await expect(flow.importProfile()).resolves.toEqual({ status: "imported" });
    expect(pickFile).toHaveBeenCalledOnce();
    expect(relaunch).toHaveBeenCalledTimes(2);
    await expect(flow.resetConnection()).resolves.toEqual({ status: "not_imported" });
  });

  it("can import unless the installer owns a profile, even an unusable one", () => {
    expect(setup().flow.canImport()).toBe(true);
    const installed = join(root, "resources-profile.json");
    writeFileSync(installed, "{ damaged");
    expect(setup({ installedProfilePath: installed }).flow.canImport()).toBe(false);
  });

  it("reports unavailable and leaves no temp file when the write fails", async () => {
    const file = picked(valid);
    const fail = () => { throw new Error("disk full"); };
    const fileSystem = { existsSync, statSync, readFileSync, mkdirSync: () => undefined, writeFileSync: fail, openSync: fail, fsyncSync: fail, closeSync: fail, chmodSync: fail, renameSync: fail, rmSync: (path: string) => rmSync(path, { force: true }) };
    const { flow, relaunch } = setup({ pickFile: async () => file, fileSystem });
    await expect(flow.importProfile()).resolves.toEqual({ status: "unavailable" });
    expect(readdirSync(userData)).toEqual([]);
    expect(relaunch).not.toHaveBeenCalled();
  });
});

describe("connection reset", () => {
  it("removes the imported profile and wipes that deployment's sessions after confirmation", async () => {
    writeFileSync(imported(), JSON.stringify(valid));
    const { flow, wipeCredentials, confirmReset, relaunch } = setup();
    await expect(flow.resetConnection()).resolves.toEqual({ status: "reset" });
    expect(confirmReset).toHaveBeenCalledWith({ host: "uniwork.example.vn", rawHost: "uniwork.example.vn", deploymentId: "uniwork-vn" });
    expect(wipeCredentials).toHaveBeenCalledWith("uniwork-vn");
    expect(existsSync(imported())).toBe(false);
    expect(relaunch).toHaveBeenCalledOnce();
  });

  it("keeps everything when cancelled", async () => {
    writeFileSync(imported(), JSON.stringify(valid));
    const { flow, wipeCredentials, relaunch } = setup({ confirmReset: async () => false });
    await expect(flow.resetConnection()).resolves.toEqual({ status: "cancelled" });
    expect(wipeCredentials).not.toHaveBeenCalled();
    expect(existsSync(imported())).toBe(true);
    expect(relaunch).not.toHaveBeenCalled();
  });

  it("is not offered for an installer-owned profile or with nothing imported", async () => {
    await expect(setup().flow.resetConnection()).resolves.toEqual({ status: "not_imported" });
    writeFileSync(imported(), JSON.stringify(valid));
    const installed = join(root, "resources-profile.json");
    writeFileSync(installed, JSON.stringify(valid));
    await expect(setup({ installedProfilePath: installed }).flow.resetConnection()).resolves.toEqual({ status: "not_imported" });
  });

  it("removes a damaged imported file without wiping or signing out any sessions", async () => {
    writeFileSync(imported(), "{ damaged");
    const signOut = vi.fn(async () => undefined);
    const { flow, wipeCredentials, confirmReset } = setup({ signOut });
    await expect(flow.resetConnection()).resolves.toEqual({ status: "reset" });
    expect(confirmReset).toHaveBeenCalledWith(undefined);
    expect(wipeCredentials).not.toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();
    expect(existsSync(imported())).toBe(false);
  });

  it("signs out on the server first, then wipes", async () => {
    writeFileSync(imported(), JSON.stringify(valid));
    const order: string[] = [];
    const { flow } = setup({ signOut: async () => { order.push("signOut"); }, wipeCredentials: () => { order.push("wipe"); } });
    await expect(flow.resetConnection()).resolves.toEqual({ status: "reset" });
    expect(order).toEqual(["signOut", "wipe"]);
  });

  it("wipes even when the server logout fails or throws", async () => {
    const failures: Array<() => Promise<unknown>> = [async () => { throw new Error("offline"); }, () => { throw new Error("sync"); }];
    for (const signOut of failures) {
      writeFileSync(imported(), JSON.stringify(valid));
      const { flow, wipeCredentials } = setup({ signOut });
      await expect(flow.resetConnection()).resolves.toEqual({ status: "reset" });
      expect(wipeCredentials).toHaveBeenCalledWith("uniwork-vn");
      expect(existsSync(imported())).toBe(false);
    }
  });

  it("wipes after a bounded wait when the server logout hangs", async () => {
    vi.useFakeTimers();
    try {
      writeFileSync(imported(), JSON.stringify(valid));
      const { flow, wipeCredentials } = setup({ signOut: () => new Promise(() => undefined) });
      const result = flow.resetConnection();
      await vi.advanceTimersByTimeAsync(4999);
      expect(wipeCredentials).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      await expect(result).resolves.toEqual({ status: "reset" });
      expect(wipeCredentials).toHaveBeenCalledWith("uniwork-vn");
    } finally { vi.useRealTimers(); }
  });

  it("says restart is required when the leave dialog keeps the app open, and retries only the restart", async () => {
    writeFileSync(imported(), JSON.stringify(valid));
    const relaunch = vi.fn(async () => false);
    const { flow, wipeCredentials, confirmReset } = setup({ relaunch });
    await expect(flow.resetConnection()).resolves.toEqual({ status: "restart_required" });
    expect(existsSync(imported())).toBe(false);
    relaunch.mockResolvedValueOnce(true);
    await expect(flow.resetConnection()).resolves.toEqual({ status: "reset" });
    expect(confirmReset).toHaveBeenCalledOnce();
    expect(wipeCredentials).toHaveBeenCalledOnce();
  });

  it("removes the origin-scoped session through wipeDeploymentCredentials end to end", async () => {
    const session: CredentialSession = { accountId: "account-a", deviceSessionId: "device-a", sessionId: "session-a", accessToken: "access-secret", refreshToken: "refresh-secret", expiresIn: 900, refreshExpiresIn: 2_592_000 };
    const safeStorage: SafeStorageAdapter = { isEncryptionAvailable: () => true, encryptString: (value) => Buffer.from(value, "utf8"), decryptString: (value) => Buffer.from(value).toString("utf8") };
    const store = () => createSecureCredentialStore({ userDataDirectory: userData, channel: "dev", profile: valid, safeStorage });
    const other = { deploymentId: "uniwork-other", apiOrigin: valid.apiOrigin };
    await store().save(session);
    await createSecureCredentialStore({ userDataDirectory: userData, channel: "dev", profile: other, safeStorage }).save(session);
    writeFileSync(imported(), JSON.stringify(valid));
    const { flow } = setup({ wipeCredentials: (deploymentId) => wipeDeploymentCredentials({ userDataDirectory: userData, channel: "dev", deploymentId }) });
    await expect(flow.resetConnection()).resolves.toEqual({ status: "reset" });
    expect(existsSync(join(userData, "credentials", "dev", credentialNamespace(valid)))).toBe(false);
    expect(readdirSync(join(userData, "credentials", "dev"))).toEqual([credentialNamespace(other)]);
    expect(await store().get()).toBeUndefined();
  });
});

describe("profileConfirmation", () => {
  it("shows an IDN host decoded beside its punycode spelling, port included", () => {
    expect(profileConfirmation({ deploymentId: "d", apiOrigin: "https://xn--uniwrk-zxa.example:8443" })).toEqual({ host: "uniwörk.example:8443", rawHost: "xn--uniwrk-zxa.example:8443", deploymentId: "d" });
    expect(profileConfirmation({ deploymentId: "d", apiOrigin: "https://uniwörk.example" }).rawHost).toBe("xn--uniwrk-zxa.example");
  });
});
