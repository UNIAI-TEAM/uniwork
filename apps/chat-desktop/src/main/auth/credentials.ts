import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeSync,
} from "node:fs";
import { join } from "node:path";

/**
 * The persisted half of a desktop session: refresh token + device session,
 * bound to the deployment it was issued by. The access token is never
 * persisted (main-process memory only).
 */
export interface StoredCredential {
  deploymentId: string;
  apiOrigin: string;
  clientId: string;
  accountId: string;
  deviceSessionId: string;
  sessionId: string;
  refreshToken: string;
  /** epoch ms; past this the refresh token is dead and the session expired */
  refreshExpiresAt: number;
}

export type CredentialStoreErrorCode = "keyring_unavailable" | "keystore_locked" | "io";

export class CredentialStoreError extends Error {
  readonly code: CredentialStoreErrorCode;
  constructor(code: CredentialStoreErrorCode) {
    // coarse code only: no paths, ciphertext or token-shaped values
    super(`credential store: ${code}`);
    this.name = "CredentialStoreError";
    this.code = code;
  }
}

/** the slice of Electron's safeStorage this store needs */
export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
  /** Linux only; `basic_text` means no keyring and is refused */
  getSelectedStorageBackend?(): string;
}

export interface CredentialStore {
  load(): StoredCredential | null;
  save(credential: StoredCredential): void;
  clear(): void;
  /** true when save() could encrypt right now (writes nothing, never plaintext) */
  canStore(): boolean;
}

const VERSION = 1;
const DIR = "unichat-auth";
const FILE = "session.bin";

function isStoredCredential(value: unknown): value is StoredCredential {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  const strings = ["deploymentId", "apiOrigin", "clientId", "accountId", "deviceSessionId", "sessionId", "refreshToken"];
  return (
    strings.every((key) => typeof v[key] === "string" && (v[key] as string).length > 0) &&
    typeof v.refreshExpiresAt === "number" &&
    Number.isFinite(v.refreshExpiresAt)
  );
}

/** what one file on disk holds: a credential, nothing usable, or bytes the keyring cannot open now */
type ReadResult =
  | { kind: "ok"; credential: StoredCredential }
  | { kind: "corrupt" }
  | { kind: "unsupported" }
  | { kind: "locked" };

/**
 * Electron safeStorage (DPAPI on Windows, Keychain on macOS, Secret Service
 * on Linux) encrypts one envelope file. Writes go to a fsync'd temp file that
 * is renamed over the previous one, so a crash leaves either the old or the
 * new credential, never a torn one. There is no backup copy: refresh tokens
 * rotate, so an older copy is dead server-side and replaying it would make
 * the server revoke the whole device (refresh_reused).
 *
 * A file the keyring cannot decrypt right now is kept and reported as
 * keystore_locked (transient), distinct from keyring_unavailable (no usable
 * keyring at all); only a file that decrypts to garbage is dropped. There is
 * no plaintext fallback: a Linux host on the `basic_text` backend or with
 * encryption unavailable is refused.
 *
 * A save is classified the same way: the keyring call (encryptString) is kept
 * apart from the file steps, so a keyring that refuses is keystore_locked and
 * only the file steps (mkdir, write, fsync, rename) can be io. A save refused
 * by the keyring throws before anything is written.
 */
export function createCredentialStore(options: { userDataDir: string; safeStorage: SafeStorageLike }): CredentialStore {
  const dir = join(options.userDataDir, DIR);
  const target = join(dir, FILE);
  const { safeStorage } = options;

  const ensureAvailable = () => {
    let backend: string | undefined;
    try {
      backend = safeStorage.getSelectedStorageBackend?.();
    } catch {
      backend = undefined;
    }
    if (backend === "basic_text") throw new CredentialStoreError("keyring_unavailable");
    let available: boolean;
    try {
      available = safeStorage.isEncryptionAvailable();
    } catch {
      available = false;
    }
    if (!available) throw new CredentialStoreError("keyring_unavailable");
  };

  const readTarget = (): ReadResult => {
    let plain: string;
    try {
      plain = safeStorage.decryptString(readFileSync(target));
    } catch {
      return { kind: "locked" };
    }
    let envelope: { version?: unknown; credential?: unknown } | null;
    try {
      envelope = JSON.parse(plain) as { version?: unknown; credential?: unknown } | null;
    } catch {
      return { kind: "corrupt" };
    }
    // a newer build's format: leave it for that build, sign in fresh here
    if (typeof envelope?.version === "number" && envelope.version > VERSION) return { kind: "unsupported" };
    if (envelope?.version !== VERSION || !isStoredCredential(envelope.credential)) return { kind: "corrupt" };
    return { kind: "ok", credential: envelope.credential };
  };

  const removeQuietly = (path: string) => {
    try {
      rmSync(path, { force: true });
    } catch {
      // best effort
    }
  };

  return {
    load() {
      ensureAvailable();
      if (!existsSync(target)) return null;
      const read = readTarget();
      switch (read.kind) {
        case "ok":
          return read.credential;
        case "locked":
          // the refresh token may still be good once the keyring opens again
          throw new CredentialStoreError("keystore_locked");
        case "unsupported":
          return null;
        case "corrupt":
          removeQuietly(target);
          return null;
      }
    },
    save(credential) {
      ensureAvailable();
      if (!isStoredCredential(credential)) throw new CredentialStoreError("io");
      let encrypted: Buffer;
      try {
        encrypted = safeStorage.encryptString(JSON.stringify({ version: VERSION, credential }));
      } catch {
        throw new CredentialStoreError("keystore_locked");
      }
      const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
      try {
        mkdirSync(dir, { recursive: true, mode: 0o700 });
        const fd = openSync(temp, "wx", 0o600);
        try {
          writeSync(fd, encrypted);
          fsyncSync(fd);
        } finally {
          closeSync(fd);
        }
        // atomic replace (MoveFileEx REPLACE_EXISTING on Windows, rename(2) elsewhere)
        renameSync(temp, target);
      } catch {
        removeQuietly(temp);
        // only file steps run here: a failure is a real io error
        throw new CredentialStoreError("io");
      }
    },
    clear() {
      removeQuietly(target);
    },
    canStore() {
      try {
        ensureAvailable();
        safeStorage.encryptString("probe");
        return true;
      } catch {
        return false;
      }
    },
  };
}
