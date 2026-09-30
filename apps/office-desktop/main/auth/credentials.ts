import { closeSync, chmodSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type CredentialSession = Readonly<{
  accountId: string;
  deviceSessionId: string;
  sessionId: string;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  refreshExpiresIn: number;
}>;

/** Port owned by main. 03a only supplies an in-memory fake; OS-backed stores
 * are deliberately deferred to 03b (G4-D2 library choice remains open). */
export type CredentialStore = Readonly<{
  save(session: CredentialSession): Promise<void> | void;
  get(): Promise<CredentialSession | undefined> | CredentialSession | undefined;
  clear(): Promise<void> | void;
}>;

export type CredentialStoreErrorCode = "locked" | "unavailable" | "corrupt" | "login_required";

/** Errors from the OS-backed store deliberately carry a coarse code only.
 * Paths, ciphertext and token-shaped values are never included in errors. */
export class CredentialStoreError extends Error {
  readonly code: CredentialStoreErrorCode;
  constructor(code: CredentialStoreErrorCode, message = "credential store unavailable") {
    super(message);
    this.name = "CredentialStoreError";
    this.code = code;
  }
}

export type SafeStorageAdapter = Readonly<{
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Uint8Array;
  decryptString(value: Uint8Array): string;
}>;

export type CredentialStoreFileSystem = Readonly<{
  mkdirSync(path: string, options: { recursive: true; mode: number }): void;
  readdirSync(path: string): string[];
  existsSync(path: string): boolean;
  readFileSync(path: string): Uint8Array;
  writeFileSync(path: string, data: Uint8Array, options: { mode: number; flag?: string }): void;
  openSync(path: string, flags: string): number;
  fsyncSync(fd: number): void;
  closeSync(fd: number): void;
  renameSync(from: string, to: string): void;
  rmSync(path: string, options: { force: true }): void;
  chmodSync(path: string, mode: number): void;
}>;

const nodeFileSystem: CredentialStoreFileSystem = { mkdirSync, readdirSync, existsSync, readFileSync, writeFileSync, openSync, fsyncSync, closeSync, renameSync, rmSync, chmodSync };
const SESSION_VERSION = 1;
const FILE_SUFFIX = ".credential";

/**
 * Electron safeStorage delegates to Windows DPAPI and the macOS Keychain.
 * The encrypted payload is written to a per-channel/deployment/account file;
 * the file is replaced with a fsync'd temporary file, so a torn write leaves
 * the previous pair intact. There is intentionally no plaintext fallback.
 */
export function createSecureCredentialStore(options: Readonly<{
  userDataDirectory: string;
  channel: "stable" | "beta" | "dev";
  deploymentId: string;
  safeStorage: SafeStorageAdapter;
  fileSystem?: CredentialStoreFileSystem;
}>): CredentialStore {
  const fs = options.fileSystem ?? nodeFileSystem;
  const root = join(options.userDataDirectory, "credentials", options.channel, safeSegment(options.deploymentId));
  const activePath = join(root, ".active");
  let lastPath: string | undefined;
  const ensureAvailable = () => {
    try {
      if (!options.safeStorage.isEncryptionAvailable()) throw new CredentialStoreError("locked", "secure credential store is locked");
      fs.mkdirSync(root, { recursive: true, mode: 0o700 });
      fs.chmodSync(root, 0o700);
    } catch (error) {
      if (error instanceof CredentialStoreError) throw error;
      throw new CredentialStoreError("unavailable");
    }
  };
  const fileFor = (accountId: string) => join(root, `${safeSegment(accountId)}${FILE_SUFFIX}`);
  const readPair = (file: string): CredentialSession => {
    try {
      const plaintext = options.safeStorage.decryptString(fs.readFileSync(file));
      const parsed: unknown = JSON.parse(plaintext);
      if (!isCredentialSessionEnvelope(parsed)) throw new Error("invalid");
      return parsed.session;
    } catch (error) {
      if (error instanceof CredentialStoreError) throw error;
      throw new CredentialStoreError("corrupt", "secure credential data is corrupt");
    }
  };
  return Object.freeze({
    save(session: CredentialSession) {
      ensureAvailable();
      if (!isCredentialSession(session)) throw new CredentialStoreError("corrupt", "invalid credential data");
      const target = fileFor(session.accountId);
      const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
      const backup = `${target}.bak`;
      const envelope = Buffer.from(JSON.stringify({ version: SESSION_VERSION, session }), "utf8");
      let fd: number | undefined;
      try {
        const encrypted = options.safeStorage.encryptString(envelope.toString("utf8"));
        fs.writeFileSync(temp, encrypted, { mode: 0o600, flag: "wx" });
        fs.chmodSync(temp, 0o600);
        fd = fs.openSync(temp, "r+");
        fs.fsyncSync(fd);
        fs.closeSync(fd);
        fd = undefined;
        // Windows cannot replace an existing destination with rename on every
        // filesystem. Keep a backup while swapping; recovery below restores it
        // if the process dies between the two renames.
        const hadTarget = fs.existsSync(target);
        if (hadTarget) fs.renameSync(target, backup);
        try { fs.renameSync(temp, target); }
        catch (error) {
          if (hadTarget && fs.existsSync(backup)) try { fs.renameSync(backup, target); } catch { /* recovery will retry */ }
          throw error;
        }
        if (hadTarget) fs.rmSync(backup, { force: true });
        fs.chmodSync(target, 0o600);
        fs.writeFileSync(activePath, Buffer.from(session.accountId, "utf8"), { mode: 0o600 });
        fs.chmodSync(activePath, 0o600);
        lastPath = target;
      } catch (error) {
        if (fd !== undefined) try { fs.closeSync(fd); } catch { /* best effort */ }
        try { fs.rmSync(temp, { force: true }); } catch { /* best effort */ }
        if (error instanceof CredentialStoreError) throw error;
        throw new CredentialStoreError("unavailable");
      }
    },
    get() {
      ensureAvailable();
      try {
        const names = fs.readdirSync(root).filter((name) => name.endsWith(FILE_SUFFIX));
        const persistedPath = lastPath;
        if (persistedPath && fs.existsSync(persistedPath)) return readPair(persistedPath);
        if (names.length === 0) return undefined;
        let activeAccount: string;
        try { activeAccount = new TextDecoder().decode(fs.readFileSync(activePath)); } catch { throw new CredentialStoreError("corrupt", "credential selector is missing"); }
        const file = fileFor(activeAccount);
        if (!fs.existsSync(file) && fs.existsSync(`${file}.bak`)) {
          try { fs.renameSync(`${file}.bak`, file); } catch { throw new CredentialStoreError("unavailable"); }
        }
        if (!names.includes(`${safeSegment(activeAccount)}${FILE_SUFFIX}`)) throw new CredentialStoreError("corrupt", "credential selector is invalid");
        const session = readPair(file);
        lastPath = file;
        return session;
      } catch (error) {
        if (error instanceof CredentialStoreError) throw error;
        throw new CredentialStoreError("unavailable");
      }
    },
    clear() {
      ensureAvailable();
      if (!lastPath) return;
      try { fs.rmSync(lastPath, { force: true }); fs.rmSync(activePath, { force: true }); lastPath = undefined; }
      catch { throw new CredentialStoreError("unavailable"); }
    },
  });
}

export function createInMemoryCredentialStore(): CredentialStore {
  let current: CredentialSession | undefined;
  return Object.freeze({
    save(session) { current = Object.freeze({ ...session }); },
    get() { return current; },
    clear() { current = undefined; },
  });
}

function safeSegment(value: string): string {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(normalized)) throw new CredentialStoreError("corrupt", "invalid credential namespace");
  return normalized;
}

function isCredentialSession(value: unknown): value is CredentialSession {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return ["accountId", "deviceSessionId", "sessionId", "accessToken", "refreshToken"].every((key) => typeof candidate[key] === "string" && (candidate[key] as string).length > 0)
    && ["expiresIn", "refreshExpiresIn"].every((key) => typeof candidate[key] === "number" && Number.isSafeInteger(candidate[key]) && (candidate[key] as number) > 0);
}

function isCredentialSessionEnvelope(value: unknown): value is { version: number; session: CredentialSession } {
  return Boolean(value && typeof value === "object" && (value as Record<string, unknown>).version === SESSION_VERSION && isCredentialSession((value as Record<string, unknown>).session));
}
