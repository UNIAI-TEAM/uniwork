// Tests for draft-store.mjs. Node 22 built-ins only.
// Temp root: UNIWORK_G0_TMP when set, else os.tmpdir(). Point it inside the
// workspace before running if the host forbids writes outside it.

import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createDraftStore, DraftStoreError } from "./draft-store.mjs";

const TMP_ROOT = process.env.UNIWORK_G0_TMP || os.tmpdir();
const KEY_A = Buffer.alloc(32, 0xa1);
const KEY_B = Buffer.alloc(32, 0xb2);
const NS = Buffer.alloc(32, 0xc3);
const NS_OTHER = Buffer.alloc(32, 0x99);

/** External keyProvider: lives outside the store, as the host secret store would. */
const keyProviderFor = (keys) => (accountId) => {
  const key = keys[accountId];
  if (!key) throw new Error("unknown account " + accountId);
  return key;
};

const mkdir = () => fs.mkdtempSync(path.join(TMP_ROOT, "uw-draft-"));
const draftFiles = (dir) => fs.readdirSync(dir).filter((n) => n.endsWith(".draft")).sort();
const tempFiles = (dir) => fs.readdirSync(dir).filter((n) => n.endsWith(".tmp"));
const draftStore = (dir, keys, extra = {}) =>
  createDraftStore({ dir, keyProvider: keyProviderFor(keys), namespaceKey: NS, ...extra });
const withFsStub = (name, impl, body) => {
  const original = fs[name];
  fs[name] = impl;
  try {
    return body();
  } finally {
    fs[name] = original;
  }
};
const attempt = (fn) => {
  try {
    return { value: fn(), error: null };
  } catch (error) {
    return { value: undefined, error };
  }
};

test("memory mode works with dir=null, isolates nested rows, and creates nothing", () => {
  const store = createDraftStore({ dir: null, keyProvider: keyProviderFor({ "account-a": KEY_A }) });
  assert.equal(store.durable, false);
  assert.deepEqual(store.read("account-a"), []);

  const rows = [{ docId: "d1", payload: "nhap", assets: [{ id: "a1", meta: { size: 1 } }] }];
  const result = store.write("account-a", rows);
  assert.deepEqual(store.read("account-a"), rows);
  assert.equal(result.persisted, false, "memory mode reports an honest non-persistent result");
  assert.equal(result.atomicReplace, false);
  assert.equal(result.directorySync, null);
  assert.equal(result.powerLossGuarantee, false);

  // A caller mutating nested input or output must not reach what the store holds.
  rows[0].assets[0].meta.size = 999;
  rows[0].assets.push({ id: "rogue" });
  const first = store.read("account-a");
  first[0].assets[0].id = "mutated-by-caller";
  assert.deepEqual(store.read("account-a"), [{ docId: "d1", payload: "nhap", assets: [{ id: "a1", meta: { size: 1 } }] }]);
});

test("the guarantee getter describes the private byte layer honestly in both modes", () => {
  const memory = createDraftStore({ dir: null, keyProvider: keyProviderFor({ "account-a": KEY_A }) });
  const memoryGuarantee = memory.guarantee;
  assert.equal(memoryGuarantee.layer, "private-byte-layer");
  assert.equal(memoryGuarantee.authorizationOwner, "protocol-model");
  assert.equal(memoryGuarantee.mode, "memory");
  assert.equal(memoryGuarantee.atomicReplace, false, "memory mode has no filesystem replacement");
  assert.equal(memoryGuarantee.authenticatedEncryption, "none", "memory mode has no encryption");
  assert.equal(memoryGuarantee.powerLossGuarantee, false);
  assert.equal(memoryGuarantee.directorySync, "not_applicable");
  assert.equal(memoryGuarantee.removeAllRows, "an authenticated write of an empty array");

  const dir = mkdir();
  const durableGuarantee = draftStore(dir, { "account-a": KEY_A }).guarantee;
  assert.equal(durableGuarantee.mode, "directory");
  assert.equal(durableGuarantee.atomicReplace, true);
  assert.equal(durableGuarantee.authenticatedEncryption, "aes-256-gcm");
  assert.equal(durableGuarantee.ciphertextBoundToAccount, true);
  assert.equal(durableGuarantee.replacesOnlyAuthenticatedBytes, true);
  assert.equal(durableGuarantee.namespaceKeySeparateFromAccountKey, true);
  assert.equal(durableGuarantee.namespaceKeyStability, "stable-for-the-lifetime-of-persisted-drafts-across-restarts");
  assert.match(durableGuarantee.wrongNamespaceKey, /left intact/);
  assert.match(durableGuarantee.wrongNamespaceKey, /not recovered/);
  assert.equal(durableGuarantee.powerLossGuarantee, false);
  assert.equal(durableGuarantee.directorySync, "reported_per_write");
  assert.equal(durableGuarantee.writerLocking, "none-single-writer-per-directory");
});

