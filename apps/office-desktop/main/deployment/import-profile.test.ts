import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveDeploymentProfile } from "../../shared/deployment";
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
  const relaunch = vi.fn();
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
    const stable = createProfileImport({ userDataDirectory: userData, buildChannel: "stable", isConfigured: () => false, pickFile: async () => picked({ ...valid, channel: "stable", clientId: "uniwork-office", apiOrigin: "http://127.0.0.1:8080" }), confirmImport: async () => true, confirmReset: async () => true, wipeCredentials: () => undefined, relaunch: () => undefined });
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

  it("removes a damaged imported file without wiping any sessions", async () => {
    writeFileSync(imported(), "{ damaged");
    const { flow, wipeCredentials, confirmReset } = setup();
    await expect(flow.resetConnection()).resolves.toEqual({ status: "reset" });
    expect(confirmReset).toHaveBeenCalledWith(undefined);
    expect(wipeCredentials).not.toHaveBeenCalled();
    expect(existsSync(imported())).toBe(false);
  });
});

describe("profileConfirmation", () => {
  it("shows an IDN host decoded beside its punycode spelling, port included", () => {
    expect(profileConfirmation({ deploymentId: "d", apiOrigin: "https://xn--uniwrk-zxa.example:8443" })).toEqual({ host: "uniwörk.example:8443", rawHost: "xn--uniwrk-zxa.example:8443", deploymentId: "d" });
    expect(profileConfirmation({ deploymentId: "d", apiOrigin: "https://uniwörk.example" }).rawHost).toBe("xn--uniwrk-zxa.example");
  });
});
