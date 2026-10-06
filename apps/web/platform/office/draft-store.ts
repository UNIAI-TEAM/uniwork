import {
  DraftRecoveryError,
  draftNamespace,
  metadataFromSnapshot,
  sameBase,
  type CheckpointResult,
  type DraftCheckpointRequest,
  type DraftDeleteRequest,
  type DraftIdentity,
  type DraftListRequest,
  type DraftMetadata,
  type DraftRecoveryAdapter,
  type DraftRecoveryRequest,
  type DraftSession,
  type DraftSnapshot,
  type RecoveryResult,
} from "../../../../packages/core/office/draft-recovery";

const DB_VERSION = 1;
const DRAFT_STORE = "drafts";

interface DurableDraftRecord {
  readonly storageKey: string;
  readonly draftId: string;
  readonly identity: DraftIdentity;
  readonly generation: number;
  readonly checksum: string;
  readonly ciphertext: Uint8Array;
  readonly wrappedKey?: Uint8Array;
  readonly updatedAt: number;
}

export interface DraftStoreOptions {
  readonly databaseName?: string;
  readonly now?: () => number;
}

export interface EncryptedCheckpointRequest extends DraftCheckpointRequest {
  readonly wrappedKey: Uint8Array;
}

export interface IndexedDbDraftStore extends DraftRecoveryAdapter {
  checkpointEncrypted(request: EncryptedCheckpointRequest): Promise<CheckpointResult>;
  /** Replace the previous base's checkpoint only after writing the new one. */
  rebaseEncrypted(request: EncryptedCheckpointRequest, previousIdentity: DraftIdentity): Promise<CheckpointResult>;
  recoverEncrypted(request: DraftRecoveryRequest): Promise<(Extract<RecoveryResult, { status: "recovered" }> & { readonly wrappedKey: Uint8Array }) | RecoveryResult>;
  /** Schedule a two-second checkpoint only after the caller says the snapshot is stable. */
  scheduleCheckpoint(request: EncryptedCheckpointRequest, stable: boolean): void;
  flushScheduled(): Promise<void>;
  revokeSession(sessionId: string): void;
  setLocked(locked: boolean): void;
  failNextCheckpoint(): void;
  registerObjectUrl(url: string): () => void;
  registerCleanup(cleanup: () => void): () => void;
}

/** IndexedDB draft adapter. It stores ciphertext and metadata only. */
export function createDraftStore(options: DraftStoreOptions = {}): IndexedDbDraftStore {
  return new BrowserDraftStore(options);
}

export class BrowserDraftStore implements IndexedDbDraftStore {
  private readonly databaseName: string;
  private readonly now: () => number;
  private databasePromise: Promise<IDBDatabase> | undefined;
  private readonly revokedSessions = new Set<string>();
  private readonly activeGenerations = new Map<string, number>();
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private readonly scheduled = new Set<Promise<unknown>>();
  private readonly scheduledErrors: unknown[] = [];
  private readonly objectUrls = new Set<string>();
  private readonly cleanups = new Set<() => void>();
  private locked = false;
  private failCheckpoint = false;

  constructor(options: DraftStoreOptions = {}) {
    this.databaseName = options.databaseName ?? "uniwork-office-drafts";
    this.now = options.now ?? Date.now;
  }

  async checkpoint({ session, snapshot }: DraftCheckpointRequest): Promise<CheckpointResult> {
    return this.writeCheckpoint(session, snapshot);
  }

  async checkpointEncrypted({ session, snapshot, wrappedKey }: EncryptedCheckpointRequest): Promise<CheckpointResult> {
    if (wrappedKey.byteLength === 0) throw new DraftRecoveryError("invalid_snapshot", "wrapped draft key must not be empty");
    return this.writeCheckpoint(session, snapshot, wrappedKey);
  }

  async rebaseEncrypted(request: EncryptedCheckpointRequest, previousIdentity: DraftIdentity): Promise<CheckpointResult> {
    const { base: _previousBase, ...previousScope } = previousIdentity;
    const { base: _nextBase, ...nextScope } = request.snapshot.identity;
    if (Object.keys(previousScope).some((key) => previousScope[key as keyof typeof previousScope] !== nextScope[key as keyof typeof nextScope])) {
      throw new DraftRecoveryError("forbidden", "draft rebase must keep the document scope");
    }
    if (request.wrappedKey.byteLength === 0) throw new DraftRecoveryError("invalid_snapshot", "wrapped draft key must not be empty");
    return this.writeCheckpoint(request.session, request.snapshot, request.wrappedKey, previousIdentity);
  }

