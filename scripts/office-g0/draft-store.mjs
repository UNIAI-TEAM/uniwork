// draft-store.mjs — DOC-005 (UNI-669) durable Office draft store.
// Node 22 built-ins only. No product imports.
//
//   const store = createDraftStore({ dir, keyProvider, namespaceKey, beforeReplace });
//   store.read(accountId)        -> array ([] only when nothing was ever saved)
//   store.write(accountId, rows) -> persistence result; bytes are replaced before it returns
//
// This is the PRIVATE BYTE LAYER of the office draft feature, nothing more. It
// seals opaque rows under an account key and replaces them atomically. It does
// NOT decide who may read or discard a draft: account identity, ACLs and the
// discard/confirmed-commit decision belong to the protocol model that calls it.
// In particular write(accountId, []) means "this account now has no rows", which
// the protocol layer may only do once it has authorized an explicit discard.
//
// Two independent secrets, deliberately not derived from each other:
//   * namespaceKey - a 32-byte HOST secret used ONLY to derive an account's
//     opaque file name. It must remain the same for as long as any draft file on
//     disk is expected to be found, across process restarts, not merely for the
//     lifetime of one process. A different namespace key maps to a different
//     name, so the original ciphertext is simply not looked up: it is left intact
//     but is NOT recovered here - keeping the host secret stable is the host's
//     obligation, not something this store can rediscover.
//   * keyProvider(accountId) - the per-account AES-256-GCM key, used ONLY to seal
//     and open the rows. It is read fresh on every operation.
// Neither secret is written anywhere, and no file name or envelope contains either.
//
// Properties this file exists to guarantee:
//   1. No plaintext on disk. Rows are sealed with AES-256-GCM under the account
//      key; that key is never written.
//   2. No raw account id on disk. A file is <opaque>.draft, named by an HMAC of
//      the account id under a subkey of the namespace key.
//   3. The ciphertext is bound to its account through the GCM AAD, so copying one
//      account's file onto another account's name does not decrypt - even when
//      both accounts happen to share an encryption key.
//   4. A write replaces only bytes it can authenticate. Immediately before the
//      final rename it opens the existing file with the CURRENT account key; if
//      that fails (authentication, shape or I/O) the write is refused, the
//      previous ciphertext is left byte-for-byte untouched, and a named error is
//      raised. Only a first write (no file yet) or a write over an authenticated
//      file reaches the rename. There is no bypass flag: an inaccessible draft
//      cannot be replaced, not even with an empty array.
//   5. A write is atomic: a unique same-directory temp file is written, fsynced,
//      closed and renamed over the target. A failure at any step removes the
//      staging file, classifies the operational error, and leaves the previous
//      good file in place.
//   6. Rows are validated and deep-cloned on the way in and out, so a caller's
//      nested objects cannot alias what the store holds, and a value JSON cannot
//      round-trip is refused by name instead of silently corrupted.
//   7. A read distinguishes "nothing was ever saved" (ENOENT -> []) from "the file
//      is there but cannot be read" (a named DraftStoreError). It never turns a
//      permission, lock or I/O failure into an empty draft.
//   8. Directory-entry durability is REPORTED, never assumed. A directory fsync is
//      unsupported on Windows (EPERM/EACCES); that is reported as "unsupported".
//      Any other failure, including a POSIX permission or I/O error, is reported
//      as "error". Either way the replacement already happened, no exception is
//      thrown after a successful rename, and no path claims a power-loss
//      guarantee. A directory-descriptor close failure is reported too.
//
// Single-writer by contract: this store takes no inter-process lock. One process,
// or one serialized writer per directory, is the caller's responsibility.
//
// The store is private to the caller's model: there is deliberately no export
// that decodes arbitrary bytes, so a caller cannot route around the account key.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const MAGIC = Buffer.from("UWD1", "ascii");
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;
const FILE_SUFFIX = ".draft";
const AAD_PREFIX = "uniwork.office.draft.v1";
const NAME_LABEL = "uniwork.office.draft.name.v1";
const MAX_DEPTH = 64;

/**
 * Codes with which Windows refuses to sync a directory handle. They are a
 * platform limitation, not a fault, and are only read as "unsupported" on
 * win32. On POSIX the same codes are real permission/IO failures.
 */
