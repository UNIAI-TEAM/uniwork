import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { DESKTOP_IDENTITY_MANIFEST as identity } from "../../shared/identity";
import { DEFAULT_UPDATE_CONFIG } from "./config";
import { updateSigningPayload, verifyUpdate, type UpdateRelease, type UpdateTrust } from "./verifier";

const bytes = Buffer.from("test installer bytes");
const keys = generateKeyPairSync("ed25519");
const config = { enabled: true, feed: "https://updates.example.test/feed", publisher: "UniWork Test", channel: identity.build.channel };
const trust: UpdateTrust = {
  publisher: config.publisher,
  publicKeyPem: keys.publicKey.export({ format: "pem", type: "spki" }).toString(),
  engineVersions: ["genoffice@older", identity.engine.version, "genoffice@reviewed-next"],
};
function release(change: Partial<UpdateRelease> = {}, privateKey = keys.privateKey): UpdateRelease {
  const item = {
    url: "https://updates.example.test/installer.exe", sha256: createHash("sha256").update(bytes).digest("hex"), size: bytes.length,
    publisher: config.publisher, appId: identity.appId, channel: identity.build.channel,
    engineVersion: identity.engine.version, contractVersion: identity.engine.contractVersion,
    protocolVersion: identity.engine.protocolVersion, draftFormat: 1 as const, ...change,
  };
  return { ...item, signature: sign(null, updateSigningPayload(item), privateKey).toString("base64") };
}

describe("desktop update verification", () => {
  it("accepts an artifact signed by the installed test publisher key", () => {
    expect(verifyUpdate(config, release(), bytes, trust).sha256).toHaveLength(64);
    expect(verifyUpdate(config, release({ engineVersion: "genoffice@reviewed-next" }), bytes, trust).engineVersion).toBe("genoffice@reviewed-next");
  });
  it.each([
    [{ url: "http://updates.example.test/installer.exe" }, "tls_failure"],
    [{ url: "https://other.test/installer.exe" }, "tls_failure"],
    [{ publisher: "Attacker" }, "wrong_publisher"],
    [{ appId: "com.other.app" }, "wrong_app_id"],
    [{ channel: "stable" as const }, "wrong_channel"],
    [{ engineVersion: "genoffice@older" }, "down_level_engine"],
    [{ engineVersion: "genoffice@unknown" }, "down_level_engine"],
    [{ contractVersion: "old-contract" }, "down_level_engine"],
    [{ protocolVersion: 2 }, "down_level_engine"],
    [{ sha256: "0".repeat(64) }, "hash_mismatch"],
  ])("refuses signed incompatible metadata %#", (change, code) => {
    expect(() => verifyUpdate(config, release(change), bytes, trust)).toThrowError(expect.objectContaining({ code }));
  });
  it("rejects an attacker self-signing with a different key", () => {
    const attacker = generateKeyPairSync("ed25519");
    expect(() => verifyUpdate(config, release({}, attacker.privateKey), bytes, trust)).toThrowError(expect.objectContaining({ code: "invalid_signature" }));
    expect(() => verifyUpdate(config, { ...release(), publicKey: attacker.publicKey.export({ format: "pem", type: "spki" }) }, bytes, trust)).toThrowError(expect.objectContaining({ code: "invalid_manifest" }));
  });
  it("binds the signature to metadata as well as bytes", () => {
    expect(() => verifyUpdate(config, { ...release(), engineVersion: "genoffice@reviewed-next" }, bytes, trust)).toThrowError(expect.objectContaining({ code: "invalid_signature" }));
    expect(() => verifyUpdate(config, release(), Buffer.from("tampered"), trust)).toThrowError(expect.objectContaining({ code: "hash_mismatch" }));
  });
  it.each(["", "!!!!", "YQ=="])("refuses malformed signatures %s", (signature) => {
    expect(() => verifyUpdate(config, { ...release(), signature }, bytes, trust)).toThrowError(expect.objectContaining({ code: "invalid_signature" }));
  });
  it("refuses missing trust and malformed feed configuration with typed reasons", () => {
    expect(() => verifyUpdate(config, release(), bytes)).toThrowError(expect.objectContaining({ code: "wrong_publisher" }));
    expect(() => verifyUpdate({ ...config, feed: "bad-url" }, release(), bytes, trust)).toThrowError(expect.objectContaining({ code: "tls_failure" }));
    expect(() => verifyUpdate(config, release(), bytes, { ...trust, engineVersions: [] })).toThrowError(expect.objectContaining({ code: "down_level_engine" }));
  });
  it("keeps unsigned automatic updates disabled by default", () => {
    expect(() => verifyUpdate(DEFAULT_UPDATE_CONFIG, release(), bytes, trust)).toThrowError(expect.objectContaining({ code: "auto_update_disabled" }));
  });
});
