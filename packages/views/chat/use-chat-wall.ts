"use client";

import { useMemo, useRef } from "react";
import { useChatRooms } from "@uniwork/core/chat";
import {
  chatWallpaperFromRoom,
  preferStableChatWallpaper,
} from "@uniwork/core/chat/chat-wallpaper-from-room";
import { DEFAULT_CHAT_WALLPAPER, type ChatWallpaper } from "@uniwork/core/chat/chat-wallpaper";
import { resolveChatWallSurface, type ChatWallSurface } from "@uniwork/core/chat/chat-wallpaper-resolve";
import { useOptionalWorkspace } from "../layout/workspace-context";

/** Shared room wallpaper from the server (every member sees the same background). */
export function useChatWall(roomId?: string | null, wsId?: string): ChatWallSurface {
  const shell = useOptionalWorkspace();
  const workspaceId = wsId ?? shell?.workspace.id ?? "";
  const { data: rooms } = useChatRooms(workspaceId);
  const room = roomId ? rooms?.find((entry) => entry.id === roomId) : undefined;
  const raw = room ? chatWallpaperFromRoom(room) : DEFAULT_CHAT_WALLPAPER;

  const roomScopeRef = useRef(roomId ?? "");
  const wallpaperRef = useRef<ChatWallpaper>(raw);
  if (roomScopeRef.current !== (roomId ?? "")) {
    roomScopeRef.current = roomId ?? "";
    wallpaperRef.current = raw;
  } else {
    wallpaperRef.current = preferStableChatWallpaper(wallpaperRef.current, raw);
  }

  const wallpaper = wallpaperRef.current;
  return useMemo(() => resolveChatWallSurface(wallpaper), [wallpaper]);
}