test("a real restart reopens the same directory and returns the same rows", () => {
  const dir = mkdir();
  const keys = { "account-a": KEY_A };
  const rows = [{ docId: "d1", payload: "chua gui", baseRevision: 1, baseVersion: 2, state: "dirty", assets: [{ id: "a1" }] }];

  const first = draftStore(dir, keys);
  first.write("account-a", rows);

  // Fresh store, fresh read of the bytes on disk — this is the restart.
  const afterRestart = draftStore(dir, keys);
  assert.deepEqual(afterRestart.read("account-a"), rows);
  assert.equal(draftFiles(dir).length, 1);
});

test("no plaintext, no raw account id and no key material reach the disk", () => {
  const dir = mkdir();
  const secret = "BI-MAT-KHONG-DUOC-ROI-KHOI-DIA";
  const store = draftStore(dir, { "account-a": KEY_A });
  store.write("account-a", [{ docId: "d1", payload: secret }]);

  const [file] = draftFiles(dir);
  const raw = fs.readFileSync(path.join(dir, file)).toString("latin1");
  assert.equal(file.includes("account-a"), false, "file name leaks the account id");
  assert.equal(raw.includes(secret), false, "payload is on disk in plaintext");
  assert.equal(raw.includes("account-a"), false, "envelope leaks the account id");
  assert.equal(raw.includes(KEY_A.toString("latin1")), false, "account key material is on disk");
  assert.equal(raw.includes(NS.toString("latin1")), false, "namespace key material is on disk");
});

test("a wrong encryption key fails authentication instead of reporting no draft", () => {
  const dir = mkdir();
  draftStore(dir, { "account-a": KEY_A }).write("account-a", [{ docId: "d1", payload: "x" }]);

  // Same stable namespace key, so the file name is identical and the ciphertext
  // is found; the wrong account key must be refused, not read as "empty".
  const other = draftStore(dir, { "account-a": KEY_B });
  assert.throws(
    () => other.read("account-a"),
    (e) => e instanceof DraftStoreError && e.code === "draft_unreadable" && e.fields.reason === "authentication_failed",
  );
});

test("a read distinguishes an absent draft from an unreadable one", () => {
  const dir = mkdir();
  const store = draftStore(dir, { "account-a": KEY_A });
  assert.deepEqual(store.read("account-a"), [], "no file yet is an empty draft");

  store.write("account-a", [{ docId: "d1", payload: "v1" }]);
  for (const osCode of ["EACCES", "EPERM", "EIO", "EBUSY"]) {
    const failure = withFsStub(
      "readFileSync",
      () => {
        const error = new Error("stubbed readFileSync " + osCode);
        error.code = osCode;
        error.syscall = "read";
        throw error;
      },
      () => attempt(() => store.read("account-a")).error,
    );
    assert.ok(failure, osCode + " must not read as an empty draft");
    assert.equal(failure instanceof DraftStoreError, true);
    assert.equal(failure.code, "draft_unreadable");
    assert.equal(failure.fields.reason, "io");
    assert.equal(failure.fields.osCode, osCode);
  }

  // ENOENT really is "nothing was ever saved".
  const absent = withFsStub(
    "readFileSync",
    () => {
      const error = new Error("gone");
      error.code = "ENOENT";
      throw error;
    },
    () => store.read("account-a"),
  );
  assert.deepEqual(absent, [], "ENOENT is still an empty draft");
});

