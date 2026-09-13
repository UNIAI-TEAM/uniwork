import { useAuthStore } from "../auth/store";
import type { StorageAdapter } from "../types/storage";

/**
 * Whether a store registered here may accept a write: only while someone is
 * signed in.
 *
 * Logout clears these stores, but their writers outlive the logout call. The
 * comment composer flushes its debounced draft on unmount, and the sidebar
 * unmounts the page only after `await logout()`; its debounce timer, a send
 * the server accepts late, or a task query that resolves can all land while
 * the route transition keeps the page mounted. Each would put the previous
 * person's content back for the next person on this browser.
 * `useAuthStore.logout` sets `anon` before it runs the logout callback, so
 * every write from the cleanup onward is refused.
 *
 * Call it at the top of each write action, before `set`: zustand `persist`
 * writes storage on every `set`, even one that changes nothing.
 */
export function draftWritesAllowed(): boolean {
  return useAuthStore.getState().status === "authed";
}

/**
 * Self-registration registry for draft stores, replacing the hand-maintained
 * `WORKSPACE_SCOPED_KEYS` array in `platform/storage-cleanup.ts`.
 *
 * The old model required every new draft store to remember to append its
 * persist key to a list living in a different file; that list drifted and
 * left `uniwork_comment_drafts`, `uniwork_quick_create`, `uniwork_project_draft`,
 * `uniwork_feedback_draft`, and the chat draft-attachment / restore keys
 * uncleared on logout and workspace deletion (persistence-layer leak), while
 * the in-memory Zustand singletons kept a previous user's draft after a
 * client-side logout navigation (memory-layer leak, cross-user on a shared
 * profile).
 *
 * A store registers ONCE at module load via `registerDraftCleanup`. Cleanup
 * then iterates the registry, so adding a draft store can never again silently
 * skip cleanup.
 */
export interface DraftCleanupEntry {
  /**
   * Base persist key, before any workspace-slug suffix. For workspace-scoped
   * stores the real localStorage key is `${storageKey}:${slug}`.
   */
  storageKey: string;
  /**
   * True when persisted through `createWorkspaceAwareStorage` (key suffixed
   * with the active slug). False for globally-namespaced keys.
   */
  workspaceScoped: boolean;
  /**
   * Reset this store's in-memory state to empty. Called on logout so the
   * Zustand singleton cannot surface a previous user's draft after a
   * client-side navigation (no full page reload clears module singletons).
   */
  resetInMemory: () => void;
}

const entries = new Map<string, DraftCleanupEntry>();

/** Register a draft store for workspace/logout cleanup. Idempotent per key. */
export function registerDraftCleanup(entry: DraftCleanupEntry): void {
  entries.set(entry.storageKey, entry);
}

/**
 * Remove every registered draft's persisted storage for one workspace slug.
 * Called on workspace delete/leave (per slug) and logout (per workspace the
 * user belonged to). Globally-namespaced draft keys are removed regardless of
 * slug — passing any slug clears them once.
 */
export function clearRegisteredWorkspaceDrafts(
  adapter: StorageAdapter,
  slug: string,
): void {
  for (const entry of entries.values()) {
    if (entry.workspaceScoped) {
      adapter.removeItem(`${entry.storageKey}:${slug}`);
    } else {
      adapter.removeItem(entry.storageKey);
    }
  }
}

/**
 * Remove the persisted storage of every registered store whose key is global
 * (`workspaceScoped: false`). Called on logout, where no slug is at hand.
 *
 * Workspace-scoped keys are deliberately skipped: their real key is
 * `${storageKey}:${slug}` and there is no slug here to build it from.
 *
 * Call it AFTER `resetRegisteredDraftsInMemory`: a reset goes through zustand
 * `persist`, which writes the emptied state straight back under the same key.
 */
export function clearRegisteredGlobalDrafts(adapter: StorageAdapter): void {
  for (const entry of entries.values()) {
    if (!entry.workspaceScoped) adapter.removeItem(entry.storageKey);
  }
}

/**
 * Reset all registered draft stores' in-memory state. Called on logout, so no
 * draft survives into the next login on the same tab.
 *
 * This is the memory-layer half of cleanup and is deliberately separate from
 * `clearRegisteredWorkspaceDrafts`: clearing persisted storage does not touch
 * the Zustand singleton, which outlives a client-side logout navigation
 * (`replace(paths.login())` is not a page reload). Without this, user A's
 * unsent draft is still in module memory when user B signs in on the same tab.
 */
export function resetRegisteredDraftsInMemory(): void {
  for (const entry of entries.values()) {
    entry.resetInMemory();
  }
}

/** Test-only: drop all registrations. */
export function __clearDraftCleanupRegistryForTest(): void {
  entries.clear();
}

