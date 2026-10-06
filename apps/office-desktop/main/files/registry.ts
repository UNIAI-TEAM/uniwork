import { createHash, randomBytes } from "node:crypto";
import { promises as fs, type Stats } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import { dirname, basename, isAbsolute, resolve } from "node:path";

export type LocalFileErrorCode =
  | "invalid_path"
  | "not_found"
  | "symlink_refused"
  | "locked"
  | "external_modification"
  | "invalid_handle"
  | "session_revoked"
  | "read_failed"
  | "write_failed"
  | "replace_failed"
  | "too_large";

/** Errors intentionally contain a typed reason only. Paths and byte content
 * never cross the main/renderer boundary or enter diagnostics. */
export class LocalFileError extends Error {
  readonly code: LocalFileErrorCode;
  constructor(code: LocalFileErrorCode, message = "Local file operation refused") {
    super(message);
    this.name = "LocalFileError";
    this.code = code;
  }
}

export interface FileSystemPort {
  lstat(path: string): Promise<Stats>;
  stat(path: string): Promise<Stats>;
  realpath(path: string): Promise<string>;
  readFile(path: string): Promise<Uint8Array>;
  open(path: string, flags: string | number): Promise<FileHandle>;
  rename(from: string, to: string): Promise<void>;
  unlink(path: string): Promise<void>;
}

const nativeFs: FileSystemPort = {
  lstat: (path) => fs.lstat(path),
  stat: (path) => fs.stat(path),
  realpath: (path) => fs.realpath(path),
  readFile: async (path) => new Uint8Array(await fs.readFile(path)),
  open: (path, flags) => fs.open(path, flags),
  rename: (from, to) => fs.rename(from, to),
  unlink: (path) => fs.unlink(path),
};

export interface OpenFileMetadata {
  readonly handle: string;
  readonly name: string;
  readonly byteLength: number;
  readonly modifiedAtMs: number;
  readonly checksum: string;
  /** A new local document has no backing path until its first Save As. */
  readonly untitled?: boolean;
}

interface FileRecord {
  /** Absent until a new local document is written by Save As. */
  readonly path?: string;
  readonly canonicalPath?: string;
  readonly signature: FileSignature;
  readonly metadata: OpenFileMetadata;
}

interface FileSignature {
  readonly size: number;
  readonly modifiedNs: string;
  readonly ino: number;
  readonly dev: number;
}

export interface FileHandleRegistryOptions {
  readonly sessionId: string;
  readonly windowId?: string;
  readonly fs?: FileSystemPort;
  readonly randomBytes?: (size: number) => Uint8Array;
  readonly maxBytes?: number;
}

export interface SaveAsPicker {
  pick(): Promise<string | undefined>;
}

/** Main-process registry. A handle is random, scoped to this registry's
 * session/window, and revocable; the renderer never learns the backing path. */
export class FileHandleRegistry {
  private readonly fs: FileSystemPort;
  private readonly random: (size: number) => Uint8Array;
  private readonly maxBytes: number;
  private readonly records = new Map<string, FileRecord>();
  private handleSequence = 0;
  private revoked = false;

  constructor(private readonly options: FileHandleRegistryOptions) {
    if (!options.sessionId) throw new TypeError("session id is required");
    this.fs = options.fs ?? nativeFs;
    this.random = options.randomBytes ?? ((size) => randomBytes(size));
    this.maxBytes = options.maxBytes ?? 128 * 1024 * 1024;
  }

  /** Validate a path received directly from an OS picker/open event. */
  async openPath(path: string): Promise<OpenFileMetadata> {
    this.assertActive();
    if (!isAbsolute(path)) throw new LocalFileError("invalid_path");
    const absolute = resolve(path);
    if (!absolute) throw new LocalFileError("invalid_path");
    const signature = await this.validateTarget(absolute, false);
    this.assertSize(signature.signature.size);
    let bytes: Uint8Array;
    try { bytes = await this.fs.readFile(absolute); } catch (error) { throw readFailure(error); }
    this.assertSize(bytes.byteLength);
    const canonicalPath = await this.fs.realpath(absolute).catch(() => { throw new LocalFileError("not_found"); });
    // Reopening the same local file selects its existing tab and preserves the
    // original external-change baseline until Save or an explicit close.
    const existing = [...this.records.values()].find((record) => record.canonicalPath === canonicalPath);
    if (existing) return existing.metadata;
    const handle = this.newHandle();
    const metadata = Object.freeze({ handle, name: basename(absolute), byteLength: bytes.byteLength, modifiedAtMs: signature.modifiedAtMs, checksum: checksum(bytes) });
    this.records.set(handle, { path: absolute, canonicalPath, signature: signature.signature, metadata });
    return metadata;
  }

  /** Alias used by the open-event adapter. */
  openEvent(path: string): Promise<OpenFileMetadata> { return this.openPath(path); }