test("tampered bytes are refused, not silently returned", () => {
  const dir = mkdir();
  const store = draftStore(dir, { "account-a": KEY_A });
  store.write("account-a", [{ docId: "d1", payload: "nguyen ban" }]);

  const file = path.join(dir, draftFiles(dir)[0]);
  const bytes = fs.readFileSync(file);
  bytes[bytes.length - 1] ^= 0xff;
  fs.writeFileSync(file, bytes);

  assert.throws(() => store.read("account-a"), (e) => e.code === "draft_unreadable");
});

test("a copied ciphertext does not decrypt, even when both accounts share the key", () => {
  const dir = mkdir();
  const keys = { "account-a": KEY_A, "account-b": KEY_A }; // same key on purpose
  const store = draftStore(dir, keys);

  store.write("account-a", [{ docId: "d1", payload: "A-secret" }]);
  const afterA = draftFiles(dir);
  store.write("account-b", [{ docId: "d2", payload: "B-own" }]);
  const bFile = draftFiles(dir).find((n) => !afterA.includes(n));
  assert.ok(bFile, "B must have its own file");

  // Copy A's ciphertext onto B's name: the AAD binds it to account a.
  fs.copyFileSync(path.join(dir, afterA[0]), path.join(dir, bFile));

  assert.throws(
    () => store.read("account-b"),
    (e) => e.code === "draft_unreadable" && e.fields.reason === "authentication_failed",
    "a swapped ciphertext must fail authentication, not be returned",
  );
  assert.deepEqual(store.read("account-a"), [{ docId: "d1", payload: "A-secret" }]);
});

test("nested rows are deep-cloned so aliases cannot mutate the stored draft", () => {
  const dir = mkdir();
  const keys = { "account-a": KEY_A };
  const store = draftStore(dir, keys);
  const rows = [{ docId: "d1", assets: [{ id: "a1", meta: { bytes: 12 } }] }];
  store.write("account-a", rows);

  rows[0].assets[0].meta.bytes = 0; // caller keeps the input and edits it
  rows[0].assets.push({ id: "rogue" });
  const readOnce = store.read("account-a");
  readOnce[0].assets[0].id = "mutated-after-read";

  const onDisk = draftStore(dir, keys).read("account-a");
  assert.deepEqual(onDisk, [{ docId: "d1", assets: [{ id: "a1", meta: { bytes: 12 } }] }]);
  assert.notEqual(store.read("account-a")[0], store.read("account-a")[0], "reads must not share an object");
});

test("rows JSON cannot round-trip are refused by name", () => {
  const store = createDraftStore({ dir: null, keyProvider: keyProviderFor({ "account-a": KEY_A }) });
  assert.throws(() => store.write("account-a", "not-an-array"), (e) => e.code === "bad_rows");
  assert.throws(() => store.write("account-a", [undefined]), (e) => e.code === "bad_rows");
  assert.throws(() => store.write("account-a", [() => {}]), (e) => e.code === "bad_rows");
  assert.throws(() => store.write("account-a", [BigInt(1)]), (e) => e.code === "bad_rows");
  assert.throws(() => store.write("account-a", [Number.NaN]), (e) => e.code === "bad_rows");
  assert.throws(() => store.write("account-a", [new Date()]), (e) => e.code === "bad_rows");

  const cyclic = [{ docId: "d1" }];
  cyclic[0].self = cyclic[0];
  assert.throws(() => store.write("account-a", cyclic), (e) => e.code === "bad_rows" && e.fields.reason === "cyclic");
});

