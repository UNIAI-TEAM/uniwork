import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyUpdate, UpdateVerificationError } from "./verifier";

const bytes = new TextEncoder().encode("signed test installer");
const keys = generateKeyPairSync("ed25519");
const config = { enabled: true, feed: "https://updates.example.test/dev", publisher: "UniWork Test", channel: "dev" as const };
function artifact(overrides: Partial<Parameters<typeof verifyUpdate>[1]> = {}) {
  return { url: "https://updates.example.test/dev/installer.exe", bytes, signature: sign(null, bytes, keys.privateKey).toString("base64"), publicKey: keys.publicKey.export({ format: "pem", type: "spki" }).toString(), publisher: "UniWork Test", appId: "com.uniwork.office", channel: "dev" as const, engineVersion: "genoffice@new", contractVersion: "uniwork-office-engine-contract/1", sha256: "", ...overrides };
}
function valid() { const a = artifact(); return { ...a, sha256: createHash("sha256").update(bytes).digest("hex") }; }
function code(fn: () => unknown): string { try { fn(); return ""; } catch (error) { return (error as UpdateVerificationError).code; } }

describe("desktop update verification", () => {
  it("accepts a correctly signed test artifact", () => expect(verifyUpdate(config, valid()).sha256).toHaveLength(64));
  it.each([
    ["TLS", { url: "http://updates.example.test/dev/installer.exe" }, "tls_failure"],
    ["signature", { signature: Buffer.from("bad").toString("base64") }, "invalid_signature"],
    ["publisher", { publisher: "Other" }, "wrong_publisher"],
    ["app id", { appId: "com.other.app" }, "wrong_app_id"],
    ["channel", { channel: "stable" as const }, "wrong_channel"],
    ["hash", { sha256: "0".repeat(64) }, "hash_mismatch"],
    ["engine", { engineVersion: "other@old" }, "down_level_engine"],
  ])("refuses %s with a typed reason", (_name, change, expected) => expect(code(() => verifyUpdate(config, { ...valid(), ...change }))).toBe(expected));
  it("refuses automatic updates when disabled", () => expect(code(() => verifyUpdate({ ...config, enabled: false }, valid()))).toBe("auto_update_disabled"));
});
