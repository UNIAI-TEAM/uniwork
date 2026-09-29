import { createHash, randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  cloneCiphertext,
  draftNamespace,
  DraftRecoveryError,
  metadataFromSnapshot,
  sameBase,
  type CheckpointResult,
  type DraftCheckpointRequest,
  type DraftDeleteRequest,
  type DraftIdentity,
  type DraftListRequest,
  type DraftLookup,
  type DraftMetadata,
  type DraftRecoveryAdapter,
  type DraftRecoveryRequest,
  type RecoveryResult,
  type DraftSession,
  type DraftSnapshot,
} from "../../../../packages/core/office/draft-recovery";
import { checksum, decryptDraft, encryptDraft } from "./crypto";

export interface DraftKeyStore {
  /** A draft key is intentionally a separate port from refresh credentials. */
  getOrCreate(namespace: string): Promise<Uint8Array>;
  delete?(namespace: string): Promise<void>;
}

interface DesktopDraftStoreOptions {
  readonly rootDirectory: string;
  readonly keyStore: DraftKeyStore;
  readonly maxPlaintextBytes?: number;
  readonly tempDirectory?: string;
  readonly now?: () => number;
  readonly randomBytes?: (size: number) => Uint8Array;
}

interface PlaintextCheckpoint {
  readonly session: DraftSession;
  readonly identity: DraftIdentity;
  readonly draftId: string;
  readonly generation: number;
  readonly plaintext: Uint8Array;
}

interface DurableRow {
  readonly version: 1;
  readonly encrypted: boolean;
  readonly draftId: string;
  readonly identity: DraftIdentity;
  readonly generation: number;
  readonly checksum: string;
  readonly byteLength: number;
  readonly updatedAt: number;
  readonly nonce?: string;
  readonly ciphertext: string;
}

/** Main-only encrypted draft store. It stores JSON envelopes atomically; the
 * envelope contains no plaintext or raw key, and its key is obtained from the
 * independent OS KeyStore port. */
export class DesktopDraftStore implements DraftRecoveryAdapter {
  private readonly maxPlaintextBytes: number;
  private readonly now: () => number;
  private readonly random: (size: number) => Uint8Array;
  private readonly revoked = new Set<string>();
  private readonly activeGenerations = new Map<string, number>();
  private locked = false;
  private failNext = false;
  private pending?: { input: PlaintextCheckpoint; timer: ReturnType<typeof setTimeout> };

  constructor(private readonly options: DesktopDraftStoreOptions) {
    if (!options.rootDirectory || !options.keyStore) throw new TypeError("draft store configuration is incomplete");
    this.maxPlaintextBytes = options.maxPlaintextBytes ?? 64 * 1024 * 1024;
    this.now = options.now ?? (() => Date.now());
    this.random = options.randomBytes ?? ((size) => randomBytes(size));
  }

  async checkpoint(request: DraftCheckpointRequest): Promise<CheckpointResult> {
    this.assertSession(request.session, request.snapshot.identity);
    this.assertWritable();
    const metadata = metadataFromSnapshot(request.snapshot, this.now());
    const existing = await this.readRow(request.snapshot.identity, request.snapshot.draftId);
    if (existing && existing.generation > metadata.generation) throw new DraftRecoveryError("generation_conflict", "draft generation is older than the confirmed snapshot");
    if (existing && existing.generation === metadata.generation && existing.checksum === metadata.checksum) return { status: "unchanged", metadata: rowMetadata(existing) };
    await this.writeRow(request.snapshot.identity, { version: 1, encrypted: false, draftId: request.snapshot.draftId, identity: request.snapshot.identity, generation: metadata.generation, checksum: metadata.checksum, byteLength: request.snapshot.ciphertext.byteLength, updatedAt: metadata.updatedAt, ciphertext: Buffer.from(request.snapshot.ciphertext).toString("base64") });
    return { status: "stored", metadata };
  }