test("a bad key provider and a missing namespace key are refused by name", () => {
  const dir = mkdir();
  const shortKey = createDraftStore({ dir, keyProvider: () => Buffer.alloc(16), namespaceKey: NS });
  assert.throws(() => shortKey.write("account-a", []), (e) => e.code === "key_provider_invalid");

  // A durable store without a stable namespace key cannot derive names that
  // survive a wrong key, so it refuses to exist at all.
  assert.throws(() => createDraftStore({ dir, keyProvider: keyProviderFor({ "account-a": KEY_A }) }), (e) => {
    assert.equal(e.code, "namespace_key_invalid");
    assert.equal(e instanceof DraftStoreError, true);
    return true;
  });
  assert.throws(
    () => createDraftStore({ dir, keyProvider: keyProviderFor({ "account-a": KEY_A }), namespaceKey: Buffer.alloc(16) }),
    (e) => e.code === "namespace_key_invalid",
  );
});

test("a non-absolute or empty dir is refused before any filesystem IO", () => {
  for (const bad of ["", false, 0, "relative-drafts"]) {
    assert.throws(
      () => createDraftStore({ dir: bad, keyProvider: keyProviderFor({ "account-a": KEY_A }), namespaceKey: NS }),
      (e) => e instanceof DraftStoreError && e.code === "bad_dir",
      "dir " + JSON.stringify(bad) + " must be refused",
    );
  }
  // null/undefined is the memory store, not a directory.
  assert.equal(createDraftStore({ dir: null, keyProvider: keyProviderFor({ "account-a": KEY_A }) }).durable, false);
  assert.equal(createDraftStore({ dir: undefined, keyProvider: keyProviderFor({ "account-a": KEY_A }) }).durable, false);
});

test("an interrupted replace keeps the previous good file and leaves no staging file", () => {
  const dir = mkdir();
  let failNext = false;
  const store = draftStore(
    dir,
    { "account-a": KEY_A },
    {
      beforeReplace: () => {
        if (failNext) throw new Error("interrupted before rename");
      },
    },
  );

  store.write("account-a", [{ docId: "d1", payload: "v1" }]);
  const before = draftFiles(dir);
  failNext = true;
  assert.throws(() => store.write("account-a", [{ docId: "d1", payload: "v2" }]), /interrupted before rename/);

  assert.deepEqual(store.read("account-a"), [{ docId: "d1", payload: "v1" }]);
  assert.equal(tempFiles(dir).length, 0, "staging file was left behind");
  assert.deepEqual(draftFiles(dir), before, "the account still has exactly its previous file");
});

test("write, fsync, close and rename failures clean up and classify, keeping the old draft", () => {
  const dir = mkdir();
  const keys = { "account-a": KEY_A };
  const seed = draftStore(dir, keys);
  seed.write("account-a", [{ docId: "d1", payload: "v1" }]);
  const before = draftFiles(dir);

  const cases = [
    { member: "writeFileSync", code: "write_failed", osCode: "EIO" },
    { member: "fsyncSync", code: "write_failed", osCode: "EIO" },
    { member: "renameSync", code: "replace_failed", osCode: "EXDEV" },
  ];
  for (const kase of cases) {
    const store = draftStore(dir, keys);
    const failure = withFsStub(
      kase.member,
      () => {
        const error = new Error("stubbed " + kase.member);
        error.code = kase.osCode;
        error.syscall = kase.member;
        throw error;
      },
      () => attempt(() => store.write("account-a", [{ docId: "d1", payload: "v2-" + kase.member }])).error,
    );
    assert.ok(failure, kase.member + " must surface as an error");
    assert.equal(failure instanceof DraftStoreError, true, kase.member + " must be classified");
    assert.equal(failure.code, kase.code, kase.member + " code");
    assert.equal(failure.fields.phase !== undefined, true);
    assert.equal(failure.fields.staging.tempRemoved, true, kase.member + " must remove its staging file");
    assert.equal(failure.fields.previousPreserved, true);
    assert.equal(tempFiles(dir).length, 0, kase.member + " left a staging file");
    assert.deepEqual(draftFiles(dir), before, kase.member + " changed the account file set");
    assert.deepEqual(seed.read("account-a"), [{ docId: "d1", payload: "v1" }], kase.member + " lost the old draft");
  }

  // A close failure is classified too; the descriptor is already released on
  // Windows by the time the stub throws, so no staging file survives.
  const closeStore = draftStore(dir, keys);
  const realClose = fs.closeSync;
  let closeCalls = 0;
  const closeFailure = withFsStub(
    "closeSync",
    (fd) => {
      closeCalls += 1;
      if (closeCalls > 1) return realClose(fd); // let cleanup finish
      const error = new Error("stubbed closeSync");
      error.code = "EIO";
      throw error;
    },
    () => attempt(() => closeStore.write("account-a", [{ docId: "d1", payload: "v3" }])).error,
  );
  assert.ok(closeFailure, "a close failure must surface");
  assert.equal(closeFailure.code, "close_failed");
  assert.equal(closeFailure.fields.phase, "close");
  assert.equal(tempFiles(dir).length, 0, "close failure left a staging file");
  assert.deepEqual(seed.read("account-a"), [{ docId: "d1", payload: "v1" }]);
});

