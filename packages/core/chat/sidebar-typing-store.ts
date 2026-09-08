"use client";

import { create } from "zustand";
import { normalizeTypingUserId } from "./typing-user-id";

export const CHAT_TYPING_TTL_MS = 3_000;

interface SidebarTypingState {
  byRoomId: Record<string, string[]>;
  bump: (roomId: string, userId: string, currentUserId: string) => void;
  clearAll: () => void;
}

const roomTimers = new Map<string, Map<string, ReturnType<typeof setTimeout>>>();

function clearRoomTimers(roomId: string) {
  const userTimers = roomTimers.get(roomId);
  if (!userTimers) return;
  for (const timer of userTimers.values()) clearTimeout(timer);
  roomTimers.delete(roomId);
}

function clearAllTimers() {
  for (const roomId of roomTimers.keys()) clearRoomTimers(roomId);
}

export const useSidebarTypingStore = create<SidebarTypingState>((set) => ({
  byRoomId: {},

  bump(roomId, userId, currentUserId) {
    const normalizedRoomId = roomId.trim();
    const normalizedUserId = normalizeTypingUserId(userId);
    if (!normalizedRoomId || !normalizedUserId) return;
    if (normalizedUserId === normalizeTypingUserId(currentUserId)) return;

    set((state) => {
      const prev = state.byRoomId[normalizedRoomId] ?? [];
      if (prev.includes(normalizedUserId)) return state;
      return {
        byRoomId: {
          ...state.byRoomId,
          [normalizedRoomId]: [...prev, normalizedUserId],
        },
      };
    });

    if (!roomTimers.has(normalizedRoomId)) {
      roomTimers.set(normalizedRoomId, new Map());
    }
    const userTimers = roomTimers.get(normalizedRoomId)!;
    const existing = userTimers.get(normalizedUserId);
    if (existing) clearTimeout(existing);
    userTimers.set(
      normalizedUserId,
      setTimeout(() => {
        userTimers.delete(normalizedUserId);
        if (userTimers.size === 0) roomTimers.delete(normalizedRoomId);
        set((state) => {
          const list = (state.byRoomId[normalizedRoomId] ?? []).filter(
            (id) => id !== normalizedUserId,
          );
          if (list.length === (state.byRoomId[normalizedRoomId] ?? []).length) return state;
          const byRoomId = { ...state.byRoomId };
          if (list.length === 0) delete byRoomId[normalizedRoomId];
          else byRoomId[normalizedRoomId] = list;
          return { byRoomId };
        });
      }, CHAT_TYPING_TTL_MS),
    );
  },

  clearAll() {
    clearAllTimers();
    set({ byRoomId: {} });
  },
}));

export function selectSidebarTypingUserIds(
  state: SidebarTypingState,
  roomId: string | null | undefined,
): string[] {
  if (!roomId) return [];
  return state.byRoomId[roomId] ?? [];
}
