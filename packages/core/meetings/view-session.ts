"use client";

import { useEffect } from "react";
import { create } from "zustand";

/** Ephemeral in-room view state (pin / hide); not persisted across sessions. */
export interface MeetingViewSessionState {
  pinnedIdentity: string | null;
  hiddenIdentities: string[];
  /**
   * The presenter's own choice to hide (true) or show (false) the preview of
   * their share; a share with no entry takes its surface's default. Keyed by
   * the captured track's id, not the tile (a tile remounts when it moves
   * between stage, grid and strip) nor the track sid (LiveKit republishes the
   * same capture under a new sid after a full reconnect). A new share is a
   * new capture, so it starts from its default again.
   */
  hiddenSharePreviews: Record<string, boolean>;
  /** The people tab's view for a clerk; kept while the sidebar closes and reopens. */
  peopleView: "room" | "attendance";
  pinParticipant: (identity: string | null) => void;
  toggleHidden: (identity: string) => void;
  isHidden: (identity: string) => boolean;
  setSharePreviewHidden: (captureId: string, hidden: boolean) => void;
  setPeopleView: (view: "room" | "attendance") => void;
  reset: () => void;
}

export const useMeetingViewSessionStore = create<MeetingViewSessionState>((set, get) => ({
  pinnedIdentity: null,
  hiddenIdentities: [],
  hiddenSharePreviews: {},
  peopleView: "room",
  pinParticipant: (identity) => set({ pinnedIdentity: identity }),
  toggleHidden: (identity) =>
    set((s) => ({
      hiddenIdentities: s.hiddenIdentities.includes(identity)
        ? s.hiddenIdentities.filter((id) => id !== identity)
        : [...s.hiddenIdentities, identity],
    })),
  isHidden: (identity) => get().hiddenIdentities.includes(identity),
  setSharePreviewHidden: (captureId, hidden) =>
    set((s) => ({ hiddenSharePreviews: { ...s.hiddenSharePreviews, [captureId]: hidden } })),
  setPeopleView: (view) => set({ peopleView: view }),
  reset: () => set({ pinnedIdentity: null, hiddenIdentities: [], hiddenSharePreviews: {}, peopleView: "room" }),
}));

/**
 * Scopes the view state to one visit of one meeting: it is cleared when the
 * conference unmounts (the room was left) or turns to another meeting. The
 * store outlives the screen, so without this a hidden person stayed hidden on
 * the next visit.
 */
export function useMeetingViewSessionScope(meetingId: string | undefined): void {
  useEffect(() => () => useMeetingViewSessionStore.getState().reset(), [meetingId]);
}
