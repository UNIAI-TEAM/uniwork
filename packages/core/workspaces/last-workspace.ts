import { defaultStorage } from "../platform/storage";
import type { WorkspaceRef } from "../paths/resolve";

// Keyed by user and kept across logout: a shared browser must not hand one
// person's workspace to the next, and the same person signing back in should
// land where they left off.
const key = (userId: string) => `uniwork_last_workspace:${userId}`;

export function rememberLastWorkspace(userId: string, ref: WorkspaceRef): void {
  defaultStorage.setItem(key(userId), JSON.stringify(ref));
}

export function readLastWorkspace(userId: string): WorkspaceRef | null {
  const raw = defaultStorage.getItem(key(userId));
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return null;
    const { orgSlug, wsSlug } = value as Record<string, unknown>;
    return typeof orgSlug === "string" && typeof wsSlug === "string" ? { orgSlug, wsSlug } : null;
  } catch {
    return null;
  }
}
