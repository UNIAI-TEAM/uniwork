"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { defaultStorage } from "../platform/storage";

/**
 * How the directory is drawn. Two views over the same query: a card grid that
 * reads like a company handbook, and a dense table for scanning a column at a
 * time. Cards are the default because the directory is browsed far more often
 * than it is audited.
 *
 * Nothing here is a filter — filters go to the server and belong to the
 * screen, so a stale one can never hide a colleague on the next visit. Only
 * the presentation is remembered, and it is remembered per browser rather
 * than per workspace: the directory belongs to the organization.
 */
export type PeopleViewMode = "cards" | "table";

/**
 * Columns the table view can hide. Name and job title are the core pair the
 * narrow layout always shows, so they are not in this set.
 */
export type PeopleColumnKey = "department" | "email" | "phone" | "role" | "status";

export const PEOPLE_COLUMN_KEYS: PeopleColumnKey[] = [
  "department",
  "email",
  "phone",
  "role",
  "status",
];

/**
 * Two columns are off until somebody asks for them, and the default set is
 * what decides whether the table fits a laptop without scrolling sideways.
 * Phone is empty for anyone who has not published it; status says "active" on
 * every row while the default status filter is in force, and deactivation is
 * badged beside the name anyway.
 */
const DEFAULT_HIDDEN_COLUMNS: PeopleColumnKey[] = ["phone", "status"];

export interface PeopleViewState {
  viewMode: PeopleViewMode;
  hiddenColumns: PeopleColumnKey[];
  setViewMode: (mode: PeopleViewMode) => void;
  toggleColumn: (key: PeopleColumnKey) => void;
}

const DEFAULTS = {
  viewMode: "cards" as PeopleViewMode,
  hiddenColumns: DEFAULT_HIDDEN_COLUMNS,
};

export const usePeopleViewStore = create<PeopleViewState>()(
  persist(
    (set) => ({
      ...DEFAULTS,
      setViewMode: (mode) => set({ viewMode: mode }),
      toggleColumn: (key) =>
        set((state) => ({
          hiddenColumns: state.hiddenColumns.includes(key)
            ? state.hiddenColumns.filter((k) => k !== key)
            : [...state.hiddenColumns, key],
        })),
    }),
    {
      name: "uniwork_people_view",
      storage: createJSONStorage(() => defaultStorage),
      partialize: (state) => ({
        viewMode: state.viewMode,
        hiddenColumns: state.hiddenColumns,
      }),
      // A payload written before a key existed must still get that key's
      // default, or the screen reads `.includes` on undefined and the whole
      // directory fails to render.
      merge: (persisted, current) => {
        if (!persisted) return { ...current, ...DEFAULTS };
        const saved = persisted as Partial<PeopleViewState>;
        return {
          ...current,
          ...saved,
          viewMode: saved.viewMode ?? DEFAULTS.viewMode,
          hiddenColumns: saved.hiddenColumns ?? DEFAULTS.hiddenColumns,
        };
      },
    },
  ),
);

export function resetPeopleViewStoreForTests(): void {
  usePeopleViewStore.setState({ ...DEFAULTS });
}
