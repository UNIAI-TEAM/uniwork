// The conversation on screen, if any (packages/core/chat/active-chat-room-store.ts
// on the web). A message there is not unread, and its scope is the first of
// the 25 the socket holds.
import { create } from "zustand";

interface ActiveRoomState {
  roomId: string | null;
  setRoomId: (roomId: string | null) => void;
}

export const useActiveChatRoomStore = create<ActiveRoomState>((set) => ({
  roomId: null,
  setRoomId: (roomId) => set({ roomId }),
}));