  async checkpointPlaintext(input: PlaintextCheckpoint): Promise<DraftMetadata> {
    this.assertSession(input.session, input.identity);
    this.assertWritable();
    if (input.plaintext.byteLength > this.maxPlaintextBytes) throw new DraftRecoveryError("quota_exceeded", "draft exceeds the local size limit");
    if (!Number.isSafeInteger(input.generation) || input.generation < 1) throw new DraftRecoveryError("invalid_snapshot", "draft generation is invalid");
    const old = await this.readRow(input.identity, input.draftId);
    if (old && old.generation > input.generation) throw new DraftRecoveryError("generation_conflict", "draft generation is older than the confirmed snapshot");
    const namespace = namespaceFor(input.identity);
    let encrypted;
    try { encrypted = encryptDraft(await this.options.keyStore.getOrCreate(namespace), input.plaintext, input.identity, input.generation, this.random); }
    catch { throw new DraftRecoveryError("draft_recovery_locked", "draft key is unavailable"); }
    const row: DurableRow = { version: 1, encrypted: true, draftId: input.draftId, identity: input.identity, generation: input.generation, checksum: encrypted.checksum, byteLength: encrypted.ciphertext.byteLength, updatedAt: this.now(), nonce: Buffer.from(encrypted.nonce).toString("base64"), ciphertext: Buffer.from(encrypted.ciphertext).toString("base64") };
    await this.writeRow(input.identity, row);
    return rowMetadata(row);
  }

