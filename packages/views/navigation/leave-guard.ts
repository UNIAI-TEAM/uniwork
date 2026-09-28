"use client";

/**
 * Navigation guards for screens that must not be left silently.
 *
 * A screen that owns unsaved bytes registers a guard here; the host adapter
 * (apps/web/platform/navigation.tsx) asks every guard before it navigates, so
 * a sidebar link, a breadcrumb and a programmatic push are all covered. The
 * guard answers "may I leave?" — it is not a router hook, and a host without a
 * concept of blocking navigation simply never calls it.
 *
 * More than one guard may be registered; every guard must allow the move.
 */
export type LeaveGuard = (path: string) => Promise<boolean>;

const guards = new Set<LeaveGuard>();

/** Register a guard; the returned function removes it again. */
export function registerLeaveGuard(guard: LeaveGuard): () => void {
  guards.add(guard);
  return () => {
    guards.delete(guard);
  };
}

/** True when every registered guard allows the move (and none is registered). */
export async function leaveGuardAllows(path: string): Promise<boolean> {
  for (const guard of guards) {
    const allowed = await guard(path);
    if (!allowed) return false;
  }
  return true;
}
