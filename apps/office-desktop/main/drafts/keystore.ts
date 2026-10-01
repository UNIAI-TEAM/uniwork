import { randomBytes } from "node:crypto";
import { execFile, execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import { userInfo } from "node:os";
import { promisify } from "node:util";
import { dirname, join, win32 as windowsPath } from "node:path";

/** Electron's safeStorage is backed by Windows DPAPI and the macOS Keychain.
 * The adapter is deliberately tiny so the draft store never receives an
 * Electron object or a refresh-token credential store. */
export interface DraftSafeStorage {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Uint8Array;
  decryptString(value: Uint8Array): string;
  /** Linux exposes a plaintext backend; a protected draft key must never use it. */
  getSelectedStorageBackend?(): string;
}

export type DraftKeyStoreErrorCode = "locked" | "corrupt" | "unavailable";

export class DraftKeyStoreError extends Error {
  readonly code: DraftKeyStoreErrorCode;

  constructor(code: DraftKeyStoreErrorCode, message = "draft key store unavailable") {
    super(message);
    this.name = "DraftKeyStoreError";
    this.code = code;
  }
}

export interface DraftKeyFileSystem {
  mkdir(path: string, options: { recursive: true; mode: number }): Promise<void>;
  readFile(path: string): Promise<Uint8Array>;
  writeFile(path: string, data: Uint8Array, options: { flag: "wx"; mode: number }): Promise<void>;
  open(path: string, flags: string): Promise<{ sync(): Promise<void>; close(): Promise<void> }>;
  rename(from: string, to: string): Promise<void>;
  rm(path: string, options: { force: true }): Promise<void>;
  chmod(path: string, mode: number): Promise<void>;
}

const nodeFileSystem: DraftKeyFileSystem = {
  mkdir: async (path, options) => { await fs.mkdir(path, options); },
  readFile: (path) => fs.readFile(path),
  writeFile: (path, data, options) => fs.writeFile(path, data, options),
  open: async (path, flags) => fs.open(path, flags),
  rename: (from, to) => fs.rename(from, to),
  rm: (path, options) => fs.rm(path, options),
  chmod: (path, mode) => fs.chmod(path, mode),
};
const execFileAsync = promisify(execFile);

export function windowsSystemPath(executable: string, systemRoot = process.env.SystemRoot): string {
  if (!systemRoot || !windowsPath.isAbsolute(systemRoot)) {
    throw new DraftKeyStoreError("unavailable", "Windows system root could not be resolved");
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\.exe$/i.test(executable)) {
    throw new DraftKeyStoreError("unavailable", "Windows system executable could not be resolved");
  }
  return windowsPath.join(systemRoot, "System32", executable);
}

export function windowsWhoamiPath(systemRoot = process.env.SystemRoot): string {
  return windowsSystemPath("whoami.exe", systemRoot);
}

function currentWindowsAccount(): string {
  if (process.platform !== "win32") return userInfo().username;
  try {
    const account = execFileSync(windowsWhoamiPath(), { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true }).trim();
    if (/^[^\\/:\r\n]+\\[^\\/:\r\n]+$/.test(account)) return account;
  } catch { /* map identity lookup failures to the typed ACL error below */ }
  throw new DraftKeyStoreError("unavailable", "current Windows account could not be resolved");
}

export interface DraftKeyStoreOptions {
  readonly userDataDirectory: string;
  readonly channel: "stable" | "beta" | "dev";
  readonly keyNamespace: string;
  readonly safeStorage: DraftSafeStorage;
  readonly fileSystem?: DraftKeyFileSystem;
  /** Injectable for system tests. Production uses chmod and the platform ACL. */
  readonly restrictFile?: (path: string) => Promise<void>;
  /** Injectable directory ACL hook; omitted in production to use the platform ACL. */
  readonly restrictDirectory?: (path: string) => Promise<void>;
  readonly randomBytes?: (size: number) => Uint8Array;
}

/**
 * Stores one random 256-bit draft key per opaque namespace. The key is always
 * wrapped by safeStorage before it reaches disk. Missing keys are observable
 * through `get`; callers with an existing envelope must never call
 * `getOrCreate`, which prevents a lost key from silently creating an empty
 * replacement draft.
 */
export function createSafeStorageDraftKeyStore(options: DraftKeyStoreOptions) {
  const fileSystem = options.fileSystem ?? nodeFileSystem;
  const random = options.randomBytes ?? randomBytes;
  const root = join(options.userDataDirectory, "draft-keys", safeSegment(options.channel), safeSegment(options.keyNamespace));
  const fileFor = (namespace: string) => join(root, `${safeSegment(namespace)}.key`);
  const restrictFile = options.restrictFile ?? (async (path: string) => {
    await fileSystem.chmod(path, 0o600);
    // chmod is meaningful on macOS/Linux. Windows ACLs need inheritance
    // removed explicitly; execFile avoids shell interpolation of the path.
    if (process.platform === "win32") {
      try {
        const account = currentWindowsAccount();
        // Modify includes read/write/delete, which is required for atomic key
        // rotation and explicit logout cleanup while still granting only the
        // current account after inherited ACLs are removed.
        await execFileAsync(windowsSystemPath("icacls.exe"), [path, "/inheritance:r", "/remove:g", "*S-1-5-32-544", "/grant:r", `${account}:(M)`]);
      } catch { throw new DraftKeyStoreError("unavailable", "draft key permissions could not be restricted"); }
    }
  });
  const restrictDirectory = options.restrictDirectory ?? (options.restrictFile
    ? async () => undefined
    : async (path: string) => {
      if (process.platform !== "win32") return;
      try {
        const account = currentWindowsAccount();
        await execFileAsync(windowsSystemPath("icacls.exe"), [path, "/inheritance:r", "/remove:g", "*S-1-5-32-544", "/grant:r", `${account}:(M)`]);
      } catch { throw new DraftKeyStoreError("unavailable", "draft key directory permissions could not be restricted"); }
    });

  function ensureAvailable(): void {
    if (!options.safeStorage.isEncryptionAvailable()) throw new DraftKeyStoreError("locked", "draft key store is locked");
    if (options.safeStorage.getSelectedStorageBackend?.() === "basic_text") throw new DraftKeyStoreError("locked", "draft key store is locked");
  }

  async function read(namespace: string): Promise<Uint8Array | undefined> {
    ensureAvailable();
    const path = fileFor(namespace);
    let wrapped: Uint8Array;
    try { wrapped = await fileSystem.readFile(path); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw new DraftKeyStoreError("unavailable");
    }
    try {
      const encoded = options.safeStorage.decryptString(wrapped);
      const key = Uint8Array.from(Buffer.from(encoded, "base64url"));
      if (key.byteLength !== 32) throw new Error("invalid key");
      return key;
    } catch (error) {
      if (error instanceof DraftKeyStoreError) throw error;
      throw new DraftKeyStoreError("corrupt", "draft key is corrupt");
    }
  }

  async function write(namespace: string, key: Uint8Array): Promise<void> {
    const path = fileFor(namespace);
    const directory = dirname(path);
    const temporary = `${path}.${process.pid}.${Date.now().toString(36)}.${Buffer.from(random(12)).toString("hex")}.tmp`;
    await fileSystem.mkdir(directory, { recursive: true, mode: 0o700 });
    await fileSystem.chmod(directory, 0o700);
    await restrictDirectory(directory);
    let handle: { sync(): Promise<void>; close(): Promise<void> } | undefined;
    try {
      const wrapped = options.safeStorage.encryptString(Buffer.from(key).toString("base64url"));
      await fileSystem.writeFile(temporary, wrapped, { flag: "wx", mode: 0o600 });
      await restrictFile(temporary);
      handle = await fileSystem.open(temporary, "r+");
      await handle.sync();
      await handle.close();
      handle = undefined;
      try {
        await fileSystem.rename(temporary, path);
      } catch (error) {
        // Another process may have created this namespace after our initial
        // read. Preserve that winner and let getOrCreate read it back instead
        // of replacing it or reporting a spurious store failure.
        try {
          await fileSystem.readFile(path);
          await fileSystem.rm(temporary, { force: true });
          return;
        } catch {
          throw error;
        }
      }
      await restrictFile(path);
    } catch (error) {
      if (handle) await handle.close().catch(() => undefined);
      await fileSystem.rm(temporary, { force: true }).catch(() => undefined);
      if (error instanceof DraftKeyStoreError) throw error;
      throw new DraftKeyStoreError("unavailable");
    }
  }

  return Object.freeze({
    async get(namespace: string): Promise<Uint8Array | undefined> {
      return read(namespace);
    },
    async getOrCreate(namespace: string): Promise<Uint8Array> {
      const existing = await read(namespace);
      if (existing) return existing;
      const key = Uint8Array.from(random(32));
      if (key.byteLength !== 32) throw new DraftKeyStoreError("unavailable");
      await write(namespace, key);
      // A concurrent process may win the namespace between read and rename.
      // Reading it back makes the winner's key authoritative for this store.
      return (await read(namespace)) ?? key;
    },
    async delete(namespace: string): Promise<void> {
      ensureAvailable();
      try { await fileSystem.rm(fileFor(namespace), { force: true }); }
      catch { throw new DraftKeyStoreError("unavailable"); }
    },
  });
}

function safeSegment(value: string): string {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(normalized)) throw new DraftKeyStoreError("corrupt", "invalid draft key namespace");
  return normalized;
}
