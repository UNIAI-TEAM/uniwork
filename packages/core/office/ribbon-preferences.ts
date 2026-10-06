"use client";

import { useCallback } from "react";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { defaultStorage } from "../platform/storage";

/**
 * "Collapse the ribbon" (tabs only) is a per-person preference, like Word's.
 * It is kept per ribbon scope (one per format: "docx", "xlsx", …) so hiding the
 * spreadsheet ribbon does not hide the document one. Default: expanded.
 * Persisted through the StorageAdapter (defaultStorage), never localStorage.
 */
interface OfficeRibbonPreferencesState {
  collapsed: Record<string, boolean>;
  setCollapsed: (scope: string, collapsed: boolean) => void;
}

export const useOfficeRibbonPreferencesStore = create<OfficeRibbonPreferencesState>()(
  persist(
    (set) => ({
      collapsed: {},
      setCollapsed: (scope, collapsed) =>
        set((state) => ({ collapsed: { ...state.collapsed, [scope]: collapsed } })),
    }),
    {
      name: "uniwork_office_ribbon",
      storage: createJSONStorage(() => defaultStorage),
      version: 1,
      partialize: (state) => ({ collapsed: state.collapsed }),
    },
  ),
);

/** Collapsed state of one ribbon scope plus its setter. */
export function useOfficeRibbonCollapsed(scope: string): [boolean, (collapsed: boolean) => void] {
  const collapsed = useOfficeRibbonPreferencesStore((state) => state.collapsed[scope] === true);
  const setCollapsed = useOfficeRibbonPreferencesStore((state) => state.setCollapsed);
  const set = useCallback((next: boolean) => setCollapsed(scope, next), [scope, setCollapsed]);
  return [collapsed, set];
}
