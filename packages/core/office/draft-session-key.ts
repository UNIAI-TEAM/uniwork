/**
 * The web host's draft-recovery session key (CONTRACT C18). One AES-GCM 256
 * key per signed-in session, generated non-extractable and held in this
 * module's memory only: never storage, never the server. Every genoffice
 * frame of the session gets it in `init` (again after a frame reload), so the
 * frame can encrypt its IndexedDB draft copies and read them back while the
 * session lasts. A new session gets a new key, so drafts written under the old
 * one cannot be read, and sign-out deletes them outright.
 */

/**
 * The frame-side IndexedDB database holding the encrypted drafts (same origin
 * as the page). Not "uniwork-office-drafts": that one belongs to the G3 web
 * host (apps/web/platform/office/draft-store.ts), whose drafts outlive sign-out.
 */
const OFFICE_DRAFTS_DB = "uniwork-office-frame-drafts";

interface SessionKey {
  readonly userId: string;
  readonly key: Promise<CryptoKey>;
}

let current: SessionKey | null = null;

/**
 * The session's key for `userId`, generated on first use. A different user
 * than the key's owner ends the old session's drafts first (session switch).
 */
export function getOfficeDraftKey(userId: string): Promise<CryptoKey> {
  if (current && current.userId !== userId) void endOfficeDraftSession();
  if (!current) {
    const key = crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    const entry: SessionKey = { userId, key };
    current = entry;
    // A failed generation must not stick: the next caller tries again.
    void key.catch(() => { if (current === entry) current = null; });
  }
  return current.key;
}

/** The scope a frame's drafts are keyed by: "<userId>:<documentId>". */
export function officeDraftScope(userId: string, documentId: string): string {
  return `${userId}:${documentId}`;
}

/**
 * Sign-out or session switch: forget the key and delete every draft the frames
 * wrote. Resolves once the browser answers; a blocked delete (a frame still has
 * the database open) completes when that frame goes away.
 */
export function endOfficeDraftSession(): Promise<void> {
  current = null;
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
