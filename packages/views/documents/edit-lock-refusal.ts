// A content write sent from outside the editor (a version restore, a new file
// version) can be refused with 423 document_locked while the page still thinks
// it holds the lock. The sender reports the refusal here, and the document
// page that owns the lock session ends the hold like any lost lock (UNI-1645,
// CFE-1-12). A module-level map, not a store: nothing renders from it.

export type WriteRefusalListener = (fields: Record<string, unknown> | undefined, sentLockId: string | undefined) => void;

const listeners = new Map<string, Set<WriteRefusalListener>>();

/** The page that owns documentId's lock session listens; returns the unsubscribe. */
export function onWriteRefused(documentId: string, listener: WriteRefusalListener): () => void {
  const set = listeners.get(documentId) ?? new Set<WriteRefusalListener>();
  set.add(listener);
  listeners.set(documentId, set);
  return () => {
    set.delete(listener);
    if (set.size === 0) listeners.delete(documentId);
  };
}

/** `sentLockId` is the `edit_lock_id` the refused write carried (none when this tab held no lock). */
export function reportWriteRefused(documentId: string, fields: Record<string, unknown> | undefined, sentLockId: string | undefined): void {
  for (const listener of listeners.get(documentId) ?? []) listener(fields, sentLockId);
}
