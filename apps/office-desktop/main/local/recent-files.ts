import { createHash, randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";
import type { DraftIdentity } from "../../../../packages/core/office/draft-recovery";
import { checksum, decryptDraft, encryptDraft } from "../drafts/crypto";
import type { DraftKeyStore } from "../drafts/store";
import { deviceScopeAccountId } from "./device";

export interface RecentFileEntry {
  readonly id: string;
  readonly name: string;
  readonly directory: string;
  readonly modifiedAtMs: number;
  readonly updatedAt: number;
  readonly missing: boolean;
}

export interface RecentFileRecord {
  readonly id: string;
  readonly path: string;
  readonly name: string;
  readonly directory: string;
  readonly modifiedAtMs: number;
  readonly updatedAt: number;
}

export class RecentFilesError extends Error {
  readonly code: "locked" | "unavailable" | "corrupt";
  constructor(code: "locked" | "unavailable" | "corrupt", message = "recent files store is unavailable") {
    super(message);
    this.name = "RecentFilesError";
    this.code = code;
  }
}

export interface RecentFilesFileSystem {
  mkdir(path: string, options: { recursive: true }): Promise<void>;
  readFile(path: string): Promise<Uint8Array>;
  writeFile(path: string, data: Uint8Array, options: { flag: "wx"; mode: number }): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  rm(path: string, options: { force: true }): Promise<void>;
  stat(path: string): Promise<unknown>;
}

const nodeFileSystem: RecentFilesFileSystem = {
  mkdir: async (path, options) => { await fs.mkdir(path, options); },
  readFile: (path) => fs.readFile(path),
  writeFile: (path, data, options) => fs.writeFile(path, data, options),
  rename: (from, to) => fs.rename(from, to),
  rm: async (path, options) => { await fs.rm(path, options); },
  stat: (path) => fs.stat(path),
};

interface Envelope {
  readonly version: 1;
  readonly generation: number;
  readonly checksum: string;
  readonly nonce: string;
  readonly ciphertext: string;
}

const MAX_ENTRIES = 20;

/** Display-only shortened directory: the last two segments plus an ellipsis
 * when the path is deeper. The full path never leaves main. */
export function shortenDirectory(path: string): string {
  const parts = dirname(resolve(path)).split(/[\\/]+/).filter(Boolean);
  if (parts.length === 0) return "";
  const tail = parts.slice(-2).join(sep);
  return parts.length > 2 ? `…${sep}${tail}` : tail;
}

/** The recent-files list is main-owned and encrypted exactly like a draft:
 * it is stored under the local device key namespace and is unreadable to an
 * account session. Missing or corrupt key material fails closed instead of
 * falling back to a plaintext list. */
export function createRecentFilesStore(options: {
  userDataDirectory: string;
  keyStore: DraftKeyStore;
  deviceId: string;
  maxEntries?: number;
  now?: () => number;
  randomBytes?: (size: number) => Uint8Array;
  fileSystem?: RecentFilesFileSystem;
}) {
  const fileSystem = options.fileSystem ?? nodeFileSystem;
  const random = options.randomBytes ?? randomBytes;
  const now = options.now ?? (() => Date.now());
  const maxEntries = options.maxEntries ?? MAX_ENTRIES;
  const path = join(options.userDataDirectory, "local", "recent-files.bin");
  const keyNamespace = `local-recent-${options.deviceId}`;
  const identity: DraftIdentity = {
    deploymentId: "local-device",
    accountId: deviceScopeAccountId(options.deviceId),
    organizationId: "local",
    workspaceId: "recent",
    documentId: "recent-files",
    base: { revision: "0", version: "0" },
  };
  let cache: RecentFileRecord[] | undefined;
  let generation = 0;
  let tail: Promise<unknown> = Promise.resolve();

  const parseEnvelope = (value: unknown): Envelope => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new RecentFilesError("corrupt");
    const candidate = value as Partial<Envelope>;
    if (candidate.version !== 1 || typeof candidate.generation !== "number" || !Number.isSafeInteger(candidate.generation) || candidate.generation < 1 || typeof candidate.checksum !== "string" || typeof candidate.nonce !== "string" || typeof candidate.ciphertext !== "string") throw new RecentFilesError("corrupt");
    return candidate as Envelope;
  };

  const parseRecords = (value: unknown): RecentFileRecord[] => {
    if (!value || typeof value !== "object" || !Array.isArray((value as { entries?: unknown }).entries)) throw new RecentFilesError("corrupt");
    const entries = (value as { entries: unknown[] }).entries;
    return entries.map((entry) => {
      const record = entry as Partial<RecentFileRecord>;
      if (!record || typeof record !== "object" || typeof record.id !== "string" || typeof record.path !== "string" || typeof record.name !== "string" || typeof record.directory !== "string" || typeof record.modifiedAtMs !== "number" || typeof record.updatedAt !== "number" || !Number.isFinite(record.modifiedAtMs) || !Number.isFinite(record.updatedAt)) throw new RecentFilesError("corrupt");
      return record as RecentFileRecord;
    });
  };

  const load = async (): Promise<RecentFileRecord[]> => {
    if (cache) return cache;
    let raw: Uint8Array;
    try { raw = await fileSystem.readFile(path); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") { cache = []; return cache; }
      throw new RecentFilesError("unavailable");
    }
    let envelope: Envelope;
    try { envelope = parseEnvelope(JSON.parse(new TextDecoder().decode(raw))); }
    catch (error) { if (error instanceof RecentFilesError) throw error; throw new RecentFilesError("corrupt"); }
    const key = await options.keyStore.get(keyNamespace);
    if (!key) throw new RecentFilesError("locked");
    try {
      const ciphertext = Uint8Array.from(Buffer.from(envelope.ciphertext, "base64"));
      if (checksum(ciphertext) !== envelope.checksum) throw new RecentFilesError("locked");
      const plaintext = decryptDraft(key, { nonce: Uint8Array.from(Buffer.from(envelope.nonce, "base64")), ciphertext }, identity, envelope.generation);
      const records = parseRecords(JSON.parse(new TextDecoder().decode(plaintext)));
      generation = envelope.generation;
      cache = records;
      return records;
    } catch (error) {
      if (error instanceof RecentFilesError) throw error;
      throw new RecentFilesError("locked");
    }
  };

  const persist = async (records: RecentFileRecord[]): Promise<void> => {
    // An existing list whose key disappeared must never be replaced by a
    // list written under a fresh key: that would silently drop the old rows.
    const existingKey = await options.keyStore.get(keyNamespace);
    if (!existingKey && generation > 0) throw new RecentFilesError("locked");
    const key = existingKey ?? await options.keyStore.getOrCreate(keyNamespace);
    generation += 1;
    const encrypted = encryptDraft(key, new TextEncoder().encode(JSON.stringify({ version: 1, entries: records })), identity, generation, random);
    const row: Envelope = { version: 1, generation, checksum: checksum(encrypted.ciphertext), nonce: Buffer.from(encrypted.nonce).toString("base64"), ciphertext: Buffer.from(encrypted.ciphertext).toString("base64") };
    await fileSystem.mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.${Buffer.from(random(10)).toString("hex")}.tmp`;
    try {
      await fileSystem.writeFile(temporary, new TextEncoder().encode(JSON.stringify(row)), { flag: "wx", mode: 0o600 });
      await fileSystem.rename(temporary, path);
    } catch (error) {
      await fileSystem.rm(temporary, { force: true }).catch(() => undefined);
      if (error instanceof RecentFilesError) throw error;
      throw new RecentFilesError("unavailable");
    }
    cache = records;
  };

  const serialize = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = tail.then(operation, operation);
    tail = result.catch(() => undefined);
    return result;
  };

  const exists = async (path: string): Promise<boolean> => {
    try { await fileSystem.stat(path); return true; }
    catch { return false; }
  };

  return Object.freeze({
    idFor(path: string): string {
      return `recent_${createHash("sha256").update(resolve(path)).digest("hex").slice(0, 32)}`;
    },
    async list(): Promise<readonly RecentFileEntry[]> {
      const records = await serialize(load);
      const entries: RecentFileEntry[] = [];
      for (const record of records) entries.push({ id: record.id, name: record.name, directory: record.directory, modifiedAtMs: record.modifiedAtMs, updatedAt: record.updatedAt, missing: !(await exists(record.path)) });
      return entries;
    },
    async resolve(id: string): Promise<RecentFileRecord | undefined> {
      return (await serialize(load)).find((record) => record.id === id);
    },
    async record(input: { path: string; name: string; modifiedAtMs: number }): Promise<void> {
      await serialize(async () => {
        const records = await load();
        const id = `recent_${createHash("sha256").update(resolve(input.path)).digest("hex").slice(0, 32)}`;
        const next = records.filter((record) => record.id !== id);
        next.unshift({ id, path: resolve(input.path), name: basename(input.path) || input.name, directory: shortenDirectory(input.path), modifiedAtMs: input.modifiedAtMs, updatedAt: now() });
        await persist(next.slice(0, maxEntries));
      });
    },
    async remove(id: string): Promise<boolean> {
      return serialize(async () => {
        const records = await load();
        const next = records.filter((record) => record.id !== id);
        if (next.length === records.length) return false;
        await persist(next);
        return true;
      });
    },
  });
}

export type RecentFilesStore = ReturnType<typeof createRecentFilesStore>;