  /** A new document with no backing path. The renderer cannot choose a path: the
   * document becomes writable only through the Save As picker. */
  createUntitled(bytes: Uint8Array, name: string, now = Date.now()): OpenFileMetadata {
    this.assertActive();
    this.assertSize(bytes.byteLength);
    const handle = this.newHandle();
    const metadata = Object.freeze({ handle, name, byteLength: bytes.byteLength, modifiedAtMs: now, checksum: checksum(bytes), untitled: true });
    this.records.set(handle, { signature: { size: bytes.byteLength, modifiedNs: String(now * 1_000_000), ino: 0, dev: 0 }, metadata });
    return metadata;
  }

  /** Main-only lookup for host bookkeeping (recent files, protected drafts).
   * The renderer never receives a path from this registry. */
  pathOf(handle: string): string | undefined { return this.getRecord(handle).path; }

  async read(handle: string): Promise<Uint8Array> {
    const record = this.getRecord(handle);
    if (!record.path) throw new LocalFileError("invalid_path");
    await this.validateCurrent(record, false);
    try {
      this.assertSize((await this.fs.stat(record.path)).size);
      const bytes = await this.fs.readFile(record.path);
      this.assertSize(bytes.byteLength);
      return new Uint8Array(bytes);
    }
    catch (error) { if (error instanceof LocalFileError) throw error; throw readFailure(error); }
  }

  /** Validate an already-issued handle for an open command without exposing
   * the backing path; the renderer obtains bytes through the engine seam. */
  async openPathFromHandle(handle: string): Promise<OpenFileMetadata> {
    const record = this.getRecord(handle);
    if (!record.path) return record.metadata;
    await this.validateCurrent(record, false);
    return record.metadata;
  }

  /** Save into the originally opened file after a fresh external-change check. */
  async save(handle: string, bytes: Uint8Array): Promise<OpenFileMetadata> {
    const record = this.getRecord(handle);
    if (!record.path) throw new LocalFileError("invalid_path");
    this.assertSize(bytes.byteLength);
    await this.validateCurrent(record, true);
    await atomicReplace(record.path, bytes, this.fs, this.maxBytes);
    const updated = await this.refreshRecord(handle, record.path);
    return updated;
  }

  /** Save As obtains its destination from a main-process picker, never IPC. */
  async saveAs(handle: string, bytes: Uint8Array, picker: SaveAsPicker): Promise<OpenFileMetadata | undefined> {
    this.getRecord(handle);
    this.assertSize(bytes.byteLength);
    this.assertActive();
    const selected = await picker.pick();
    if (!selected) return undefined;
    if (!isAbsolute(selected)) throw new LocalFileError("invalid_path");
    const destination = resolve(selected);
    await this.validateTarget(destination, true, true);
    await atomicReplace(destination, bytes, this.fs, this.maxBytes);
    return this.registerNew(destination);
  }

  revoke(handle?: string): void {
    if (handle) this.records.delete(handle);
    else this.records.clear();
  }

  /** Restart-stable opaque identity for a handle. Draft recovery needs to find
   * the same local file after a restart, while the raw path stays in main and
   * only its hash reaches the encrypted draft identity. */
  identityFor(handle: string): string {
    const record = this.getRecord(handle);
    return `local:${createHash("sha256").update(record.canonicalPath ?? record.path ?? handle).digest("hex")}`;
  }

  revokeSession(): void { this.revoked = true; this.records.clear(); }
  get size(): number { return this.records.size; }

  private async registerNew(path: string): Promise<OpenFileMetadata> {
    const signature = await this.validateTarget(path, false);
    this.assertSize(signature.signature.size);
    const bytes = await this.fs.readFile(path);
    this.assertSize(bytes.byteLength);
    const handle = this.newHandle();
    const canonicalPath = await this.fs.realpath(path).catch(() => { throw new LocalFileError("not_found"); });
    const metadata = Object.freeze({ handle, name: basename(path), byteLength: bytes.byteLength, modifiedAtMs: signature.modifiedAtMs, checksum: checksum(bytes) });
    this.records.set(handle, { path, canonicalPath, signature: signature.signature, metadata });
    return metadata;
  }

  private async refreshRecord(handle: string, path: string): Promise<OpenFileMetadata> {
    const metadata = await this.registerNew(path);
    this.records.delete(metadata.handle);
    const record = this.records.get(handle);
    if (!record) throw new LocalFileError("invalid_handle");
    const stat = await this.fs.stat(path);
    const replaced = { ...record, signature: { size: stat.size, modifiedNs: statModifiedNs(stat), ino: stat.ino, dev: stat.dev }, metadata: { ...metadata, handle } };
    this.records.set(handle, replaced);
    return replaced.metadata;
  }

  private getRecord(handle: string): FileRecord {
    this.assertActive();
    const record = this.records.get(handle);
    if (!record) throw new LocalFileError("invalid_handle");
    return record;
  }