const WINDOWS_DIRECTORY_SYNC_UNSUPPORTED = new Set([
  "EPERM",
  "EACCES",
  "EISDIR",
  "EINVAL",
  "ENOTSUP",
  "EOPNOTSUPP",
  "ENOSYS",
  "EBADF",
]);

/** Every failure the store reports is a named code, never a bare Error. */
export class DraftStoreError extends Error {
  constructor(code, fields = {}, options = undefined) {
    super(code, options);
    this.name = "DraftStoreError";
    this.code = code;
    this.fields = fields;
  }
}

const describeKey = (value) => {
  if (value === null || value === undefined) return "absent";
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return value.length;
  return typeof value;
};

/**
 * Snapshot key material into a private Buffer on every call, so a host that
 * reuses or zeroes the buffer it handed us cannot affect a later operation, and
 * so one operation's key bytes cannot be mutated from outside while in use.
 */
const asKeyBytes = (value) => {
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return Buffer.from(value);
  return null;
};

function isPlainObject(value) {
  if (value === null || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Deep-clone a JSON-safe value, refusing anything JSON cannot round-trip.
 * The clone never shares an object with the caller, so nested rows cannot alias
 * what the store holds in memory or what was sealed to disk.
 */
function cloneJsonSafe(value, pathLabel, depth, stack) {
  if (depth > MAX_DEPTH) throw new DraftStoreError("bad_rows", { reason: "too_deep", path: pathLabel });
  if (value === null) return null;
  const type = typeof value;
  if (type === "string" || type === "boolean") return value;
  if (type === "number") {
    if (!Number.isFinite(value)) {
      throw new DraftStoreError("bad_rows", { reason: "not_json_safe", path: pathLabel, got: String(value) });
    }
    return Object.is(value, -0) ? 0 : value;
  }
  if (type !== "object") {
    // undefined, function, symbol, bigint: JSON would drop or mangle these.
    throw new DraftStoreError("bad_rows", { reason: "not_json_safe", path: pathLabel, got: type });
  }
  if (stack.has(value)) throw new DraftStoreError("bad_rows", { reason: "cyclic", path: pathLabel });
  stack.add(value);
  try {
    if (Array.isArray(value)) {
      const out = [];
      for (let i = 0; i < value.length; i += 1) {
        out.push(i in value ? cloneJsonSafe(value[i], pathLabel + "[" + i + "]", depth + 1, stack) : null);
      }
      return out;
    }
    if (!isPlainObject(value)) {
      throw new DraftStoreError("bad_rows", {
        reason: "not_json_safe",
        path: pathLabel,
        got: (value.constructor && value.constructor.name) || "object",
      });
    }
    const out = {};
    for (const key of Object.keys(value)) {
      const cloned = cloneJsonSafe(value[key], pathLabel + "." + key, depth + 1, stack);
      // defineProperty keeps a literal "__proto__" key as data, never the prototype.
      Object.defineProperty(out, key, { value: cloned, enumerable: true, writable: true, configurable: true });
    }
    return out;
  } finally {
    stack.delete(value);
  }
}

const cloneRows = (rows) => cloneJsonSafe(rows, "$rows", 0, new Set());

const assertAccountId = (accountId) => {
  if (typeof accountId !== "string" || accountId.length === 0) {
    throw new DraftStoreError("bad_account_id", { got: typeof accountId });
  }
};

/**
 * @param {object} opts
 * @param {string|null} opts.dir        absolute persistence directory; null/undefined = memory only
 * @param {(accountId: string) => Buffer|Uint8Array} opts.keyProvider
 *        32-byte per-account encryption key, read on every operation. Injected so
 *        the key lives in the host's secret store, never next to the data.
 * @param {Buffer|Uint8Array|null} opts.namespaceKey
 *        Stable 32-byte host secret used ONLY for opaque file names. Required when
 *        a directory is given; independent of every account key so key rotation
 *        never renames a file. Must stay the same across restarts for as long as
 *        the drafts must be found. Never persisted.
 * @param {((info: object) => void)|null} opts.beforeReplace
 *        Fault hook called after the staging file is durable and before the
 *        existing-bytes check and the rename. Throwing here models an
 *        interrupted replacement.
 */
export function createDraftStore({ dir = null, keyProvider, namespaceKey = null, beforeReplace = null } = {}) {
  if (typeof keyProvider !== "function") throw new TypeError("keyProvider must be a function");
  if (beforeReplace !== null && typeof beforeReplace !== "function") {
    throw new TypeError("beforeReplace must be a function or null");
  }
  const memoryOnly = dir === null || dir === undefined;
  if (!memoryOnly && (typeof dir !== "string" || dir.length === 0 || !path.isAbsolute(dir))) {
    // Refuse before any filesystem IO, so a falsy or relative dir can never
    // cause a cwd-relative draft write.
    throw new DraftStoreError("bad_dir", {
      got: typeof dir === "string" ? (dir.length === 0 ? "empty string" : "relative path") : typeof dir,
      required: "an absolute, non-empty directory path, or null/undefined for the memory-only store",
    });
  }
  const durable = !memoryOnly;
  const memory = new Map();

  let nameKey = null;
  if (durable) {
    const namespace = asKeyBytes(namespaceKey);
    if (namespace === null || namespace.length !== KEY_BYTES) {
      throw new DraftStoreError("namespace_key_invalid", {
        got: describeKey(namespaceKey),
        required: "a stable 32-byte Buffer/Uint8Array, independent of the account encryption key",
      });
    }
    nameKey = crypto.createHmac("sha256", namespace).update(NAME_LABEL).digest();
  }

  function accountKey(accountId) {
    const raw = keyProvider(accountId);
    const key = asKeyBytes(raw);
    if (key === null || key.length !== KEY_BYTES) {
      throw new DraftStoreError("key_provider_invalid", { got: describeKey(raw) });
    }
    return key;
  }

  const aadFor = (accountId) =>
    Buffer.concat([Buffer.from(AAD_PREFIX, "utf8"), Buffer.from([0]), Buffer.from(accountId, "utf8")]);

  // File names depend on the namespace key and the account id only - never on the
  // encryption key, so a rotated key still resolves to the same existing file and
  // a wrong key meets its own ciphertext instead of a missing name.
  const fileFor = (accountId) =>
    path.join(dir, crypto.createHmac("sha256", nameKey).update(accountId, "utf8").digest("hex") + FILE_SUFFIX);

  function seal(accountId, key, rows) {
    const json = JSON.stringify(cloneRows(rows));
    const nonce = crypto.randomBytes(NONCE_BYTES); // fresh nonce on every write
    const cipher = crypto.createCipheriv("aes-256-gcm", key, nonce);
    cipher.setAAD(aadFor(accountId));
    const body = Buffer.concat([cipher.update(json, "utf8"), cipher.final()]);
    return Buffer.concat([MAGIC, nonce, cipher.getAuthTag(), body]);
  }

  function openEnvelope(accountId, key, envelope) {
    const head = MAGIC.length + NONCE_BYTES + TAG_BYTES;
    if (envelope.length < head) throw new DraftStoreError("draft_unreadable", { reason: "short_envelope" });
    if (!envelope.subarray(0, MAGIC.length).equals(MAGIC)) {
      throw new DraftStoreError("draft_unreadable", { reason: "bad_magic" });
    }
    const nonce = envelope.subarray(MAGIC.length, MAGIC.length + NONCE_BYTES);
    const tag = envelope.subarray(MAGIC.length + NONCE_BYTES, head);
    const body = envelope.subarray(head);
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, nonce);
    decipher.setAAD(aadFor(accountId));
    decipher.setAuthTag(tag);
    let plain;
    try {
      plain = Buffer.concat([decipher.update(body), decipher.final()]);
    } catch {
      // Wrong key, tampered bytes, or another account's ciphertext all land here.
      throw new DraftStoreError("draft_unreadable", { reason: "authentication_failed" });
    }
    let rows;
    try {
      rows = JSON.parse(plain.toString("utf8"));
    } catch {
      throw new DraftStoreError("draft_unreadable", { reason: "bad_payload" });
    }
    if (!Array.isArray(rows)) throw new DraftStoreError("draft_unreadable", { reason: "bad_shape" });
    return cloneRows(rows);
  }

  function classify(error, phase) {
    if (error instanceof DraftStoreError) return error;
    const codeByPhase = {
      mkdir: "staging_failed",
      open: "staging_failed",
      write: "write_failed",
      fsync: "write_failed",
      close: "close_failed",
      verify_existing: "existing_unreadable",
      rename: "replace_failed",
    };
    return new DraftStoreError(
      codeByPhase[phase] || "persist_failed",
      {
        phase,
        osCode: (error && error.code) || null,
        errno: typeof error?.errno === "number" ? error.errno : null,
        syscall: (error && error.syscall) || null,
        reason: (error && error.message) || String(error),
      },
      { cause: error },
    );
  }

  function removeStaging(temp) {
    try {
      fs.unlinkSync(temp);
      return { tempRemoved: true, error: null };
    } catch (error) {
      if (error && error.code === "ENOENT") return { tempRemoved: true, error: null };
      return {
        tempRemoved: false,
        error: { osCode: (error && error.code) || null, reason: (error && error.message) || String(error) },
      };
    }
  }

  /**
   * A write may only replace bytes it can authenticate with the current key.
   * Returns true when an existing file was found and opened (a normal replace),
   * false when there is no file yet (a first write). Any other outcome throws
   * and must leave the original ciphertext untouched.
   */
  function assertReplaceAllowed(file, accountId, key) {
    let existing;
    try {
      existing = fs.readFileSync(file);
    } catch (error) {
      if (error && error.code === "ENOENT") return false; // first write for this account
      throw new DraftStoreError(
        "existing_unreadable",
        {
          reason: "io",
          osCode: (error && error.code) || null,
          syscall: (error && error.syscall) || null,
          file: path.basename(file),
        },
        { cause: error },
      );
    }
    try {
      openEnvelope(accountId, key, existing);
    } catch (error) {
      throw new DraftStoreError(
        "existing_unreadable",
        {
          reason: error instanceof DraftStoreError ? error.fields.reason || "unreadable" : "unreadable",
          osCode: null,
          file: path.basename(file),
        },
        { cause: error },
      );
    }
    return true;
  }

  function directorySyncFailure(platform, error, closeError) {
    const windowsUnsupported = platform === "win32" && WINDOWS_DIRECTORY_SYNC_UNSUPPORTED.has(error && error.code);
    return {
      platform,
      attempted: true,
      supported: false,
      synced: false,
      reason: windowsUnsupported ? "unsupported" : "error",
      osCode: (error && error.code) || null,
      closeError: closeError || null,
    };
  }

  /**
   * Best-effort fsync of the directory so the rename itself survives a crash.
   * This is REPORTED, never assumed, and it never throws: the replacement has
   * already happened by the time it runs, so a fault here is a limitation to
   * report, not a failure that could imply the old bytes survived. On Windows a
   * directory handle cannot be fsynced (EPERM/EACCES) - "unsupported". Any other
   * failure, including a POSIX permission or I/O error, is "error". No caller may
   * read a pass here as a power-loss guarantee.
   */
  function syncDirectory(dirPath) {
    const platform = process.platform;
    let fd = null;
    try {
      fd = fs.openSync(dirPath, "r");
    } catch (error) {
      return directorySyncFailure(platform, error, null);
    }
    let closeError = null;
    try {
      fs.fsyncSync(fd);
    } catch (error) {
      try {
        fs.closeSync(fd);
      } catch (closeFailure) {
        closeError = {
          osCode: (closeFailure && closeFailure.code) || null,
          reason: (closeFailure && closeFailure.message) || String(closeFailure),
        };
      }
      return directorySyncFailure(platform, error, closeError);
    }
    try {
      fs.closeSync(fd);
    } catch (error) {
      // The descriptor is released when the process exits; report the limitation
      // instead of swallowing it silently.
      closeError = { osCode: (error && error.code) || null, reason: (error && error.message) || String(error) };
    }
    return { platform, attempted: true, supported: true, synced: true, reason: "synced", osCode: null, closeError };
  }

  function persist(file, envelope, accountId, key) {
    const dirPath = path.dirname(file);
    const temp = file + "." + process.pid + "." + crypto.randomBytes(8).toString("hex") + ".tmp";
    let fd = null;
    let phase = "mkdir";
    let hookError = null;
    let replacedExisting = false;
    try {
      fs.mkdirSync(dirPath, { recursive: true });
      phase = "open";
      fd = fs.openSync(temp, "wx", 0o600);
      phase = "write";
      fs.writeFileSync(fd, envelope);
      phase = "fsync";
      fs.fsyncSync(fd);
      phase = "close";
      fs.closeSync(fd);
      fd = null;
      if (beforeReplace) {
        phase = "before_replace";
        try {
          beforeReplace({ accountId, finalPath: file, tempPath: temp, bytes: envelope.length });
        } catch (error) {
          hookError = error;
          throw error;
        }
      }
      // The destructive step is next. For a serialized (single) writer per
      // directory this is the authoritative check: the target must be absent or
      // decryptable with the current key. No inter-process lock is taken.
      phase = "verify_existing";
      replacedExisting = assertReplaceAllowed(file, accountId, key);
      phase = "rename";
      fs.renameSync(temp, file); // atomic replace; the old file is intact until here
    } catch (error) {
      if (fd !== null) {
        try {
          fs.closeSync(fd);
        } catch {
          // A close that already failed will fail again; the staging file matters more.
        }
        fd = null;
      }
      const staging = removeStaging(temp);
      if (hookError !== null && error === hookError) {
        throw error; // injected fault: keep the caller's error identity and message
      }
      const failure = classify(error, phase);
      failure.fields.staging = staging;
      failure.fields.previousPreserved = true;
      throw failure;
    }
    const directorySync = syncDirectory(dirPath);
    return {
      mode: "directory",
      persisted: true,
      replacedExisting,
      file: path.basename(file),
      bytes: envelope.length,
      atomicReplace: true,
      directorySync,
      // Even a successful directory fsync is not a power-loss promise this store
      // can make; it is only what the platform let it observe.
      powerLossGuarantee: false,
      syncLimitations: "directory-entry fsync is best-effort and platform-dependent; see directorySync",
      cleanupLimitations: "a crash after close and before rename can leave an orphaned .tmp file; the .draft is untouched",
    };
  }

  return {
    /** True when writes are durable; false for the memory-only store. */
    get durable() {
      return durable;
    },

    /** What this store actually promises, stated up front rather than implied. */
    get guarantee() {
      return {
        layer: "private-byte-layer",
        authorizationOwner: "protocol-model",
        mode: durable ? "directory" : "memory",
        atomicReplace: durable,
        authenticatedEncryption: durable ? "aes-256-gcm" : "none",
        ciphertextBoundToAccount: durable,
        fileNamesOpaque: durable,
        namespaceKeySeparateFromAccountKey: durable,
        namespaceKeyStability: durable ? "stable-for-the-lifetime-of-persisted-drafts-across-restarts" : "not_applicable",
        wrongNamespaceKey: durable
          ? "a different namespace key looks up a different name; the original ciphertext is left intact and is not recovered here"
          : "not_applicable",
        replacesOnlyAuthenticatedBytes: durable,
        removeAllRows: "an authenticated write of an empty array",
        directorySync: durable ? "reported_per_write" : "not_applicable",
        powerLossGuarantee: false,
        writerLocking: "none-single-writer-per-directory",
      };
    },

    read(accountId) {
      assertAccountId(accountId);
      if (!durable) return cloneRows(memory.get(accountId) ?? []);
      const key = accountKey(accountId);
      const file = fileFor(accountId);
      let envelope;
      try {
        envelope = fs.readFileSync(file);
      } catch (error) {
        // Only "there is no file yet" is an empty draft. A permission, lock or
        // I/O failure is a named error, so a caller can never mistake an
        // inaccessible draft for an absent one and overwrite protected bytes.
        if (error && error.code === "ENOENT") return [];
        throw new DraftStoreError(
          "draft_unreadable",
          {
            reason: "io",
            osCode: (error && error.code) || null,
            syscall: (error && error.syscall) || null,
            file: path.basename(file),
          },
          { cause: error },
        );
      }
      return openEnvelope(accountId, key, envelope);
    },

    write(accountId, rows) {
      assertAccountId(accountId);
      if (!Array.isArray(rows)) throw new DraftStoreError("bad_rows", { got: typeof rows });
      if (!durable) {
        memory.set(accountId, cloneRows(rows));
        return {
          mode: "memory",
          persisted: false,
          replacedExisting: false,
          atomicReplace: false,
          directorySync: null,
          powerLossGuarantee: false,
        };
      }
      const key = accountKey(accountId);
      const file = fileFor(accountId);
      return persist(file, seal(accountId, key, rows), accountId, key);
    },
  };
}
