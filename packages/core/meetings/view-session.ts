"use client";

import { create } from "zustand";

/** Ephemeral in-room view state (pin / hide); not persisted across sessions. */
export interface MeetingViewSessionState {
  pinnedIdentity: string | null;
  hiddenIdentities: string[];
  pinParticipant: (identity: string | null) => void;
  toggleHidden: (identity: string) => void;
  isHidden: (identity: string) => boolean;
  reset: () => void;
}

export const useMeetingViewSessionStore = create<MeetingViewSessionState>((set, get) => ({
  pinnedIdentity: null,
  hiddenIdentities: [],
  pinParticipant: (identity) => set({ pinnedIdentity: identity }),
  toggleHidden: (identity) =>
    set((s) => ({
      hiddenIdentities: s.hiddenIdentities.includes(identity)
        ? s.hiddenIdentities.filter((id) => id !== identity)
        : [...s.hiddenIdentities, identity],
    })),
  isHidden: (identity) => get().hiddenIdentities.includes(identity),
  reset: () => set({ pinnedIdentity: null, hiddenIdentities: [] }),
}));
