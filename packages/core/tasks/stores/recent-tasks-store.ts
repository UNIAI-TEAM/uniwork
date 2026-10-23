"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { draftWriteOwner, registerDraftCleanup } from "../../drafts/cleanup-registry";
import { defaultStorage } from "../../platform/storage";

/** Shared by the store and its cleanup registration so the two cannot drift. */
const RECENT_TASKS_STORAGE_KEY = "uniwork_recent_tasks";
const MAX_TASKS_PER_WORKSPACE = 20;
const MAX_WORKSPACES = 50;

interface RecentTaskEntry {
  id: string;
  identifier: string;
  title: string;
  /** Visit stamp in ms, bumped past the latest one so order never ties. */
  visitedAt: number;
}

/**
 * Module-level empty list. The selector falls back to THIS array, never to a
 * fresh `[]`: a new reference on every read makes zustand report a changed
 * snapshot each render and re-render (or loop) every reader.
 */
const EMPTY_RECENT_TASKS: readonly RecentTaskEntry[] = [];

interface RecentTasksState {
  /** Newest visit first, per workspace id. */
  byWorkspace: Record<string, RecentTaskEntry[]>;
  /** Id of the user who recorded `byWorkspace`, persisted with it; see `isOwnedBy`. */
  ownerId: string | null;
  recordVisit: (workspaceId: string, entry: Omit<RecentTaskEntry, "visitedAt">) => void;
  /** Drop a task that no longer exists. */
  forget: (workspaceId: string, taskId: string) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function newestStamp(bucket: readonly RecentTaskEntry[]): number {
  return bucket[0]?.visitedAt ?? 0;
}

/** Keep the `MAX_WORKSPACES` workspaces with the most recent visit. */
function capWorkspaces(
  byWorkspace: Record<string, RecentTaskEntry[]>,
): Record<string, RecentTaskEntry[]> {
  const entries = Object.entries(byWorkspace);
  if (entries.length <= MAX_WORKSPACES) return byWorkspace;
  entries.sort(([, a], [, b]) => newestStamp(b) - newestStamp(a));
  return Object.fromEntries(entries.slice(0, MAX_WORKSPACES));
}

/** Drop malformed entries and duplicates; the persisted order is newest first. */
function sanitizeBucket(raw: unknown): RecentTaskEntry[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const bucket: RecentTaskEntry[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const { id, identifier, title, visitedAt } = item;
    if (typeof id !== "string" || id === "" || seen.has(id)) continue;
    if (typeof identifier !== "string" || typeof title !== "string") continue;
    seen.add(id);
    bucket.push({
      id,
      identifier,
      title,
      visitedAt: typeof visitedAt === "number" && Number.isFinite(visitedAt) ? visitedAt : 0,
    });
    if (bucket.length === MAX_TASKS_PER_WORKSPACE) break;
  }
  return bucket;
}

function sanitizeByWorkspace(value: unknown): Record<string, RecentTaskEntry[]> {
  if (!isRecord(value)) return {};
  const byWorkspace: Record<string, RecentTaskEntry[]> = {};
  for (const [workspaceId, raw] of Object.entries(value)) {
    const bucket = sanitizeBucket(raw);
    if (bucket.length > 0) byWorkspace[workspaceId] = bucket;
  }
  return capWorkspaces(byWorkspace);
}

/**
 * Tasks the person opened recently, per workspace, for the search palette.
 * One global storage key; the value is split by workspace id inside.
 */
export const useRecentTasksStore = create<RecentTasksState>()(
  persist(
    (set) => ({
      byWorkspace: {},
      ownerId: null,
      // Both writes are refused while signed out, and record the signed-in
      // user as the owner otherwise: see `draftWriteOwner`.
      recordVisit: (workspaceId, entry) => {
        const ownerId = draftWriteOwner();
        if (ownerId === null) return;
        set((state) => {
          let latest = 0;
          for (const bucket of Object.values(state.byWorkspace)) {
            latest = Math.max(latest, newestStamp(bucket));
          }
          const visited: RecentTaskEntry = {
            id: entry.id,
            identifier: entry.identifier,
            title: entry.title,
            visitedAt: Math.max(Date.now(), latest + 1),
          };
          const previous = state.byWorkspace[workspaceId] ?? EMPTY_RECENT_TASKS;
          const bucket = [visited, ...previous.filter((item) => item.id !== entry.id)].slice(
            0,
            MAX_TASKS_PER_WORKSPACE,
          );
          return {
            byWorkspace: capWorkspaces({ ...state.byWorkspace, [workspaceId]: bucket }),
            ownerId,
          };
        });
      },
      forget: (workspaceId, taskId) => {
        const ownerId = draftWriteOwner();
        if (ownerId === null) return;
        set((state) => {
          const previous = state.byWorkspace[workspaceId];
          if (!previous?.some((item) => item.id === taskId)) return state;
          const byWorkspace = { ...state.byWorkspace };
          const bucket = previous.filter((item) => item.id !== taskId);
          if (bucket.length === 0) delete byWorkspace[workspaceId];
          else byWorkspace[workspaceId] = bucket;
          return { byWorkspace, ownerId };
        });
      },
    }),
    {
      name: RECENT_TASKS_STORAGE_KEY,
      storage: createJSONStorage(() => defaultStorage),
      partialize: (state) => ({ byWorkspace: state.byWorkspace, ownerId: state.ownerId }),
      // Sanitize on every hydration, not only on a version change. A value
      // saved without an owner hydrates with `ownerId` null, so it belongs to
      // no one who signs in and is released at the first sign-in.
      merge: (persisted, current) => ({
        ...current,
        byWorkspace: sanitizeByWorkspace(isRecord(persisted) ? persisted.byWorkspace : undefined),
        ownerId:
          isRecord(persisted) && typeof persisted.ownerId === "string" ? persisted.ownerId : null,
      }),
    },
  ),
);

/** The workspace's recent tasks, newest first; stable while unchanged. */
export function useRecentTasks(workspaceId: string): readonly RecentTaskEntry[] {
  return useRecentTasksStore(
    (state) => state.byWorkspace[workspaceId] ?? EMPTY_RECENT_TASKS,
  );
}

/**
 * Logout cleanup, through the draft registry. This is not a draft, but it
 * holds task identifiers and titles, which are task content: left behind, the
 * next person to sign in on this browser would read the previous person's
 * task titles in the palette. It uses the existing registry rather than a
 * parallel cleanup mechanism; `drafts/register-all-drafts` imports this
 * module so the registration has run before logout.
 *
 * `workspaceScoped: false`: the key is the bare `uniwork_recent_tasks` in
 * `defaultStorage`, with workspaces split inside the value.
 */
registerDraftCleanup({
  storageKey: RECENT_TASKS_STORAGE_KEY,
  workspaceScoped: false,
  resetInMemory: () => useRecentTasksStore.setState({ byWorkspace: {}, ownerId: null }),
  isOwnedBy: (userId) => {
    const { byWorkspace, ownerId } = useRecentTasksStore.getState();
    return ownerId === userId || Object.keys(byWorkspace).length === 0;
  },
});
