import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveDeploymentProfile } from "./deployment";

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
});
