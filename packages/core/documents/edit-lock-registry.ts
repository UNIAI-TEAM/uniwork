import { releaseDocumentEditLock } from "../api/endpoints/documents-edit-lock";

/**
 * The edit locks this tab holds (UNI-1645, addendum §9 FE-5), so sign-out can
 * release them while the session still has its token. A module-level map, not
 * a store: nothing renders from it. edit-lock-session.ts adds an entry when a
 * lock is granted and removes it when the lock is released or lost.
 */
const held = new Map<string, string>(); // lockId -> documentId

export function registerHeldEditLock(documentId: string, lockId: string): void {
  held.set(lockId, documentId);
}

export function forgetHeldEditLock(lockId: string): void {
  held.delete(lockId);
}

/**
 * The lock this tab holds on `documentId`, if any: the `edit_lock_id` a
 * content write sent from outside the editor (a version restore, a new file
 * version) carries, so the server lets the holder through (addendum §2).
 */
export function heldEditLockId(documentId: string): string | undefined {
  for (const [lockId, heldDocumentId] of held) if (heldDocumentId === documentId) return lockId;
  return undefined;
}

/** The locks held now, as [documentId, lockId] pairs (tests and diagnostics). */
export function heldEditLocks(): [string, string][] {
  return [...held].map(([lockId, documentId]) => [documentId, lockId]);
}

/**
 * Release every held lock with keepalive, waiting at most `maxWaitMs`.
 * Best effort: a failed or slow release is fine, because the server releases
 * the session's locks when the session is revoked (edge 10). Never rejects.
 */
export async function releaseHeldEditLocks(maxWaitMs = 1_000): Promise<void> {
  const locks = heldEditLocks();
  held.clear();
  if (locks.length === 0) return;
  const releases = Promise.allSettled(
    locks.map(([documentId, lockId]) => releaseDocumentEditLock(documentId, lockId, { keepalive: true })),
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, maxWaitMs);
  });
  try {
    await Promise.race([releases, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
