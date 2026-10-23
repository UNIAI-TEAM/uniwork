// test-draft-store.mjs — TEST-ONLY deterministic draft store for the DOC-005
// harness (UNI-669). Node 22 built-ins only. This is NOT the product store, and
// no artifact built on this harness may present its properties as product proof.
//
// It exists to satisfy one seam and then be replaced:
//
//   createDraftStore({ dir, keyProvider, namespaceKey })
//     .read(accountId)         -> array of rows ([] when nothing was ever saved)
//     .write(accountId, rows)  -> void; durable before it returns
//
// The real store is a separate deliverable. Here the point is narrower: the
// harness must be able to (a) restart against the same directory with keys the
// TEST supplies externally, and (b) prove the model's draft APIs never hand a
// payload to an account that should not see it. So this fixture is deterministic
// (a fixed algorithm, no clock and no randomness in names), AES-256-GCM seals the
// bytes so no payload is plaintext, and both keys come from the caller, which is
// what lets a restart prove the keys live outside the store.
//
// What it deliberately does NOT do: claim power-loss durability, claim to be the
// product store, or hold the model's ACL. The model owns ACL and sessions; this
// owns bytes only.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const MAGIC = Buffer.from("UWGF", "ascii"); // "UniWork G0 Fixture"
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const AAD = "uniwork.office.g0.fixture.draft.v1";

export class TestStoreError extends Error {
  constructor(code, fields = {}) {
    super(code);
    this.name = "TestStoreError";
    this.code = code;
    this.fields = fields;
  }
}

/**
 * @param {object} opts
 * @param {string|null} opts.dir            persistence dir; null = memory only
 * @param {(accountId: string) => Buffer} opts.keyProvider  32-byte per-account key
 * @param {Buffer|null} opts.namespaceKey  32-byte stable key for opaque file names
 */
export function createTestDraftStore({ dir = null, keyProvider, namespaceKey = null } = {}) {
  if (typeof keyProvider !== "function") throw new TypeError("keyProvider must be a function");
  const durable = typeof dir === "string" && dir.length > 0;
  if (durable && (!Buffer.isBuffer(namespaceKey) || namespaceKey.length !== 32)) {
    throw new TypeError("namespaceKey must be a 32-byte Buffer for a persistent store");
  }
  const memory = new Map();

  const accountKey = (accountId) => {
    const key = keyProvider(accountId);
    if (!Buffer.isBuffer(key) || key.length !== 32) {
      throw new TestStoreError("key_provider_invalid", { got: Buffer.isBuffer(key) ? key.length : typeof key });
    }
    return key;
  };
  // Opaque name: derived from the namespace key, so the directory is not a list of
  // account ids. Deliberately SEPARATE from the encryption key, so a wrong
  // encryption key still finds the existing file and fails loudly instead of
  // looking up a name that does not exist and returning [].
  const fileFor = (accountId) =>
    path.join(dir, crypto.createHmac("sha256", namespaceKey).update("name\u0000" + accountId).digest("hex") + ".draft");
  const aadFor = (accountId) =>
    Buffer.concat([Buffer.from(AAD, "utf8"), Buffer.from([0]), Buffer.from(accountId, "utf8")]);

  function seal(accountId, key, rows) {
    const nonce = crypto.randomBytes(NONCE_BYTES);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, nonce);
    cipher.setAAD(aadFor(accountId));
    const body = Buffer.concat([cipher.update(JSON.stringify(rows), "utf8"), cipher.final()]);
    return Buffer.concat([MAGIC, nonce, cipher.getAuthTag(), body]);
  }

  function open(accountId, key, envelope) {
    const head = MAGIC.length + NONCE_BYTES + TAG_BYTES;
    if (envelope.length < head) throw new TestStoreError("draft_unreadable", { reason: "short" });
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      key,
      envelope.subarray(MAGIC.length, MAGIC.length + NONCE_BYTES),
    );
    decipher.setAAD(aadFor(accountId));
    decipher.setAuthTag(envelope.subarray(MAGIC.length + NONCE_BYTES, head));
    try {
      const rows = JSON.parse(
        Buffer.concat([decipher.update(envelope.subarray(head)), decipher.final()]).toString("utf8"),
      );
      if (!Array.isArray(rows)) throw new TestStoreError("draft_unreadable", { reason: "shape" });
      return rows;
    } catch (error) {
      if (error instanceof TestStoreError) throw error;
      // Wrong key, tampered bytes, or another account's ciphertext all land here.
      throw new TestStoreError("draft_unreadable", { reason: "authentication_failed" });
    }
  }

  return {
    durable,
    read(accountId) {
      if (!durable) return (memory.get(accountId) ?? []).map((row) => structuredClone(row));
      const key = accountKey(accountId);
      const file = fileFor(accountId);
      if (!fs.existsSync(file)) return [];
      return open(accountId, key, fs.readFileSync(file));
    },
    write(accountId, rows) {
      if (!Array.isArray(rows)) throw new TestStoreError("bad_rows", { got: typeof rows });
      if (!durable) {
        memory.set(accountId, rows.map((row) => structuredClone(row)));
        return;
      }
      const key = accountKey(accountId);
      fs.mkdirSync(dir, { recursive: true });
      const file = fileFor(accountId);
      const temp = file + "." + process.pid + ".tmp";
      const fd = fs.openSync(temp, "wx", 0o600);
      try {
        fs.writeFileSync(fd, seal(accountId, key, rows));
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      fs.renameSync(temp, file);
    },
  };
}
