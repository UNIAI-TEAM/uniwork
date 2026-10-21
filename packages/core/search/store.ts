"use client";

import { create } from "zustand";

interface SearchStore {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
  /**
   * A surface with its own search field (the chat conversation list) that
   * answers the search chord before the palette does. Returns whether it took
   * the chord; `false` leaves it to the palette.
   */
  focusTarget: (() => boolean) | null;
  /** Registers a local search; the returned function removes only that one. */
  registerFocusTarget: (target: () => boolean) => () => void;
  /** Runs the registered local search, if any. */
  focusLocalSearch: () => boolean;
}

export const useSearchStore = create<SearchStore>((set, get) => ({
  open: false,
  setOpen: (open) => set({ open }),
  toggle: () => set((s) => ({ open: !s.open })),
  focusTarget: null,
  registerFocusTarget: (target) => {
    set({ focusTarget: target });
    return () => {
      if (get().focusTarget === target) set({ focusTarget: null });
    };
  },
  focusLocalSearch: () => get().focusTarget?.() ?? false,
}));
