/**
 * The web host's draft-recovery key (CONTRACT C18, amended by C18a). One AES-GCM
 * 256 key per signed-in user, non-extractable: generated once, then kept as a
 * structured-clone CryptoKey in the frame-drafts IndexedDB database (store
 * "keys", record key = userId), so a reload, a crash or a second tab of the
 * same user gets the same key back and the frame can still decrypt the drafts
 * it wrote. The key is never exported, so the raw bytes are never in storage or
 * on the server. Every genoffice frame gets it in `init` (again after a frame
 * reload). Sign-out or a user switch deletes the whole database, key and drafts
 * together. Where IndexedDB is unavailable (private mode) the key lives in this
 * module's memory only, and recovery then survives frame reloads, not page ones.
 */

/**
 * The frame-side IndexedDB database holding the encrypted drafts and, in the
 * "keys" store, their keys (same origin as the page). Not
 * "uniwork-office-drafts": that one belongs to the G3 web host
 * (apps/web/platform/office/draft-store.ts), whose drafts outlive sign-out.
 */
const OFFICE_DRAFTS_DB = "uniwork-office-frame-drafts";
const KEYS_STORE = "keys";
/** The frame's own store (fork web/docs/bridge/draft-recovery.ts) and version: it opens the database at 1. */
const DRAFTS_STORE = "drafts";
const DB_VERSION = 1;

interface SessionKey {
  readonly userId: string;
  readonly key: Promise<CryptoKey>;
  /** True once the key load has settled, so ending the session need not wait for it. */
  loaded: boolean;
}

let current: SessionKey | null = null;
/**
 * Resolves once the latest database delete has been issued. A key load waits
 * for that (not for the delete to finish): the browser queues an open behind a
 * delete of the same name, so a user switch cannot wipe the new user's key.
 */
let deleteIssued: Promise<void> = Promise.resolve();
/** Ends whose delete is still waiting for an earlier delete or a key load to go first. */
let deferredEnds = 0;

function generateKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

function openKeysDatabase(idb: IDBFactory): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = idb.open(OFFICE_DRAFTS_DB, DB_VERSION);
    // The frame opens this database at the same version and only creates its
    // "drafts" store on an upgrade, so whoever creates the database (this host,
    // before any frame loads) must create both stores.
    request.onupgradeneeded = () => {
      for (const name of [DRAFTS_STORE, KEYS_STORE]) {
        if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("indexeddb open failed"));
    request.onblocked = () => reject(new Error("indexeddb open blocked"));
  });
}

/**
 * The stored key of `userId`, or `fresh` stored in its place. The check and the
 * write share one readwrite transaction, which the browser serialises across
 * tabs: two tabs racing on first use end up with the same key.
 */
function storedKeyOrStore(db: IDBDatabase, userId: string, fresh: CryptoKey): Promise<CryptoKey> {
  return new Promise<CryptoKey>((resolve, reject) => {
    let result = fresh;
    const tx = db.transaction(KEYS_STORE, "readwrite");
    const store = tx.objectStore(KEYS_STORE);
    const read = store.get(userId);
    read.onsuccess = () => {
      if (read.result instanceof CryptoKey) result = read.result;
      else store.put(fresh, userId);
    };
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error ?? new Error("indexeddb transaction failed"));
    tx.onabort = () => reject(tx.error ?? new Error("indexeddb transaction aborted"));
  });
}

async function loadOrCreateKey(userId: string): Promise<CryptoKey> {
  await deleteIssued;
  const fresh = await generateKey();
  const idb = typeof indexedDB === "undefined" ? null : indexedDB;
  if (!idb) return fresh;
  let db: IDBDatabase | null = null;
  try {
    db = await openKeysDatabase(idb);
    // Never hold the database open against a delete from sign-out in another tab.
    db.onversionchange = () => db?.close();
    return await storedKeyOrStore(db, userId, fresh);
  } catch {
    // IndexedDB refuses (private mode, quota, a store that cannot hold a key):
    // a memory key still lets the frame recover across its own reloads.
    return fresh;
  } finally {
    db?.close();
  }
}

/**
 * The key for `userId`: the one persisted for that user, created on first need.
 * A different user than the current owner ends the old user's drafts first
 * (session switch).
 */
export function getOfficeDraftKey(userId: string): Promise<CryptoKey> {
  if (current && current.userId !== userId) void endOfficeDraftSession();
  if (!current) {
    const entry: SessionKey = { userId, key: loadOrCreateKey(userId), loaded: false };
    current = entry;
    void entry.key.then(
      () => { entry.loaded = true; },
      () => {
        // A failed load must not stick: the next caller tries again.
        entry.loaded = true;
        if (current === entry) current = null;
      },
    );
  }
  return current.key;
}

/** The scope a frame's drafts are keyed by: "<userId>:<documentId>". */
export function officeDraftScope(userId: string, documentId: string): string {
  return `${userId}:${documentId}`;
}

/**
 * Sign-out or session switch: forget the key and delete the whole database, the
 * drafts the frames wrote and the persisted keys with them. Resolves once the
 * browser answers; a blocked delete (a frame still has the database open)
 * completes when that frame goes away.
 */
export function endOfficeDraftSession(): Promise<void> {
  const previous = current;
  current = null;
  if ((!previous || previous.loaded) && deferredEnds === 0) {
    deleteIssued = Promise.resolve();
    return deleteDraftsDatabase();
  }
  // A key load still in flight (or an earlier delete) goes first, so the load
  // cannot recreate the database after the delete.
  deferredEnds += 1;
  const load = previous ? previous.key.then(() => undefined, () => undefined) : Promise.resolve();
  let finished: Promise<void> = Promise.resolve();
  deleteIssued = Promise.all([deleteIssued, load]).then(() => {
    deferredEnds -= 1;
    finished = deleteDraftsDatabase();
  });
  return deleteIssued.then(() => finished);
}

function deleteDraftsDatabase(): Promise<void> {
  const idb = typeof indexedDB === "undefined" ? null : indexedDB;
  if (!idb) return Promise.resolve();
  return new Promise<void>((resolve) => {
    let request: IDBOpenDBRequest;
    try {
      request = idb.deleteDatabase(OFFICE_DRAFTS_DB);
    } catch {
      resolve();
      return;
    }
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}