  async list(request: DraftListRequest): Promise<readonly DraftMetadata[]> {
    this.assertSessionLookup(request.session, request.lookup);
    this.assertReadable();
    const rows = await this.readAllRows();
    return rows.filter((row) => matchesLookup(row, request.lookup)).map(rowMetadata).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async recover(request: DraftRecoveryRequest): Promise<RecoveryResult> {
    this.assertSessionLookup(request.session, request.lookup);
    if (this.locked) {
      try {
        const candidate = (await this.readAllRows()).find((row) => matchesLookup(row, request.lookup));
        return { status: "locked", ...(candidate ? { metadata: rowMetadata(candidate) } : {}), code: "draft_recovery_locked" };
      } catch (error) {
        if (error instanceof DraftRecoveryError && error.code === "draft_recovery_locked") return { status: "locked", code: "draft_recovery_locked" };
        throw error;
      }
    }
    const candidates = (await this.readAllRows()).filter((row) => matchesLookup(row, request.lookup));
    if (candidates.length === 0) return { status: "missing" };
    if (!request.lookup.base && candidates.length > 1) return { status: "ambiguous", candidates: candidates.map(rowMetadata) };
    const row = candidates.find((candidate) => !request.lookup.base || sameBase(candidate.identity.base, request.lookup.base));
    if (!row) return { status: "conflict", metadata: rowMetadata(candidates[0]!), currentBase: request.currentBase, draftBase: candidates[0]!.identity.base };
    if (!sameBase(row.identity.base, request.currentBase)) return { status: "conflict", metadata: rowMetadata(row), currentBase: request.currentBase, draftBase: row.identity.base };
    if (request.liveAccess !== "edit") return { status: "blocked", metadata: rowMetadata(row), reason: "edit_acl_missing" };
    const ciphertext = Uint8Array.from(Buffer.from(row.ciphertext, "base64"));
    if (row.encrypted && checksum(ciphertext) !== row.checksum) return { status: "locked", metadata: rowMetadata(row), code: "draft_recovery_locked" };
    return { status: "recovered", metadata: rowMetadata(row), ciphertext };
  }

  async recoverPlaintext(request: DraftRecoveryRequest): Promise<{ readonly status: "recovered"; readonly metadata: DraftMetadata; readonly plaintext: Uint8Array } | Exclude<RecoveryResult, { status: "recovered" }>> {
    const recovered = await this.recover(request);
    if (recovered.status !== "recovered") return recovered;
    const row = await this.readRow(recovered.metadata.identity, recovered.metadata.draftId);
    if (!row) return { status: "missing" };
    if (!row.encrypted || !row.nonce) return { status: "locked", metadata: recovered.metadata, code: "draft_recovery_locked" };
    try {
      const key = await this.options.keyStore.getOrCreate(namespaceFor(row.identity));
      const plaintext = decryptDraft(key, { nonce: Uint8Array.from(Buffer.from(row.nonce, "base64")), ciphertext: recovered.ciphertext }, row.identity, row.generation);
      if (plaintext.byteLength > this.maxPlaintextBytes) throw new Error("draft exceeds local limit");
      return { status: "recovered", metadata: recovered.metadata, plaintext };
    } catch { return { status: "locked", metadata: recovered.metadata, code: "draft_recovery_locked" }; }
  }

  async deleteDurable(request: DraftDeleteRequest): Promise<void> {
    this.assertActiveSession(request.session);
    this.assertWritable();
    const rows = await this.readAllRows();
    const byId = rows.find((candidate) => candidate.draftId === request.draftId);
    if (byId && (byId.identity.accountId !== request.session.accountId || byId.identity.deploymentId !== request.session.deploymentId)) throw new DraftRecoveryError("forbidden", "draft is outside the active session");
    const row = byId;
    if (!row) return;
    if (row.generation !== request.generation) throw new DraftRecoveryError("generation_conflict", "draft generation changed");
    await fs.unlink(fileFor(this.options.rootDirectory, row.identity, row.draftId)).catch(() => undefined);
  }

  clearMemory(): void { /* decrypted buffers are returned by value and never retained */ }
  revokeSession(sessionId: string): void { this.revoked.add(sessionId); }
  setLocked(locked: boolean): void { this.locked = locked; }
  failNextCheckpoint(): void { this.failNext = true; }

  scheduleCheckpoint(input: PlaintextCheckpoint, stable: boolean): void {
    if (!stable) return;
    if (this.pending) clearTimeout(this.pending.timer);
    const timer = setTimeout(() => { this.pending = undefined; void this.checkpointPlaintext(input).catch(() => undefined); }, 2_000);
    this.pending = { input, timer };
  }

  async flushScheduled(): Promise<void> {
    const pending = this.pending;
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending = undefined;
    await this.checkpointPlaintext(pending.input);
  }

  /** Bounded lifecycle-managed plaintext temp for native engine adapters. */
  async withPlaintextTemp<T>(plaintext: Uint8Array, callback: (path: string) => Promise<T>): Promise<T> {
    if (plaintext.byteLength > this.maxPlaintextBytes) throw new DraftRecoveryError("quota_exceeded", "plaintext temp exceeds the local size limit");
    const root = this.options.tempDirectory ?? tmpdir();
    const directory = await fs.mkdtemp(join(root, "uniwork-office-draft-"));
    const path = join(directory, "snapshot.bin");
    try { await fs.writeFile(path, plaintext, { mode: 0o600 }); return await callback(path); }
    finally { await fs.rm(directory, { recursive: true, force: true }).catch(() => undefined); }
  }

  private assertWritable(): void { if (this.locked) throw new DraftRecoveryError("draft_recovery_locked", "draft store is locked"); if (this.failNext) { this.failNext = false; throw new DraftRecoveryError("storage_unavailable", "draft checkpoint was not durable"); } }
  private assertReadable(): void { if (this.locked) throw new DraftRecoveryError("draft_recovery_locked", "draft store is locked"); }
  private assertSession(session: DraftSession, identity: DraftIdentity): void { this.assertActiveSession(session); if (session.accountId !== identity.accountId || session.deploymentId !== identity.deploymentId) throw new DraftRecoveryError("forbidden", "draft identity is outside the session scope"); }
  private assertSessionLookup(session: DraftSession, lookup?: DraftLookup): void { this.assertActiveSession(session); if (lookup && (lookup.accountId !== session.accountId || lookup.deploymentId !== session.deploymentId)) throw new DraftRecoveryError("forbidden", "draft lookup is outside the session scope"); }
  private assertActiveSession(session: DraftSession): void {
    if (!session.sessionId || !session.accountId || !session.deploymentId || !Number.isSafeInteger(session.generation) || session.generation < 1 || this.revoked.has(session.sessionId)) throw new DraftRecoveryError("token_expired", "draft session is no longer active");
    const scope = `${session.deploymentId}:${session.accountId}`;
    const active = this.activeGenerations.get(scope);
    if (active !== undefined && session.generation < active) throw new DraftRecoveryError("token_expired", "draft session generation is stale");
    this.activeGenerations.set(scope, Math.max(active ?? 0, session.generation));
  }

  private async readRow(identity: DraftIdentity, draftId: string): Promise<DurableRow | undefined> {
    try { const raw = await fs.readFile(fileFor(this.options.rootDirectory, identity, draftId), "utf8"); const row = JSON.parse(raw) as DurableRow; return validRow(row) ? row : undefined; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw new DraftRecoveryError("storage_unavailable", "draft store could not be read"); }
  }

  private async readAllRows(): Promise<DurableRow[]> {
    try {
      await fs.mkdir(this.options.rootDirectory, { recursive: true });
      const namespaces = await fs.readdir(this.options.rootDirectory, { withFileTypes: true });
      const rows: DurableRow[] = [];
      for (const namespace of namespaces) {
        if (!namespace.isDirectory()) continue;
        for (const file of await fs.readdir(join(this.options.rootDirectory, namespace.name))) {
          if (!file.endsWith(".draft")) continue;
          try { const row = JSON.parse(await fs.readFile(join(this.options.rootDirectory, namespace.name, file), "utf8")) as DurableRow; if (validRow(row)) rows.push(row); } catch { throw new DraftRecoveryError("draft_recovery_locked", "draft record is corrupt"); }
        }
      }
      return rows;
    } catch (error) { if (error instanceof DraftRecoveryError) throw error; throw new DraftRecoveryError("storage_unavailable", "draft store could not be read"); }
  }

  private async writeRow(identity: DraftIdentity, row: DurableRow): Promise<void> {
    const path = fileFor(this.options.rootDirectory, identity, row.draftId);
    const directory = dirname(path);
    const temp = `${path}.${Buffer.from(this.random(12)).toString("hex")}.tmp`;
    await fs.mkdir(directory, { recursive: true });
    try {
      await fs.writeFile(temp, JSON.stringify(row), { encoding: "utf8", mode: 0o600 });
      const handle = await fs.open(temp, "r+");
      try { await handle.sync(); } finally { await handle.close(); }
      await fs.rename(temp, path);
    } catch { await fs.rm(temp, { force: true }).catch(() => undefined); throw new DraftRecoveryError("storage_unavailable", "draft checkpoint was not durable"); }
  }
}

export function createDesktopDraftStore(options: DesktopDraftStoreOptions): DesktopDraftStore { return new DesktopDraftStore(options); }

function namespaceFor(identity: DraftIdentity): string { return createHash("sha256").update(draftNamespace(identity)).digest("hex"); }
function fileFor(root: string, identity: DraftIdentity, draftId: string): string { const draftHash = createHash("sha256").update(draftId).digest("hex"); return join(root, namespaceFor(identity), `${draftHash}.draft`); }
function rowMetadata(row: DurableRow): DraftMetadata { return { draftId: row.draftId, identity: row.identity, generation: row.generation, checksum: row.checksum, byteLength: row.byteLength, updatedAt: row.updatedAt }; }
function matchesLookup(row: DurableRow, lookup?: DraftLookup): boolean { if (!lookup) return true; return row.identity.deploymentId === lookup.deploymentId && row.identity.accountId === lookup.accountId && row.identity.organizationId === lookup.organizationId && row.identity.workspaceId === lookup.workspaceId && row.identity.documentId === lookup.documentId && (!lookup.draftId || row.draftId === lookup.draftId) && (!lookup.base || sameBase(row.identity.base, lookup.base)); }
function validRow(row: DurableRow): boolean { return row?.version === 1 && typeof row.draftId === "string" && typeof row.identity === "object" && Number.isSafeInteger(row.generation) && row.generation > 0 && typeof row.checksum === "string" && typeof row.ciphertext === "string" && (!row.encrypted || typeof row.nonce === "string"); }
