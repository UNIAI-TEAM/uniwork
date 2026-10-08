import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { CredentialSession, SafeStorageAdapter } from "../auth/credentials";
import { createSecureCredentialStore, credentialNamespace, wipeDeploymentCredentials } from "./secure-store";

const session: CredentialSession = { accountId: "account-a", deviceSessionId: "device-a", sessionId: "session-a", accessToken: "access-secret", refreshToken: "refresh-secret", expiresIn: 900, refreshExpiresIn: 2_592_000 };
const safeStorage: SafeStorageAdapter = { isEncryptionAvailable: () => true, encryptString: (value) => Buffer.from(value, "utf8"), decryptString: (value) => Buffer.from(value).toString("utf8") };
const real = { deploymentId: "uniwork-vn", apiOrigin: "https://uniwork.example.vn" };
const forged = { deploymentId: "uniwork-vn", apiOrigin: "https://uniwork-example.attacker.test" };
function temp() { return mkdtempSync(join(tmpdir(), "uniwork-secure-store-")); }

describe("origin-scoped credential store", () => {
  it("keys the namespace by deployment id and the sha256 of the normalised origin", () => {
    const hash = createHash("sha256").update("https://uniwork.example.vn").digest("hex").slice(0, 12);
    expect(credentialNamespace(real)).toBe(`uniwork-vn@${hash}`);
    expect(credentialNamespace({ ...real, apiOrigin: "https://UNIWORK.example.vn:443/" })).toBe(`uniwork-vn@${hash}`);
    expect(credentialNamespace(forged)).not.toBe(credentialNamespace(real));
  });

  it("never shows a forged origin the tokens stored for the real one", async () => {
    const root = temp();
    try {
      await createSecureCredentialStore({ userDataDirectory: root, channel: "dev", profile: real, safeStorage }).save(session);
      expect(await createSecureCredentialStore({ userDataDirectory: root, channel: "dev", profile: real, safeStorage }).get()).toEqual(session);
      expect(await createSecureCredentialStore({ userDataDirectory: root, channel: "dev", profile: forged, safeStorage }).get()).toBeUndefined();
      expect(readdirSync(join(root, "credentials", "dev", credentialNamespace(forged)))).toEqual([]);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("does not read the pre-origin directory (no migration: one new sign-in)", async () => {
    const root = temp();
    try {
      await createSecureCredentialStore({ userDataDirectory: root, channel: "dev", profile: real, safeStorage }).save(session);
      const scoped = join(root, "credentials", "dev", credentialNamespace(real));
      const legacy = join(root, "credentials", "dev", real.deploymentId);
      // Simulate a store written before the origin segment existed.
      mkdirSync(legacy, { recursive: true });
      for (const name of readdirSync(scoped)) rmSync(join(scoped, name));
      expect(await createSecureCredentialStore({ userDataDirectory: root, channel: "dev", profile: real, safeStorage }).get()).toBeUndefined();
      expect(existsSync(legacy)).toBe(true);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("reset wipes every root of that deployment on that channel only", async () => {
    const root = temp();
    try {
      await createSecureCredentialStore({ userDataDirectory: root, channel: "dev", profile: real, safeStorage }).save(session);
      await createSecureCredentialStore({ userDataDirectory: root, channel: "dev", profile: forged, safeStorage }).save(session);
      await createSecureCredentialStore({ userDataDirectory: root, channel: "dev", profile: { deploymentId: "uniwork-vn2", apiOrigin: real.apiOrigin }, safeStorage }).save(session);
      await createSecureCredentialStore({ userDataDirectory: root, channel: "beta", profile: real, safeStorage }).save(session);
      mkdirSync(join(root, "credentials", "dev", "uniwork-vn"), { recursive: true });
      wipeDeploymentCredentials({ userDataDirectory: root, channel: "dev", deploymentId: "uniwork-vn" });
      expect(readdirSync(join(root, "credentials", "dev"))).toEqual([credentialNamespace({ deploymentId: "uniwork-vn2", apiOrigin: real.apiOrigin })]);
      expect(readdirSync(join(root, "credentials", "beta"))).toEqual([credentialNamespace(real)]);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("reset is a no-op without a credential directory or with a malformed id", () => {
    const root = temp();
    try {
      expect(() => wipeDeploymentCredentials({ userDataDirectory: root, channel: "dev", deploymentId: "uniwork-vn" })).not.toThrow();
      mkdirSync(join(root, "credentials", "dev", "x@0123456789ab"), { recursive: true });
      wipeDeploymentCredentials({ userDataDirectory: root, channel: "dev", deploymentId: "" });
      expect(readdirSync(join(root, "credentials", "dev"))).toEqual(["x@0123456789ab"]);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
