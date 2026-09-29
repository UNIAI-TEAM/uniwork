import { afterEach, describe, expect, it, vi } from "vitest";
import {
  runDraftRecoveryAdapterBehaviorSuite,
  type DraftRecoveryBehaviorHarness,
} from "@uniwork/core/office/draft-recovery.behavior";
import type { DraftRecoveryAdapter, DraftSession } from "@uniwork/core/office/draft-recovery";
import { createDraftStore, type IndexedDbDraftStore } from "./draft-store";

type Row = Record<string, unknown>;

class FakeRequest<T> {
  result!: T;
  error: DOMException | null = null;
  onsuccess: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onupgradeneeded: (() => void) | null = null;
  constructor(run: () => T, transaction?: FakeTransaction) {
    transaction?.start();
    queueMicrotask(() => {
      try {
        this.result = run();
        this.onsuccess?.();
      } catch (error) {
        this.error = error instanceof DOMException ? error : new DOMException(String(error));
        this.onerror?.();
      } finally {
        transaction?.end();
      }
    });
  }
}

class FakeTransaction {
  readonly mode: IDBTransactionMode;
  pending = 0;
  finished = false;
  oncomplete: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  error: DOMException | null = null;
  constructor(mode: IDBTransactionMode) {
    this.mode = mode;
  }
  start() { this.pending += 1; }
  end() { this.pending -= 1; this.completeIfReady(); }
  completeIfReady() {
    if (this.pending === 0) setTimeout(() => this.oncomplete?.(), 0);
  }
  abort() {
    this.error = new DOMException("aborted");
    this.onabort?.();
  }
}

class FakeStore {
  constructor(private readonly rows: Map<string, Row>, private readonly tx: FakeTransaction) {}
  get(key: string) { return new FakeRequest(() => clone(this.rows.get(key)) as Row | undefined, this.tx); }
  getAll() { return new FakeRequest(() => [...this.rows.values()].map((row) => clone(row)), this.tx); }
  put(row: Row) {
    return new FakeRequest(() => {
      this.rows.set(String(row.storageKey), clone(row));
      return row.storageKey;
    }, this.tx);
  }
  delete(key: string) { return new FakeRequest(() => { this.rows.delete(key); }, this.tx); }
}

class FakeDatabase {
  readonly objectStoreNames = { contains: (name: string) => name === "drafts" || name === "keys" };
  constructor(private readonly rows: Map<string, Row>) {}
  transaction(_name: string, mode: IDBTransactionMode) {
    const tx = new FakeTransaction(mode);
    const store = new FakeStore(this.rows, tx);
    return Object.assign(tx, { objectStore: () => store }) as unknown as IDBTransaction;
  }
  close() {}
}

class FakeIndexedDb {
  private readonly databases = new Map<string, FakeDatabase>();
  open(name: string, _version: number) {
    const request = new FakeRequest(() => {
      let database = this.databases.get(name);
      const isNew = !database;
      database ??= new FakeDatabase(new Map());
      this.databases.set(name, database);
      (request as FakeRequest<FakeDatabase>).result = database;
      if (isNew) request.onupgradeneeded?.();
      return database;
    });
    return request as FakeRequest<FakeDatabase> & { onupgradeneeded?: () => void; onblocked?: () => void };
  }
}

function clone<T>(value: T): T {
  if (value instanceof Uint8Array) return value.slice() as T;
  if (Array.isArray(value)) return value.map((entry) => clone(entry)) as T;
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, clone(entry)])) as T;
  return value;
}

const originalIndexedDb = globalThis.indexedDB;
afterEach(() => {
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: originalIndexedDb });
});

function sessions(): { accountA: DraftSession; accountB: DraftSession; accountAAfterRestart: DraftSession } {
  return {
    accountA: { sessionId: "session-a", deploymentId: "deployment-test", accountId: "account-a", generation: 1 },
    accountB: { sessionId: "session-b", deploymentId: "deployment-test", accountId: "account-b", generation: 1 },
    accountAAfterRestart: { sessionId: "session-a-restart", deploymentId: "deployment-test", accountId: "account-a", generation: 2 },
  };
}

function createHarness(): DraftRecoveryBehaviorHarness {
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: new FakeIndexedDb() });
  const adapter = createDraftStore({ databaseName: "test-office-drafts" });
  const current = sessions();
  return {
    adapter,
    sessions: current,
    revoke: (sessionId) => (adapter as IndexedDbDraftStore).revokeSession(sessionId),
    setLocked: (locked) => (adapter as IndexedDbDraftStore).setLocked(locked),
    failNextCheckpoint: () => (adapter as IndexedDbDraftStore).failNextCheckpoint(),
  };
}

describe("IndexedDB browser draft store", () => {
  it("passes the shared recovery behavior suite", async () => {
    const report = await runDraftRecoveryAdapterBehaviorSuite(createHarness);
    expect(report.passed.length).toBeGreaterThanOrEqual(10);
  });

  it("does not schedule unstable checkpoints and clears memory resources only", async () => {
    Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: new FakeIndexedDb() });
    const store = createDraftStore({ databaseName: "stable-only" });
    const cleanup = { calls: 0 };
    store.registerCleanup(() => { cleanup.calls += 1; });
    store.registerCleanup(() => { throw new Error("host cleanup failed"); });
    store.scheduleCheckpoint({
      session: sessions().accountA,
      snapshot: { draftId: "draft", identity: { deploymentId: "d", accountId: "a", organizationId: "o", workspaceId: "w", documentId: "doc", base: { revision: "r", version: "v" } }, generation: 1, checksum: "sha256:x", ciphertext: new Uint8Array([1]) },
      wrappedKey: new Uint8Array([2]),
    }, false);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(await store.list({ session: sessions().accountA })).toEqual([]);
    await store.clearMemory();
    expect(cleanup.calls).toBe(1);
  });

  it("surfaces a failed stable scheduled checkpoint when flushed", async () => {
    vi.useFakeTimers();
    try {
      Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: new FakeIndexedDb() });
      const store = createDraftStore({ databaseName: "scheduled-failure" });
      store.failNextCheckpoint();
      store.scheduleCheckpoint({
        session: sessions().accountA,
        snapshot: { draftId: "draft", identity: { deploymentId: "deployment-test", accountId: "account-a", organizationId: "o", workspaceId: "w", documentId: "doc", base: { revision: "r", version: "v" } }, generation: 1, checksum: "sha256:x", ciphertext: new Uint8Array([1]) },
        wrappedKey: new Uint8Array([2]),
      }, true);
      await vi.advanceTimersByTimeAsync(2_000);
      await expect(store.flushScheduled()).rejects.toMatchObject({ code: "storage_unavailable" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("surfaces an unavailable IndexedDB instead of claiming protection", async () => {
    Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: undefined });
    const store = createDraftStore();
    await expect(store.list({ session: sessions().accountA })).rejects.toMatchObject({ code: "storage_unavailable" });
  });
});
