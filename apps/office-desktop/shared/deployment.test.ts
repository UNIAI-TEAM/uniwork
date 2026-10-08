import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { USER_DATA_PROFILE_FILE, parseDeploymentProfile, resolveDeploymentProfile } from "./deployment";

const valid = { deploymentId: "test-eu", apiOrigin: "https://api.example.test", clientId: "uniwork-office-dev", channel: "dev" } as const;

describe("deployment profile resolver", () => {
  it("prefers a strict installed profile over build environment", () => {
    const root = mkdtempSync(join(tmpdir(), "uniwork-deployment-"));
    const file = join(root, "deployment-profile.json");
    writeFileSync(file, JSON.stringify(valid));
    expect(resolveDeploymentProfile({ installedProfilePath: file, buildChannel: "dev", env: { UNIWORK_OFFICE_DEPLOYMENT_ID: "other", UNIWORK_OFFICE_API_ORIGIN: "https://other.example.test" } })).toEqual(valid);
    rmSync(root, { recursive: true, force: true });
  });

  it("uses build environment only for the dev fallback", () => {
    expect(resolveDeploymentProfile({ buildChannel: "dev", env: { UNIWORK_OFFICE_DEPLOYMENT_ID: valid.deploymentId, UNIWORK_OFFICE_API_ORIGIN: valid.apiOrigin } })).toEqual(valid);
    expect(resolveDeploymentProfile({ buildChannel: "beta", env: { UNIWORK_OFFICE_DEPLOYMENT_ID: valid.deploymentId, UNIWORK_OFFICE_API_ORIGIN: valid.apiOrigin } })).toMatchObject({ kind: "no_deployment_profile" });
  });

  it("returns a typed no-profile state and refuses channel mismatch or invalid origins", () => {
    expect(resolveDeploymentProfile({ buildChannel: "beta", env: {} })).toMatchObject({ kind: "no_deployment_profile" });
    const root = mkdtempSync(join(tmpdir(), "uniwork-deployment-"));
    const file = join(root, "deployment-profile.json");
    writeFileSync(file, JSON.stringify({ ...valid, channel: "beta", clientId: "uniwork-office" }));
    expect(() => resolveDeploymentProfile({ installedProfilePath: file, buildChannel: "dev", env: {} })).toThrowError(expect.objectContaining({ code: "channel_mismatch" }));
    writeFileSync(file, JSON.stringify({ ...valid, apiOrigin: "http://evil.example.test" }));
    expect(() => resolveDeploymentProfile({ installedProfilePath: file, buildChannel: "dev", env: {} })).toThrowError(expect.objectContaining({ code: "invalid" }));
    rmSync(root, { recursive: true, force: true });
  });

  it("reads an imported profile from userData through the same validator", () => {
    const root = mkdtempSync(join(tmpdir(), "uniwork-deployment-"));
    writeFileSync(join(root, USER_DATA_PROFILE_FILE), JSON.stringify(valid));
    expect(resolveDeploymentProfile({ userDataDirectory: root, buildChannel: "dev", env: {} })).toEqual(valid);
    writeFileSync(join(root, USER_DATA_PROFILE_FILE), JSON.stringify({ ...valid, extra: true }));
    expect(() => resolveDeploymentProfile({ userDataDirectory: root, buildChannel: "dev", env: {} })).toThrowError(expect.objectContaining({ code: "invalid" }));
    rmSync(root, { recursive: true, force: true });
  });
});

describe("parseDeploymentProfile", () => {
  const stable = { ...valid, channel: "stable", clientId: "uniwork-office" } as const;
  it("accepts a strict profile for the build channel", () => {
    expect(parseDeploymentProfile(valid, "dev")).toEqual(valid);
    expect(parseDeploymentProfile(stable, "stable")).toEqual(stable);
  });
  it.each([
    ["an unknown key", { ...valid, signature: "x" }],
    ["a non-object", "https://api.example.test"],
    ["HTTP outside loopback", { ...valid, apiOrigin: "http://api.example.test" }],
    ["HTTP loopback on a non-dev channel", { ...stable, apiOrigin: "http://127.0.0.1:8080" }],
    ["a path in the origin", { ...valid, apiOrigin: "https://api.example.test/x" }],
    ["credentials in the origin", { ...valid, apiOrigin: "https://user:pw@api.example.test" }],
    ["a client id of another channel", { ...valid, clientId: "uniwork-office" }],
    ["a malformed deployment id", { ...valid, deploymentId: "../etc" }],
  ])("refuses %s as invalid", (_label, raw) => {
    expect(() => parseDeploymentProfile(raw, raw && typeof raw === "object" && "channel" in raw ? raw.channel : "dev")).toThrowError(expect.objectContaining({ code: "invalid" }));
  });
  it("allows HTTP loopback only on a dev profile", () => {
    expect(parseDeploymentProfile({ ...valid, apiOrigin: "http://127.0.0.1:8080" }, "dev").apiOrigin).toBe("http://127.0.0.1:8080");
  });
  it("refuses a profile of another channel as channel_mismatch", () => {
    expect(() => parseDeploymentProfile(valid, "stable")).toThrowError(expect.objectContaining({ code: "channel_mismatch" }));
    expect(() => parseDeploymentProfile(stable, "dev")).toThrowError(expect.objectContaining({ code: "channel_mismatch" }));
  });
});