test("a write refuses to replace a draft it cannot authenticate and preserves the bytes", () => {
  const dir = mkdir();
  draftStore(dir, { "account-a": KEY_A }).write("account-a", [{ docId: "d1", payload: "v1" }]);
  const file = path.join(dir, draftFiles(dir)[0]);
  const bytesBefore = fs.readFileSync(file);

  // Wrong key: the file is found, authentication fails, the write is refused.
  const rotated = draftStore(dir, { "account-a": KEY_B });
  assert.throws(() => rotated.read("account-a"), (e) => e.code === "draft_unreadable");
  assert.throws(
    () => rotated.write("account-a", [{ docId: "d1", payload: "v2" }]),
    (e) => e.code === "existing_unreadable",
    "rotation must not be a destructive replacement",
  );
  assert.deepEqual(fs.readFileSync(file), bytesBefore, "the existing ciphertext must be byte-for-byte preserved");
  assert.equal(tempFiles(dir).length, 0, "the refused write must not leave a staging file");
  assert.deepEqual(draftFiles(dir), [path.basename(file)], "no second file appeared");

  // The original key still reads the original rows: rotation did not lose data.
  assert.deepEqual(draftStore(dir, { "account-a": KEY_A }).read("account-a"), [{ docId: "d1", payload: "v1" }]);
});

test("a tampered draft cannot be replaced; the tampered bytes stay for recovery", () => {
  const dir = mkdir();
  const store = draftStore(dir, { "account-a": KEY_A });
  store.write("account-a", [{ docId: "d1", payload: "v1" }]);
  const file = path.join(dir, draftFiles(dir)[0]);
  const bytes = fs.readFileSync(file);
  bytes[bytes.length - 1] ^= 0xff;
  fs.writeFileSync(file, bytes);
  const tampered = fs.readFileSync(file);

  assert.throws(() => store.write("account-a", [{ docId: "d1", payload: "v2" }]), (e) => e.code === "existing_unreadable");
  assert.deepEqual(fs.readFileSync(file), tampered, "tampered bytes must be preserved for recovery");
});

test("an IO failure while checking the existing draft refuses the write and preserves it", () => {
  const dir = mkdir();
  const keys = { "account-a": KEY_A };
  const seed = draftStore(dir, keys);
  seed.write("account-a", [{ docId: "d1", payload: "v1" }]);
  const file = path.join(dir, draftFiles(dir)[0]);
  const bytesBefore = fs.readFileSync(file);

  const store = draftStore(dir, keys);
  const failure = withFsStub(
    "readFileSync",
    () => {
      const error = new Error("stubbed readFileSync");
      error.code = "EIO";
      error.syscall = "read";
      throw error;
    },
    () => attempt(() => store.write("account-a", [{ docId: "d1", payload: "v2" }])).error,
  );
  assert.ok(failure, "an unreadable existing draft must refuse the write");
  assert.equal(failure.code, "existing_unreadable");
  assert.equal(failure.fields.reason, "io");
  assert.deepEqual(fs.readFileSync(file), bytesBefore);
  assert.equal(tempFiles(dir).length, 0);
});