  async list({ session, lookup }: DraftListRequest): Promise<readonly DraftMetadata[]> {
    this.assertSession(session);
    if (lookup) this.assertLookupScope(session, lookup);
    const records = await this.getAllRecords();
    return records.filter((record) => this.belongsToSession(record.identity, session) && this.matchesLookup(record, lookup)).map((record) => this.metadata(record));
  }

  async recover(request: DraftRecoveryRequest): Promise<RecoveryResult> {
    return this.recoverInternal(request);
  }

  async recoverEncrypted(request: DraftRecoveryRequest): Promise<(Extract<RecoveryResult, { status: "recovered" }> & { readonly wrappedKey: Uint8Array }) | RecoveryResult> {
    const result = await this.recoverInternal(request);
    if (result.status !== "recovered") return result;
    const record = await this.findRecord(request.session, request.lookup, request.currentBase);
    if (
      !record ||
      !record.wrappedKey ||
      record.generation !== result.metadata.generation ||
      record.checksum !== result.metadata.checksum
    ) {
      return { status: "locked", metadata: result.metadata, code: "draft_recovery_locked" };
    }
    return { ...result, wrappedKey: cloneBytes(record.wrappedKey) };
  }

  clearMemory(): void {
    this.objectUrls.forEach((url) => {
      try {
        URL.revokeObjectURL(url);
      } catch {
        // URL.revokeObjectURL may be unavailable in a non-DOM host.
      }
    });
    this.objectUrls.clear();
    for (const cleanup of this.cleanups) {
      try {
        cleanup();
      } catch {
        // One host callback must not prevent the remaining memory cleanup.
      }
    }
  }

  async deleteDurable({ session, draftId, generation }: DraftDeleteRequest): Promise<void> {
    this.assertSession(session);
    if (!draftId || !Number.isSafeInteger(generation) || generation < 1) throw new DraftRecoveryError("generation_conflict", "invalid compare-and-delete generation");
    const db = await this.openDatabase();
    await requestTransaction(db, "readwrite", async (store, finish) => {
      const all = await request<DurableDraftRecord[]>(store.getAll());
      const candidates = all.filter((record) => record.draftId === draftId);
      const owned = candidates.filter((record) => this.belongsToSession(record.identity, session));
      // Draft ids are intentionally checked against all namespaces so another
      // account cannot turn a guessed id into a harmless no-op.
      if (owned.length === 0) {
        if (candidates.length > 0) throw new DraftRecoveryError("forbidden", "draft is outside the active session");
        finish();
        return;
      }
      const target = owned.find((record) => record.generation === generation);
      if (!target) throw new DraftRecoveryError("generation_conflict", "draft generation changed before deletion");
      store.delete(target.storageKey);
      finish();
    });
  }

