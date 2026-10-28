// UNI-2244: one workspace-documents refresh per folder access batch, however
// many paths report it. The tab that applied hears about a batch three ways:
// the apply result (sync), the status poll reaching `completed` (background),
// and the `document_access_batch.completed` frame (both, and it may land
// before the HTTP 200 because the outbox publishes after commit).
//
// Whoever asks first claims the batch and refreshes; every later asker skips.
// A claim is a plain "already refreshed" mark, so it is race-safe in either
// order, and a tab that never applied (other tab, other user) never claimed:
// its frame still gets the full invalidation. Only the batch id is read from
// a frame, to skip work; nothing from it is cached. Module memory, not a
// store: a claim is only useful for minutes and must not outlive the page.

const CLAIM_TTL_MS = 5 * 60 * 1000;

// Insertion order is claim order, so expired entries are always at the front.
const claims = new Map<string, number>();

/** True the first time `batchId` is claimed in `wsId` (caller refreshes), false while the claim is live (caller skips). */
export function claimAccessBatchRefresh(wsId: string, batchId: string): boolean {
  const now = Date.now();
  for (const [key, claimedAt] of claims) {
    if (now - claimedAt < CLAIM_TTL_MS) break;
    claims.delete(key);
  }
  const key = `${wsId}\u0000${batchId}`;
  if (claims.has(key)) return false;
  claims.set(key, now);
  return true;
}

/** Test seam: claims live in module memory, so a test file must start each case clean. */
export function resetAccessBatchRefreshClaims(): void {
  claims.clear();
}
