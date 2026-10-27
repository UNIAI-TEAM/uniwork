/**
 * The device-side home of an in-person meeting recording (spec D2, D10). Every
 * chunk the browser hands over is written at once, so a closed tab, a dead
 * battery or a lost network loses at most the chunk in flight. Parts are keyed
 * by account and meeting, kept across sign-out, and deleted only once the
 * server has them or the person who recorded deletes them.
 */

/** One continuous file: a pause stays inside it, an interruption or device switch starts the next. */
export type RecordingPart = {
  id: string;
  userId: string;
  meetingId: string;
  startedAt: number;
  lastChunkAt: number;
  endedAt: number | null;
  mimeType: string;
  bytes: number;
  language: "vi" | "en";
  /** Seconds from the start of the recording's first part (wall-clock, pauses included). */
  offsetSeconds: number;
};

export interface RecordingStore {
  createPart(part: RecordingPart): Promise<void>;
  /** Saves one chunk and moves the part's `bytes` and `lastChunkAt` with it. */
  appendChunk(partId: string, seq: number, blob: Blob, at: number): Promise<void>;
  finishPart(partId: string, endedAt: number): Promise<void>;
  /** Oldest first. */
  listParts(userId: string, meetingId?: string): Promise<RecordingPart[]>;
  /** The part's chunks joined in `seq` order, typed with its `mimeType`. */
  readPart(partId: string): Promise<Blob>;
  deletePart(partId: string): Promise<void>;
}

const DB_NAME = "uniwork-meeting-recordings";
const PARTS = "parts";
const CHUNKS = "chunks";

/** A chunk as stored: bytes, not a Blob, which older Safari cannot keep in IndexedDB. */
type StoredChunk = { partId: string; seq: number; data: ArrayBuffer };

function request<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error("indexeddb request failed"));
  });
}

function committed(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("indexeddb transaction failed"));
    tx.onabort = () => reject(tx.error ?? new Error("indexeddb transaction aborted"));
  });
}

function openDatabase(idb: IDBFactory): Promise<IDBDatabase> {
  const open = idb.open(DB_NAME, 1);
  open.onupgradeneeded = () => {
    const db = open.result;
    db.createObjectStore(PARTS, { keyPath: "id" }).createIndex("userId", "userId");
    db.createObjectStore(CHUNKS, { keyPath: ["partId", "seq"] });
  };
  return request(open).then((db) => {
    // Never hold the database open against an upgrade from a newer tab.
    db.onversionchange = () => db.close();
    return db;
  });
}

function chunksOf(partId: string): IDBKeyRange {
  return IDBKeyRange.bound([partId, 0], [partId, Infinity]);
}

/** Changes one stored part in place; a part already deleted stays deleted. */
function updatePart(tx: IDBTransaction, partId: string, change: (part: RecordingPart) => RecordingPart): void {
  const parts = tx.objectStore(PARTS);
  const read = parts.get(partId);
  read.onsuccess = () => {
    const part = read.result as RecordingPart | undefined;
    if (part) parts.put(change(part));
  };
}

/** DB "uniwork-meeting-recordings" v1: "parts" (by id, indexed by userId) and "chunks" (by [partId, seq]). */
export function openRecordingStore(factory?: IDBFactory): RecordingStore {
  const idb = factory ?? (typeof indexedDB === "undefined" ? undefined : indexedDB);
  // shortcut: without IndexedDB (server render, a locked-down browser) the recording lives in this page's memory only.
  if (!idb) return memoryRecordingStore();
  let opening: Promise<IDBDatabase> | null = null;
  const transaction = async (mode: IDBTransactionMode): Promise<IDBTransaction> => {
    opening ??= openDatabase(idb).catch((cause: unknown) => {
      opening = null;
      throw cause;
    });
    const db = await opening;
    return db.transaction([PARTS, CHUNKS], mode);
  };

  return {
    async createPart(part) {
      const tx = await transaction("readwrite");
      tx.objectStore(PARTS).put(part);
      await committed(tx);
    },
    async appendChunk(partId, seq, blob, at) {
      // Read the bytes first: a transaction does not survive an await.
      const data = await blob.arrayBuffer();
      const tx = await transaction("readwrite");
      updatePart(tx, partId, (part) => {
        tx.objectStore(CHUNKS).put({ partId, seq, data } satisfies StoredChunk);
        return { ...part, bytes: part.bytes + blob.size, lastChunkAt: Math.max(part.lastChunkAt, at) };
      });
      await committed(tx);
    },
    async finishPart(partId, endedAt) {
      const tx = await transaction("readwrite");
      updatePart(tx, partId, (part) => ({ ...part, endedAt }));
      await committed(tx);
    },
    async listParts(userId, meetingId) {
      const tx = await transaction("readonly");
      const parts = (await request(tx.objectStore(PARTS).index("userId").getAll(userId))) as RecordingPart[];
      return parts.filter((p) => meetingId === undefined || p.meetingId === meetingId).sort((a, b) => a.startedAt - b.startedAt);
    },
    async readPart(partId) {
      const tx = await transaction("readonly");
      const [part, chunks] = await Promise.all([
        request(tx.objectStore(PARTS).get(partId)) as Promise<RecordingPart | undefined>,
        request(tx.objectStore(CHUNKS).getAll(chunksOf(partId))) as Promise<StoredChunk[]>,
      ]);
      if (!part) throw new Error("recording part not found");
      return new Blob(chunks.map((c) => c.data), { type: part.mimeType });
    },
    async deletePart(partId) {
      const tx = await transaction("readwrite");
      tx.objectStore(PARTS).delete(partId);
      tx.objectStore(CHUNKS).delete(chunksOf(partId));
      await committed(tx);
    },
  };
}

/** The same contract in memory: for tests, and the fallback where IndexedDB is missing. */
export function memoryRecordingStore(): RecordingStore {
  const parts = new Map<string, RecordingPart>();
  const chunks = new Map<string, Blob[]>();
  const update = (partId: string, change: (part: RecordingPart) => RecordingPart): boolean => {
    const part = parts.get(partId);
    if (part) parts.set(partId, change(part));
    return part !== undefined;
  };
  return {
    async createPart(part) {
      parts.set(part.id, { ...part });
      chunks.set(part.id, []);
    },
    async appendChunk(partId, seq, blob, at) {
      if (!update(partId, (p) => ({ ...p, bytes: p.bytes + blob.size, lastChunkAt: Math.max(p.lastChunkAt, at) }))) return;
      chunks.get(partId)![seq] = blob;
    },
    async finishPart(partId, endedAt) {
      update(partId, (p) => ({ ...p, endedAt }));
    },
    async listParts(userId, meetingId) {
      return [...parts.values()]
        .filter((p) => p.userId === userId && (meetingId === undefined || p.meetingId === meetingId))
        .sort((a, b) => a.startedAt - b.startedAt)
        .map((p) => ({ ...p }));
    },
    async readPart(partId) {
      const part = parts.get(partId);
      if (!part) throw new Error("recording part not found");
      // filter() skips the holes a missing seq leaves.
      return new Blob((chunks.get(partId) ?? []).filter(() => true), { type: part.mimeType });
    },
    async deletePart(partId) {
      parts.delete(partId);
      chunks.delete(partId);
    },
  };
}
