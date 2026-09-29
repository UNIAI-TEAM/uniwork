"use client";

import { create } from "zustand";

/** Ephemeral in-room view state (pin / hide); not persisted across sessions. */
export interface MeetingViewSessionState {
  pinnedIdentity: string | null;
  hiddenIdentities: string[];
  /**
   * Own screen shares (by track sid) whose preview the presenter put away.
   * Keyed by the share, not the tile: a tile remounts when it moves between
   * stage, grid and strip, and a new share starts with a new sid.
   */
  hiddenSharePreviews: string[];
  pinParticipant: (identity: string | null) => void;
  toggleHidden: (identity: string) => void;
  isHidden: (identity: string) => boolean;
  setSharePreviewHidden: (trackSid: string, hidden: boolean) => void;
  reset: () => void;
}

export const useMeetingViewSessionStore = create<MeetingViewSessionState>((set, get) => ({
  pinnedIdentity: null,
  hiddenIdentities: [],
  hiddenSharePreviews: [],
  pinParticipant: (identity) => set({ pinnedIdentity: identity }),
  toggleHidden: (identity) =>
    set((s) => ({
      hiddenIdentities: s.hiddenIdentities.includes(identity)
        ? s.hiddenIdentities.filter((id) => id !== identity)
        : [...s.hiddenIdentities, identity],
    })),
  isHidden: (identity) => get().hiddenIdentities.includes(identity),
  setSharePreviewHidden: (trackSid, hidden) =>
    set((s) => ({
      hiddenSharePreviews: hidden
        ? s.hiddenSharePreviews.includes(trackSid)
          ? s.hiddenSharePreviews
          : [...s.hiddenSharePreviews, trackSid]
        : s.hiddenSharePreviews.filter((sid) => sid !== trackSid),
    })),
  reset: () => set({ pinnedIdentity: null, hiddenIdentities: [], hiddenSharePreviews: [] }),
}));
