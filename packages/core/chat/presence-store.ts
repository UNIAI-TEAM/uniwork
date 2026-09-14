"use client";

import { create } from "zustand";
import { normalizeTypingUserId } from "./typing-user-id";

/** Drop a peer if no presence bump arrives within this window. */
export const CHAT_PRESENCE_TTL_MS = 35_000;

interface PresenceState {
  onlineUserIds: Record<string, true>;
  bump: (userId: string, currentUserId: string) => void;
  markOffline: (userId: string) => void;
  /** Remove peers whose last bump is older than TTL (drives UI re-render). */
  prune: (now?: number) => void;
  clearAll: () => void;
}

/** Last presence bump per user — kept outside zustand so heartbeats do not re-render. */
const lastSeenAt = new Map<string, number>();

export const usePresenceStore = create<PresenceState>((set) => ({
  onlineUserIds: {},

  bump(userId, currentUserId) {
    const normalized = normalizeTypingUserId(userId);
    if (!normalized) return;
    if (normalized === normalizeTypingUserId(currentUserId)) return;

    lastSeenAt.set(normalized, Date.now());
    set((state) => {
      if (state.onlineUserIds[normalized]) return state;
      return { onlineUserIds: { ...state.onlineUserIds, [normalized]: true } };
    });
  },

  markOffline(userId) {
    const normalized = normalizeTypingUserId(userId);
    if (!normalized) return;
    lastSeenAt.delete(normalized);
    set((state) => {
      if (!state.onlineUserIds[normalized]) return state;
      const onlineUserIds = { ...state.onlineUserIds };
      delete onlineUserIds[normalized];
      return { onlineUserIds };
    });
  },

  prune(now = Date.now()) {
    set((state) => {
      let changed = false;
      const onlineUserIds = { ...state.onlineUserIds };
      for (const id of Object.keys(onlineUserIds)) {
        const seen = lastSeenAt.get(id) ?? 0;
        if (now - seen >= CHAT_PRESENCE_TTL_MS) {
          delete onlineUserIds[id];
          lastSeenAt.delete(id);
          changed = true;
        }
      }
      return changed ? { onlineUserIds } : state;
    });
  },

  clearAll() {
    lastSeenAt.clear();
    set({ onlineUserIds: {} });
  },
}));

export function selectIsUserOnline(
  state: PresenceState,
  userId: string | null | undefined,
): boolean {
  if (!userId) return false;
  return Boolean(state.onlineUserIds[normalizeTypingUserId(userId)]);
}
