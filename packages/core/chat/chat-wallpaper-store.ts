"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { defaultStorage } from "../platform/storage";
import {
  createWorkspaceAwareStorage,
  registerForWorkspaceRehydration,
} from "../platform/workspace-storage";
import {
  DEFAULT_CHAT_WALLPAPER,
  MAX_CHAT_WALLPAPER_BYTES,
  type ChatWallpaper,
  type ChatWallpaperPresetId,
  normalizeChatWallpaper,
} from "./chat-wallpaper";

type ChatWallpaperState = {
  byRoomId: Record<string, ChatWallpaper>;
  wallpaperFor: (roomId: string) => ChatWallpaper;
  setPreset: (roomId: string, id: ChatWallpaperPresetId) => void;
  setCustom: (roomId: string, dataUrl: string) => void;
  reset: (roomId: string) => void;
};

function readWallpaper(byRoomId: Record<string, ChatWallpaper>, roomId: string): ChatWallpaper {
  return byRoomId[roomId] ?? DEFAULT_CHAT_WALLPAPER;
}

function normalizeByRoomId(raw: unknown): Record<string, ChatWallpaper> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, ChatWallpaper> = {};
  for (const [roomId, value] of Object.entries(raw as Record<string, unknown>)) {
    out[roomId] = normalizeChatWallpaper(value);
  }
  return out;
}

export const useChatWallpaperStore = create<ChatWallpaperState>()(
  persist(
    (set, get) => ({
      byRoomId: {},
      wallpaperFor: (roomId) => readWallpaper(get().byRoomId, roomId),
      setPreset: (roomId, id) => {
        set((state) => ({
          byRoomId: {
            ...state.byRoomId,
            [roomId]: id === "default" ? DEFAULT_CHAT_WALLPAPER : { type: "preset", id },
          },
        }));
      },
      setCustom: (roomId, dataUrl) => {
        if (!dataUrl.startsWith("data:image/")) throw new Error("wallpaper_not_image");
        if (dataUrl.length > MAX_CHAT_WALLPAPER_BYTES) throw new Error("wallpaper_too_large");
        set((state) => ({
          byRoomId: { ...state.byRoomId, [roomId]: { type: "custom", dataUrl } },
        }));
      },
      reset: (roomId) => {
        set((state) => {
          const next = { ...state.byRoomId };
          delete next[roomId];
          return { byRoomId: next };
        });
      },
    }),
    {
      name: "uniwork_chat_room_wallpapers",
      storage: createJSONStorage(() => createWorkspaceAwareStorage(defaultStorage)),
      partialize: (state) => ({ byRoomId: state.byRoomId }),
      merge: (persisted, current) => ({
        ...current,
        byRoomId: normalizeByRoomId((persisted as { byRoomId?: unknown } | undefined)?.byRoomId),
      }),
    },
  ),
);

registerForWorkspaceRehydration(() => void useChatWallpaperStore.persist.rehydrate());

export function resetChatWallpapersForTests(): void {
  useChatWallpaperStore.setState({ byRoomId: {} });
}
