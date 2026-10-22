import {
  type ChatWallpaper,
  DEFAULT_CHAT_WALLPAPER,
  isChatWallpaperPresetId,
} from "./chat-wallpaper";

export type ChatRoomWallpaperRecord = {
  preset: string;
  url?: string;
};

/** Maps a room row from the API to the local wallpaper surface model. */
export function chatWallpaperFromRoom(room?: { wallpaper?: ChatRoomWallpaperRecord | null }): ChatWallpaper {
  const w = room?.wallpaper;
  if (!w?.preset || w.preset === "default") return DEFAULT_CHAT_WALLPAPER;
  if (w.preset === "custom" && w.url) return { type: "custom", dataUrl: w.url };
  if (isChatWallpaperPresetId(w.preset)) return { type: "preset", id: w.preset };
  return DEFAULT_CHAT_WALLPAPER;
}
