"use client";

import { useMemo } from "react";
import { DEFAULT_CHAT_WALLPAPER } from "@uniwork/core/chat/chat-wallpaper";
import { resolveChatWallSurface, type ChatWallSurface } from "@uniwork/core/chat/chat-wallpaper-resolve";
import { useChatWallpaperStore } from "@uniwork/core/chat/chat-wallpaper-store";

/** Per-room chat background; without a room id the dotted default is used. */
export function useChatWall(roomId?: string | null): ChatWallSurface {
  const wallpaper = useChatWallpaperStore((s) => (roomId ? s.byRoomId[roomId] : undefined));
  return useMemo(
    () => resolveChatWallSurface(wallpaper ?? DEFAULT_CHAT_WALLPAPER),
    [wallpaper],
  );
}