test("an authenticated empty write removes all rows; an unauthenticated one cannot", () => {
  const dir = mkdir();
  draftStore(dir, { "account-a": KEY_A }).write("account-a", [{ docId: "d1", payload: "v1" }]);
  const file = path.join(dir, draftFiles(dir)[0]);
  const bytesBefore = fs.readFileSync(file);

  // No general bypass: a draft this key cannot open must survive an empty write.
  const wrong = draftStore(dir, { "account-a": KEY_B });
  assert.throws(() => wrong.write("account-a", []), (e) => e.code === "existing_unreadable");
  assert.deepEqual(fs.readFileSync(file), bytesBefore, "an inaccessible draft cannot be erased");

  // The private layer represents removal as an authenticated empty write.
  const store = draftStore(dir, { "account-a": KEY_A });
  store.write("account-a", []);
  assert.deepEqual(store.read("account-a"), []);
});

test("write reports whether it replaced existing bytes or created the first file", () => {
  const dir = mkdir();
  const store = draftStore(dir, { "account-a": KEY_A });
  assert.equal(store.write("account-a", [{ docId: "d1", payload: "v1" }]).replacedExisting, false);
  assert.equal(store.write("account-a", [{ docId: "d1", payload: "v2" }]).replacedExisting, true);
  assert.deepEqual(store.read("account-a"), [{ docId: "d1", payload: "v2" }]);
});

test("a zeroed key from the provider fails authentication instead of using a cached key", () => {
  const dir = mkdir();
  let current = Buffer.from(KEY_A);
  const provider = (accountId) => {
    if (accountId !== "account-a") throw new Error("unknown account " + accountId);
    return current;
  };
  const store = createDraftStore({ dir, keyProvider: provider, namespaceKey: NS });
  store.write("account-a", [{ docId: "d1", payload: "v1" }]);
  const file = path.join(dir, draftFiles(dir)[0]);
  const bytesBefore = fs.readFileSync(file);

  // The provider now hands back zeroed material. The store must call it per
  // operation and must NOT have cached KEY_A, so this is a real auth failure.
  current = Buffer.alloc(32, 0);
  assert.throws(
    () => store.read("account-a"),
    (e) => e.code === "draft_unreadable" && e.fields.reason === "authentication_failed",
  );
  assert.throws(() => store.write("account-a", [{ docId: "d1", payload: "v2" }]), (e) => e.code === "existing_unreadable");
  assert.deepEqual(fs.readFileSync(file), bytesBefore, "a zeroed key cannot overwrite the old bytes");
});

test("namespaceKey must stay stable: a different one does not find the draft but keeps it", () => {
  const dir = mkdir();
  draftStore(dir, { "account-a": KEY_A }).write("account-a", [{ docId: "d1", payload: "v1" }]);
  const file = path.join(dir, draftFiles(dir)[0]);
  const bytesBefore = fs.readFileSync(file);

  const otherNamespace = createDraftStore({
    dir,
    keyProvider: keyProviderFor({ "account-a": KEY_A }),
    namespaceKey: NS_OTHER,
  });
  assert.deepEqual(otherNamespace.read("account-a"), [], "a different namespace looks up a different name");
  assert.deepEqual(fs.readFileSync(file), bytesBefore, "the original ciphertext is left intact, not rewritten");
  assert.deepEqual(draftFiles(dir), [path.basename(file)], "no new file was created");
  // No recovery claim is made for a changed namespace: the host owns that secret.
  assert.match(otherNamespace.guarantee.wrongNamespaceKey, /not recovered/);
});

