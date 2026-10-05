"use client";

import { create } from "zustand";
import { normalizeTypingUserId } from "./typing-user-id";

/**
 * Drop a peer if neither a presence bump nor a heartbeat snapshot names them
 * within this window. A server that publishes on every beat refreshes peers
 * through bumps; one that publishes only state changes refreshes them through
 * the snapshot each heartbeat answers with (`reconcile`), which also drops
 * whoever went offline. The window matches the server's presence TTL: a tab
 * hidden long enough for Chrome to wake its timers once a minute gets a
 * snapshot every ~60s and must keep its peers until the next one.
 */
export const CHAT_PRESENCE_TTL_MS = 90_000;

interface PresenceState {
  onlineUserIds: Record<string, true>;
  bump: (userId: string, currentUserId: string) => void;
  markOffline: (userId: string) => void;
  /**
   * Make the set the server's snapshot (minus self). `since` is when the
   * request left: a bump or an offline frame that arrived after it is newer
   * than the snapshot and wins.
   */
  reconcile: (userIds: readonly string[], currentUserId: string, since: number) => void;
  /** Remove peers whose last bump is older than TTL (drives UI re-render). */
  prune: (now?: number) => void;
  clearAll: () => void;
}

/** Last presence bump per user — kept outside zustand so heartbeats do not re-render. */
const lastSeenAt = new Map<string, number>();
/** Last offline frame per user, so a snapshot older than it does not revive them. */
const offlineAt = new Map<string, number>();

export const usePresenceStore = create<PresenceState>((set) => ({
  onlineUserIds: {},

  bump(userId, currentUserId) {
    const normalized = normalizeTypingUserId(userId);
    if (!normalized) return;
    if (normalized === normalizeTypingUserId(currentUserId)) return;

    lastSeenAt.set(normalized, Date.now());
    offlineAt.delete(normalized);
    set((state) => {
      if (state.onlineUserIds[normalized]) return state;
      return { onlineUserIds: { ...state.onlineUserIds, [normalized]: true } };
    });
  },

  markOffline(userId) {
    const normalized = normalizeTypingUserId(userId);
    if (!normalized) return;
    lastSeenAt.delete(normalized);
    offlineAt.set(normalized, Date.now());
    set((state) => {
      if (!state.onlineUserIds[normalized]) return state;
      const onlineUserIds = { ...state.onlineUserIds };
      delete onlineUserIds[normalized];
      return { onlineUserIds };
    });
  },

  reconcile(userIds, currentUserId, since) {
    const self = normalizeTypingUserId(currentUserId);
    const now = Date.now();
    set((state) => {
      const onlineUserIds: Record<string, true> = {};
      for (const id of userIds) {
        const normalized = normalizeTypingUserId(id);
        if (!normalized || normalized === self) continue;
        if ((offlineAt.get(normalized) ?? -Infinity) >= since) continue;
        onlineUserIds[normalized] = true;
        lastSeenAt.set(normalized, now);
      }
      for (const id of Object.keys(state.onlineUserIds)) {
        if (onlineUserIds[id]) continue;
        if ((lastSeenAt.get(id) ?? -Infinity) >= since) onlineUserIds[id] = true;
        else lastSeenAt.delete(id);
      }
      const before = Object.keys(state.onlineUserIds);
      const after = Object.keys(onlineUserIds);
      const same = before.length === after.length && after.every((id) => state.onlineUserIds[id]);
      return same ? state : { onlineUserIds };
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
    offlineAt.clear();
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