  scheduleCheckpoint(request: EncryptedCheckpointRequest, stable: boolean): void {
    if (!stable) return;
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      // A timer cannot throw into its caller. Retain the typed failure until
      // flushScheduled() is awaited so a host cannot mistake it for a durable
      // checkpoint.
      const operation = this.checkpointEncrypted(request).catch((error: unknown) => {
        this.scheduledErrors.push(error);
      });
      this.scheduled.add(operation);
      void operation.finally(() => this.scheduled.delete(operation));
    }, 2_000);
    this.timers.add(timer);
  }

  async flushScheduled(): Promise<void> {
    await Promise.all([...this.scheduled]);
    const error = this.scheduledErrors.shift();
    if (error !== undefined) throw error;
  }

  revokeSession(sessionId: string): void {
    this.revokedSessions.add(sessionId);
  }

  setLocked(locked: boolean): void {
    this.locked = locked;
  }

  failNextCheckpoint(): void {
    this.failCheckpoint = true;
  }

  registerObjectUrl(url: string): () => void {
    this.objectUrls.add(url);
    return () => this.objectUrls.delete(url);
  }

  registerCleanup(cleanup: () => void): () => void {
    this.cleanups.add(cleanup);
    return () => this.cleanups.delete(cleanup);
  }

  private async writeCheckpoint(session: DraftSession, snapshot: DraftSnapshot, wrappedKey?: Uint8Array, previousIdentity?: DraftIdentity): Promise<CheckpointResult> {
    this.assertSession(session);
    if (this.locked) throw new DraftRecoveryError("draft_recovery_locked", "draft store is locked");
    if (this.failCheckpoint) {
      this.failCheckpoint = false;
      throw new DraftRecoveryError("storage_unavailable", "draft transaction was rejected");
    }
    const metadata = metadataFromSnapshot(snapshot, this.now());
    this.assertSnapshotScope(session, snapshot.identity);
    const record: DurableDraftRecord = {
      storageKey: draftRecordKey(snapshot.identity, snapshot.draftId),
      draftId: snapshot.draftId,
      identity: cloneIdentity(snapshot.identity),
      generation: snapshot.generation,
      checksum: snapshot.checksum,
      ciphertext: cloneBytes(snapshot.ciphertext),
      ...(wrappedKey ? { wrappedKey: cloneBytes(wrappedKey) } : {}),
      updatedAt: metadata.updatedAt,
    };
    const db = await this.openDatabase();
    let result: CheckpointResult | undefined;
    await requestTransaction(db, "readwrite", async (store, finish) => {
      const previousKey = previousIdentity ? draftRecordKey(previousIdentity, snapshot.draftId) : record.storageKey;
      if (previousKey !== record.storageKey) {
        const old = await request<DurableDraftRecord | undefined>(store.get(previousKey));
        if (old && old.generation > record.generation) throw new DraftRecoveryError("generation_conflict", "a newer draft cannot be rebased backwards");
      }
      const previous = (await request<DurableDraftRecord | undefined>(store.get(record.storageKey))) ?? undefined;
      if (previous && previous.generation > record.generation) throw new DraftRecoveryError("generation_conflict", "draft generation moved backwards");
      if (previous && previous.generation === record.generation) {
        if (previous.checksum !== record.checksum) throw new DraftRecoveryError("generation_conflict", "generation is already bound to another checksum");
        result = { status: "unchanged", metadata: this.metadata(previous) };
        finish();
        return;
      }
      store.put(record);
      if (previousKey !== record.storageKey) store.delete(previousKey);
      result = { status: "stored", metadata };
      finish();
    });
    if (!result) throw new DraftRecoveryError("storage_unavailable", "draft transaction did not confirm");
    return result;
  }

  private async recoverInternal(request: DraftRecoveryRequest): Promise<RecoveryResult> {
    this.assertSession(request.session);
    this.assertLookupScope(request.session, request.lookup);
    if (request.liveAccess !== "edit") {
      const candidate = await this.findRecord(request.session, request.lookup, request.currentBase);
      return candidate ? { status: "blocked", metadata: this.metadata(candidate), reason: "edit_acl_missing" } : { status: "missing" };
    }
    if (this.locked) {
      const candidate = await this.findRecord(request.session, request.lookup, request.currentBase);
      return { status: "locked", ...(candidate ? { metadata: this.metadata(candidate) } : {}), code: "draft_recovery_locked" };
    }
    const records = (await this.getAllRecords()).filter((record) => this.belongsToSession(record.identity, request.session) && this.matchesLookup(record, request.lookup));
    if (records.length === 0) return { status: "missing" };
    if (!request.lookup.base && records.length > 1) return { status: "ambiguous", candidates: records.map((record) => this.metadata(record)) };
    const candidate = records[0];
    if (!candidate) return { status: "missing" };
    const metadata = this.metadata(candidate);
    if (!sameBase(candidate.identity.base, request.currentBase)) {
      return { status: "conflict", metadata, currentBase: request.currentBase, draftBase: candidate.identity.base };
    }
    return { status: "recovered", metadata, ciphertext: cloneBytes(candidate.ciphertext) };
  }

  private async findRecord(session: DraftSession, lookup: DraftListRequest["lookup"], currentBase: DraftRecoveryRequest["currentBase"]): Promise<DurableDraftRecord | undefined> {
    const records = (await this.getAllRecords()).filter((record) => this.belongsToSession(record.identity, session) && this.matchesLookup(record, lookup));
    return records.find((record) => sameBase(record.identity.base, currentBase)) ?? records[0];
  }

  private matchesLookup(record: DurableDraftRecord, lookup: DraftListRequest["lookup"]): boolean {
    if (!lookup) return true;
    const identity = record.identity;
    return identity.deploymentId === lookup.deploymentId && identity.accountId === lookup.accountId && identity.organizationId === lookup.organizationId && identity.workspaceId === lookup.workspaceId && identity.documentId === lookup.documentId && (!lookup.draftId || record.draftId === lookup.draftId) && (!lookup.base || sameBase(identity.base, lookup.base));
  }

  private assertLookupScope(session: DraftSession, lookup: NonNullable<DraftListRequest["lookup"]>): void {
    if (lookup.deploymentId !== session.deploymentId || lookup.accountId !== session.accountId) throw new DraftRecoveryError("forbidden", "draft lookup is outside the active session");
  }

  private assertSnapshotScope(session: DraftSession, identity: DraftIdentity): void {
    if (identity.deploymentId !== session.deploymentId || identity.accountId !== session.accountId) throw new DraftRecoveryError("forbidden", "draft is outside the active session");
  }

  private belongsToSession(identity: DraftIdentity, session: DraftSession): boolean {
    return identity.deploymentId === session.deploymentId && identity.accountId === session.accountId;
  }

  private assertSession(session: DraftSession): void {
    if (!session.sessionId || !session.deploymentId || !session.accountId || !Number.isSafeInteger(session.generation) || session.generation < 1) throw new DraftRecoveryError("token_expired", "draft session is invalid");
    if (this.revokedSessions.has(session.sessionId)) throw new DraftRecoveryError("token_expired", "draft session is no longer active");
    const scope = `${session.deploymentId}:${session.accountId}`;
    const active = this.activeGenerations.get(scope);
    if (active !== undefined && session.generation < active) throw new DraftRecoveryError("token_expired", "draft session generation is stale");
    this.activeGenerations.set(scope, Math.max(active ?? 0, session.generation));
  }

  private metadata(record: DurableDraftRecord): DraftMetadata {
    return {
      draftId: record.draftId,
      identity: cloneIdentity(record.identity),
      generation: record.generation,
      checksum: record.checksum,
      byteLength: record.ciphertext.byteLength,
      updatedAt: record.updatedAt,
    };
  }

  private async getAllRecords(): Promise<DurableDraftRecord[]> {
    const db = await this.openDatabase();
    return requestTransaction(db, "readonly", async (store, finish) => {
      const records = await request<DurableDraftRecord[]>(store.getAll());
      finish();
      return records.map((record) => ({ ...record, ciphertext: cloneBytes(record.ciphertext), ...(record.wrappedKey ? { wrappedKey: cloneBytes(record.wrappedKey) } : {}) }));
    });
  }

  private openDatabase(): Promise<IDBDatabase> {
    if (typeof indexedDB === "undefined") return Promise.reject(new DraftRecoveryError("storage_unavailable", "IndexedDB is unavailable in this browser"));
    this.databasePromise ??= new Promise((resolve, reject) => {
      const open = indexedDB.open(this.databaseName, DB_VERSION);
      open.onupgradeneeded = () => {
        if (!open.result.objectStoreNames.contains(DRAFT_STORE)) open.result.createObjectStore(DRAFT_STORE, { keyPath: "storageKey" });
      };
      open.onerror = () => reject(new DraftRecoveryError("storage_unavailable", "could not open the draft database"));
      open.onblocked = () => reject(new DraftRecoveryError("storage_unavailable", "draft database upgrade is blocked"));
      open.onsuccess = () => resolve(open.result);
    });
    return this.databasePromise;
  }
}

