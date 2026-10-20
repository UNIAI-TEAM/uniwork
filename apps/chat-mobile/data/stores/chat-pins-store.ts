// Pinned conversations. The server keeps no pins (the web keeps them in the
// browser, packages/core/chat/room-preferences-store.ts), so the phone keeps
// its own in SecureStore, one key per workspace; lib/rooms-display.ts sorts by
// them with the web's comparePinnedRoomOrder.
import * as SecureStore from "expo-secure-store";
import { create } from "zustand";
import type { ChatRoomPreference } from "@/lib/rooms-display";

const keyFor = (wsId: string) => `uniwork_chat_pins_${wsId}`;

interface PinsState {
  wsId: string | null;
  byRoomId: Record<string, ChatRoomPreference>;
  /** Read this workspace's pins; a workspace switch replaces the previous ones. */
  load: (wsId: string) => Promise<void>;
  toggle: (roomId: string, now?: number) => Promise<void>;
}

function parse(raw: string | null): Record<string, ChatRoomPreference> {
  if (!raw) return {};
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const out: Record<string, ChatRoomPreference> = {};
    for (const [roomId, pinnedAt] of Object.entries(value)) {
      if (typeof pinnedAt === "number" && Number.isFinite(pinnedAt)) out[roomId] = { pinned: true, pinnedAt };
    }
    return out;
  } catch {
    return {};
  }
}

export const useChatPinsStore = create<PinsState>((set, get) => ({
  wsId: null,
  byRoomId: {},

  load: async (wsId) => {
    if (get().wsId !== wsId) set({ wsId, byRoomId: {} });
    const byRoomId = parse(await SecureStore.getItemAsync(keyFor(wsId)));
    if (get().wsId === wsId) set({ byRoomId });
  },

  toggle: async (roomId, now = Date.now()) => {
    const { wsId, byRoomId } = get();
    if (!wsId) return;
    const next = { ...byRoomId };
    if (next[roomId]) delete next[roomId];
    else next[roomId] = { pinned: true, pinnedAt: now };
    set({ byRoomId: next });
    // Stored as roomId → pinnedAt: small enough for a SecureStore value.
    const stored = Object.fromEntries(Object.entries(next).map(([id, pref]) => [id, pref.pinnedAt]));
    await SecureStore.setItemAsync(keyFor(wsId), JSON.stringify(stored));
  },
}));
