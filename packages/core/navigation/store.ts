"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { GLOBAL_PREFIXES } from "../paths/paths";
import { defaultStorage } from "../platform/storage";
import { createWorkspaceAwareStorage, registerForWorkspaceRehydration } from "../platform/workspace-storage";

interface NavigationState {
  /** Last workspace-scoped path visited, restored when the user comes back. */
  lastPath: string | null;
  onPathChange: (path: string) => void;
}

/**
 * Remembers where the user was inside a workspace. Global routes (login,
 * onboarding, invites…) are never recorded: restoring into one of them after
 * a workspace switch would be a bounce, not a return.
 */
export const useNavigationStore = create<NavigationState>()(
  persist(
    (set) => ({
      lastPath: null,
      onPathChange: (path: string) => {
        if (!GLOBAL_PREFIXES.some((prefix) => path.startsWith(prefix.replace(/\/$/, "")))) {
          set({ lastPath: path });
        }
      },
    }),
    {
      name: "uniwork_navigation",
      storage: createJSONStorage(() => createWorkspaceAwareStorage(defaultStorage)),
      partialize: (state) => ({ lastPath: state.lastPath }),
    },
  ),
);

// Workspace-aware: re-read lastPath when the current workspace changes.
registerForWorkspaceRehydration(() => void useNavigationStore.persist.rehydrate());
