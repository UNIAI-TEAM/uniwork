import {
  type ChatWallpaper,
  DEFAULT_CHAT_WALLPAPER,
  isChatWallpaperPresetId,
} from "./chat-wallpaper";

export type ChatRoomWallpaperRecord = {
  preset: string;
  url?: string;
};

/** Object identity of a signed wallpaper URL (path without query/signature). */
export function chatWallpaperObjectKey(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return "";
  try {
    if (/^https?:\/\//i.test(trimmed)) {
      const parsed = new URL(trimmed);
      return `${parsed.origin}${parsed.pathname}`;
    }
  } catch {
    /* fall through */
  }
  return trimmed.split(/[?#]/, 1)[0] ?? "";
}

/**
 * Keeps the previously displayed custom wallpaper URL when a rooms refetch
 * only rotates the presign (same object, new X-Amz-Signature). Otherwise the
 * CSS `backgroundImage` string changes and the browser reloads the image on
 * every chat.room.activity / send.
 */
export function preferStableChatWallpaper(previous: ChatWallpaper, next: ChatWallpaper): ChatWallpaper {
  if (next.type !== "custom" || previous.type !== "custom") return next;
  const prevKey = chatWallpaperObjectKey(previous.dataUrl);
  const nextKey = chatWallpaperObjectKey(next.dataUrl);
  if (prevKey !== "" && prevKey === nextKey) return previous;
  return next;
}

/** Maps a room row from the API to the local wallpaper surface model. */
export function chatWallpaperFromRoom(room?: { wallpaper?: ChatRoomWallpaperRecord | null }): ChatWallpaper {
  const w = room?.wallpaper;
  if (!w?.preset || w.preset === "default") return DEFAULT_CHAT_WALLPAPER;
  if (w.preset === "custom" && w.url) return { type: "custom", dataUrl: w.url };
  if (isChatWallpaperPresetId(w.preset)) return { type: "preset", id: w.preset };
  return DEFAULT_CHAT_WALLPAPER;
}