function draftRecordKey(identity: DraftIdentity, draftId: string): string {
  return `${draftNamespace(identity)}|draft:${encodeURIComponent(draftId)}`;
}

function cloneIdentity(identity: DraftIdentity): DraftIdentity {
  return { ...identity, base: { ...identity.base } };
}

function cloneBytes(bytes: Uint8Array): Uint8Array {
  return bytes.slice();
}

function request<T>(idbRequest: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    idbRequest.onsuccess = () => resolve(idbRequest.result);
    idbRequest.onerror = () => reject(asStorageError(idbRequest.error, "IndexedDB request failed"));
  });
}

function asStorageError(error: unknown, message: string): DraftRecoveryError {
  if (error instanceof DraftRecoveryError) return error;
  if (error instanceof DOMException && error.name === "QuotaExceededError") {
    return new DraftRecoveryError("quota_exceeded", message);
  }
  return new DraftRecoveryError("storage_unavailable", message);
}

async function requestTransaction<T>(db: IDBDatabase, mode: IDBTransactionMode, operation: (store: IDBObjectStore, finish: () => void) => Promise<T | void>): Promise<T> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(DRAFT_STORE, mode);
    const store = transaction.objectStore(DRAFT_STORE);
    let value: T | undefined;
    let finished = false;
    let operationFailure: unknown;
    const finish = () => {
      finished = true;
    };
    transaction.oncomplete = () => {
      if (!finished && mode === "readwrite") {
        reject(new DraftRecoveryError("storage_unavailable", "draft transaction did not confirm"));
        return;
      }
      resolve(value as T);
    };
    transaction.onerror = () => reject(asStorageError(transaction.error, "draft transaction failed"));
    transaction.onabort = () => {
      if (operationFailure !== undefined) return;
      reject(asStorageError(transaction.error, "draft transaction aborted"));
    };
    void operation(store, finish).then((result) => {
      value = result as T;
      if (mode === "readonly") finished = true;
    }).catch((error: unknown) => {
      operationFailure = error;
      try {
        transaction.abort();
      } catch {
        // The transaction may already have completed; its original error wins.
      }
      reject(error);
    });
  });
}

export const createIndexedDbDraftStore = createDraftStore;
