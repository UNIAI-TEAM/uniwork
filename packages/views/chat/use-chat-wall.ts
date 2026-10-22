"use client";

import { useMemo } from "react";
import { useChatRooms } from "@uniwork/core/chat";
import { chatWallpaperFromRoom } from "@uniwork/core/chat/chat-wallpaper-from-room";
import { DEFAULT_CHAT_WALLPAPER } from "@uniwork/core/chat/chat-wallpaper";
import { resolveChatWallSurface, type ChatWallSurface } from "@uniwork/core/chat/chat-wallpaper-resolve";
import { useOptionalWorkspace } from "../layout/workspace-context";

/** Shared room wallpaper from the server (every member sees the same background). */
export function useChatWall(roomId?: string | null, wsId?: string): ChatWallSurface {
  const shell = useOptionalWorkspace();
  const workspaceId = wsId ?? shell?.workspace.id ?? "";
  const { data: rooms } = useChatRooms(workspaceId);
  const room = useMemo(
    () => (roomId ? rooms?.find((entry) => entry.id === roomId) : undefined),
    [roomId, rooms],
  );
  return useMemo(
    () => resolveChatWallSurface(room ? chatWallpaperFromRoom(room) : DEFAULT_CHAT_WALLPAPER),
    [room],
  );
}
