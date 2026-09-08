"use client";

import { create } from "zustand";

interface ActiveChatRoomState {
  workspaceId: string | null;
  roomId: string | null;
  setActiveRoom: (workspaceId: string | null, roomId: string | null) => void;
}

/** Tracks which chat room the user is viewing (for unread + realtime patch). */
export const useActiveChatRoomStore = create<ActiveChatRoomState>((set) => ({
  workspaceId: null,
  roomId: null,
  setActiveRoom: (workspaceId, roomId) => set({ workspaceId, roomId }),
}));
