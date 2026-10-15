"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { defaultStorage } from "../platform/storage";
import {
  createWorkspaceAwareStorage,
  registerForWorkspaceRehydration,
} from "../platform/workspace-storage";

// Pins stay in this browser; the notification mute is on the server (UNI-1697).
export type ChatRoomPreference = {
  pinned: boolean;
  pinnedAt: number;
};

type RoomPreferencesState = {
  byRoomId: Record<string, ChatRoomPreference>;
  getPreference: (roomId: string) => ChatRoomPreference;
  togglePinned: (roomId: string) => void;
  isPinned: (roomId: string) => boolean;
  pinnedAt: (roomId: string) => number;
};

const defaultPreference = (): ChatRoomPreference => ({
  pinned: false,
  pinnedAt: 0,
});

function readPreference(
  byRoomId: Record<string, ChatRoomPreference>,
  roomId: string,
): ChatRoomPreference {
  return byRoomId[roomId] ?? defaultPreference();
}

export const useChatRoomPreferencesStore = create<RoomPreferencesState>()(
  persist(
    (set, get) => ({
      byRoomId: {},
      getPreference: (roomId) => readPreference(get().byRoomId, roomId),
      isPinned: (roomId) => readPreference(get().byRoomId, roomId).pinned,
      pinnedAt: (roomId) => readPreference(get().byRoomId, roomId).pinnedAt,
      togglePinned: (roomId) => {
        set((state) => {
          const current = readPreference(state.byRoomId, roomId);
          const pinned = !current.pinned;
          return {
            byRoomId: {
              ...state.byRoomId,
              [roomId]: {
                ...current,
                pinned,
                pinnedAt: pinned ? Date.now() : 0,
              },
            },
          };
        });
      },
    }),
    {
      name: "uniwork_chat_room_preferences",
      storage: createJSONStorage(() => createWorkspaceAwareStorage(defaultStorage)),
      partialize: (state) => ({ byRoomId: state.byRoomId }),
    },
  ),
);

registerForWorkspaceRehydration(() => void useChatRoomPreferencesStore.persist.rehydrate());

export function comparePinnedRoomOrder(
  leftRoomId: string,
  rightRoomId: string,
  byRoomId: Record<string, ChatRoomPreference>,
): number {
  const left = readPreference(byRoomId, leftRoomId);
  const right = readPreference(byRoomId, rightRoomId);
  if (left.pinned !== right.pinned) {
    return left.pinned ? -1 : 1;
  }
  if (left.pinned && right.pinned && left.pinnedAt !== right.pinnedAt) {
    return right.pinnedAt - left.pinnedAt;
  }
  return 0;
}

export function resetChatRoomPreferencesForTests(): void {
  useChatRoomPreferencesStore.setState({ byRoomId: {} });
}