test("directory sync reports unsupported instead of guaranteeing power-loss durability", () => {
  const dir = mkdir();
  const store = draftStore(dir, { "account-a": KEY_A });
  const result = store.write("account-a", [{ docId: "d1", payload: "v1" }]);

  assert.equal(result.persisted, true);
  assert.equal(result.atomicReplace, true);
  assert.equal(result.directorySync.attempted, true);
  if (process.platform === "win32") {
    assert.equal(result.directorySync.supported, false, "Windows cannot fsync a directory");
    assert.equal(result.directorySync.reason, "unsupported");
  }
  // The honest contract: a directory-entry fsync is reported, and even a
  // successful one is NOT claimed as a power-loss guarantee.
  assert.equal(result.powerLossGuarantee, false);
  assert.equal(typeof result.syncLimitations, "string");
  assert.equal(typeof result.cleanupLimitations, "string");
});

test("a real directory sync failure is reported as an error, not as unsupported", () => {
  const dir = mkdir();
  const store = draftStore(dir, { "account-a": KEY_A });
  const realFsync = fs.fsyncSync;
  let calls = 0;
  const result = withFsStub(
    "fsyncSync",
    (fd) => {
      calls += 1;
      if (calls >= 2) {
        // The second fsync is the directory entry; EIO is a fault, not a
        // Windows "cannot fsync a directory" limitation.
        const error = new Error("stubbed directory fsync");
        error.code = "EIO";
        error.syscall = "fsync";
        throw error;
      }
      return realFsync(fd);
    },
    () => store.write("account-a", [{ docId: "d1", payload: "v1" }]),
  );

  assert.equal(result.persisted, true, "the replacement already happened; the write still reports it");
  assert.equal(result.directorySync.attempted, true);
  assert.equal(result.directorySync.synced, false);
  assert.equal(result.directorySync.supported, false);
  assert.equal(result.directorySync.reason, "error", "EIO must be reported as an error, not unsupported");
  assert.equal(result.directorySync.osCode, "EIO");
  assert.equal(result.powerLossGuarantee, false);
  assert.deepEqual(store.read("account-a"), [{ docId: "d1", payload: "v1" }]);
});

test("a directory close failure is reported instead of silently swallowed", () => {
  const dir = mkdir();
  const store = draftStore(dir, { "account-a": KEY_A });
  const realClose = fs.closeSync;
  let calls = 0;
  const result = withFsStub(
    "closeSync",
    (fd) => {
      calls += 1;
      if (calls >= 2) {
        // First close is the staging descriptor; the second is the directory.
        const error = new Error("stubbed directory close");
        error.code = "EIO";
        throw error;
      }
      return realClose(fd);
    },
    () => store.write("account-a", [{ docId: "d1", payload: "v1" }]),
  );

  assert.equal(result.persisted, true);
  assert.ok(result.directorySync.closeError, "the directory close failure must be reported");
  assert.equal(result.directorySync.closeError.osCode, "EIO");
  assert.deepEqual(store.read("account-a"), [{ docId: "d1", payload: "v1" }]);
});

test("a successful replace rotates the nonce and keeps exactly one file per account", () => {
  const dir = mkdir();
  const store = draftStore(dir, { "account-a": KEY_A });

  store.write("account-a", [{ docId: "d1", payload: "same" }]);
  const firstBytes = fs.readFileSync(path.join(dir, draftFiles(dir)[0]));
  store.write("account-a", [{ docId: "d1", payload: "same" }]);
  const secondBytes = fs.readFileSync(path.join(dir, draftFiles(dir)[0]));

  assert.deepEqual(store.read("account-a"), [{ docId: "d1", payload: "same" }]);
  assert.notEqual(firstBytes.toString("hex"), secondBytes.toString("hex"), "nonce was reused");
  assert.equal(draftFiles(dir).length, 1, "an account keeps exactly one file");
});