  private assertActive(): void { if (this.revoked) throw new LocalFileError("session_revoked"); }
  private assertSize(size: number): void { if (!Number.isSafeInteger(size) || size > this.maxBytes) throw new LocalFileError("too_large"); }

  private newHandle(): string {
    const base = `file_${Buffer.from(this.random(32)).toString("base64url")}`;
    let handle = base;
    while (this.records.has(handle)) handle = `${base}_${++this.handleSequence}`;
    return handle;
  }

  private async validateTarget(path: string, allowMissing: boolean, probeWrite = false): Promise<{ signature: FileSignature; modifiedAtMs: number }> {
    const absolute = resolve(path);
    let current = dirname(absolute);
    while (current !== dirname(current)) {
      try { if ((await this.fs.lstat(current)).isSymbolicLink()) throw new LocalFileError("symlink_refused"); }
      catch (error) {
        if (error instanceof LocalFileError) throw error;
        if (!allowMissing) throw new LocalFileError("not_found");
        break;
      }
      current = dirname(current);
    }
    let stat: Stats;
    try { stat = await this.fs.lstat(absolute); } catch { if (allowMissing) return { signature: { size: 0, modifiedNs: "0", ino: 0, dev: 0 }, modifiedAtMs: 0 }; throw new LocalFileError("not_found"); }
    if (stat.isSymbolicLink()) throw new LocalFileError("symlink_refused");
    if (!stat.isFile()) throw new LocalFileError("invalid_path");
    if (stat.isFile()) {
      try { await this.fs.open(absolute, probeWrite ? "r+" : "r").then((handle) => handle.close()); } catch { throw new LocalFileError("locked"); }
    }
    return { signature: { size: stat.size, modifiedNs: statModifiedNs(stat), ino: stat.ino, dev: stat.dev }, modifiedAtMs: stat.mtimeMs };
  }

  private async validateCurrent(record: FileRecord, forWrite: boolean): Promise<void> {
    if (!record.path) return;
    const current = await this.validateTarget(record.path, false, forWrite);
    if (forWrite && !sameSignature(record.signature, current.signature)) throw new LocalFileError("external_modification");
    if (forWrite) {
      try {
        const bytes = await this.fs.readFile(record.path);
        if (checksum(bytes) !== record.metadata.checksum) throw new LocalFileError("external_modification");
      } catch (error) {
        if (error instanceof LocalFileError) throw error;
        throw new LocalFileError("not_found");
      }
    }
    const canonical = await this.fs.realpath(record.path).catch(() => { throw new LocalFileError("not_found"); });
    if (canonical !== record.canonicalPath) throw new LocalFileError("symlink_refused");
  }
}

export async function atomicReplace(path: string, bytes: Uint8Array, fileSystem: FileSystemPort = nativeFs, maxBytes = 128 * 1024 * 1024): Promise<void> {
  if (bytes.byteLength > maxBytes) throw new LocalFileError("too_large");
  const temp = `${path}.uniwork-${Buffer.from(randomBytes(16)).toString("hex")}.tmp`;
  let opened: FileHandle | undefined;
  try {
    opened = await fileSystem.open(temp, "wx");
    await opened.writeFile(bytes);
    await opened.sync();
    await opened.close();
    opened = undefined;
    await fileSystem.rename(temp, path);
  } catch (error) {
    try { await opened?.close(); } catch { /* best effort cleanup */ }
    try { await fileSystem.unlink(temp); } catch { /* temp may not exist */ }
    if (error instanceof LocalFileError) throw error;
    const message = error instanceof Error ? error.message.toLowerCase() : "";
    throw new LocalFileError(message.includes("rename") || message.includes("replace") ? "replace_failed" : "write_failed");
  }
}

/** A failed read names what the user can act on: a vanished file is not_found,
 * a sharing violation is locked, anything else (permissions, I/O) is read_failed
 * instead of the misleading "moved or deleted". */
function readFailure(error: unknown): LocalFileError {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  if (code === "ENOENT" || code === "ENOTDIR") return new LocalFileError("not_found");
  if (code === "EBUSY" || code === "ETXTBSY") return new LocalFileError("locked");
  return new LocalFileError("read_failed");
}

function statModifiedNs(stat: Stats): string {
  const value = (stat as Stats & { mtimeNs?: bigint }).mtimeNs;
  return typeof value === "bigint" ? value.toString() : String(Math.round(stat.mtimeMs * 1_000_000));
}

function sameSignature(a: FileSignature, b: FileSignature): boolean {
  return a.size === b.size && a.modifiedNs === b.modifiedNs && a.ino === b.ino && a.dev === b.dev;
}

function checksum(bytes: Uint8Array): string { return `sha256:${createHash("sha256").update(bytes).digest("hex")}`; }
