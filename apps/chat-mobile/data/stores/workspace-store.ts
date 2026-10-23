// Ported from usf apps/mobile/data/workspace-store.ts: the active workspace
// (org slug, workspace slug, id) persisted in SecureStore so a cold start can
// land in the last workspace. The route is the source of truth;
// app/(app)/[org]/[ws]/_layout.tsx syncs it here after validating the pair.
import * as SecureStore from "expo-secure-store";
import { create } from "zustand";

const KEY = "uniwork_chat_workspace";

export interface CurrentWorkspace {
  orgSlug: string;
  wsSlug: string;
  wsId: string;
}

interface WorkspaceState {
  current: CurrentWorkspace | null;
  /** true once restore() has read SecureStore, whatever it found */
  isRestored: boolean;
  setCurrent: (workspace: CurrentWorkspace) => Promise<void>;
  restore: () => Promise<void>;
  clear: () => Promise<void>;
}

function parse(raw: string | null): CurrentWorkspace | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return null;
    const { orgSlug, wsSlug, wsId } = value as Record<string, unknown>;
    if (typeof orgSlug !== "string" || typeof wsSlug !== "string" || typeof wsId !== "string") return null;
    return { orgSlug, wsSlug, wsId };
  } catch {
    return null;
  }
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  current: null,
  isRestored: false,

  setCurrent: async (workspace) => {
    set({ current: workspace });
    await SecureStore.setItemAsync(KEY, JSON.stringify(workspace));
  },

  restore: async () => {
    set({ current: parse(await SecureStore.getItemAsync(KEY)), isRestored: true });
  },

  clear: async () => {
    set({ current: null });
    await SecureStore.deleteItemAsync(KEY);
  },
}));

/** Sync read for code outside React. */
export function getCurrentWorkspace(): CurrentWorkspace | null {
  return useWorkspaceStore.getState().current;
}
