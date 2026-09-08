"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { defaultStorage } from "../platform/storage";
import {
  createWorkspaceAwareStorage,
  registerForWorkspaceRehydration,
} from "../platform/workspace-storage";

export type ChatRoomPreference = {
  notificationsMuted: boolean;
  pinned: boolean;
  pinnedAt: number;
};

type RoomPreferencesState = {
  byRoomId: Record<string, ChatRoomPreference>;
  getPreference: (roomId: string) => ChatRoomPreference;
  toggleNotificationsMuted: (roomId: string) => void;
  togglePinned: (roomId: string) => void;
  isNotificationsMuted: (roomId: string) => boolean;
  isPinned: (roomId: string) => boolean;
  pinnedAt: (roomId: string) => number;
};

const defaultPreference = (): ChatRoomPreference => ({
  notificationsMuted: false,
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
      isNotificationsMuted: (roomId) => readPreference(get().byRoomId, roomId).notificationsMuted,
      isPinned: (roomId) => readPreference(get().byRoomId, roomId).pinned,
      pinnedAt: (roomId) => readPreference(get().byRoomId, roomId).pinnedAt,
      toggleNotificationsMuted: (roomId) => {
        set((state) => {
          const current = readPreference(state.byRoomId, roomId);
          return {
            byRoomId: {
              ...state.byRoomId,
              [roomId]: {
                ...current,
                notificationsMuted: !current.notificationsMuted,
              },
            },
          };
        });
      },
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
