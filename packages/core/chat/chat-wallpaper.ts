/** Preset chat backgrounds (device-local, like Telegram wallpapers). */
export const CHAT_WALLPAPER_PRESET_IDS = [
  "default",
  "sky",
  "lavender",
  "sunset",
  "mint",
  "slate",
  "midnight",
  "rose",
  "ocean",
  "forest",
  "sand",
  "dawn",
  "grape",
  "coral",
  "paper",
  "waves",
  "grid",
  "diagonal",
  "hearts",
  "bloom",
  "leaves",
  "stars",
  "bubbles",
] as const;

export type ChatWallpaperPresetId = (typeof CHAT_WALLPAPER_PRESET_IDS)[number];

export type ChatWallpaper =
  | { type: "default" }
  | { type: "preset"; id: ChatWallpaperPresetId }
  | { type: "custom"; dataUrl: string };

/** Data URLs in localStorage; keep uploads small. */
export const MAX_CHAT_WALLPAPER_BYTES = 900_000;

export const DEFAULT_CHAT_WALLPAPER: ChatWallpaper = { type: "default" };

export function isChatWallpaperPresetId(id: string): id is ChatWallpaperPresetId {
  return (CHAT_WALLPAPER_PRESET_IDS as readonly string[]).includes(id);
}

export function normalizeChatWallpaper(raw: unknown): ChatWallpaper {
  if (!raw || typeof raw !== "object") return DEFAULT_CHAT_WALLPAPER;
  const value = raw as { type?: string; id?: string; dataUrl?: string };
  if (value.type === "preset" && value.id && isChatWallpaperPresetId(value.id)) {
    return { type: "preset", id: value.id };
  }
  if (value.type === "custom" && typeof value.dataUrl === "string" && value.dataUrl.startsWith("data:image/")) {
    if (value.dataUrl.length <= MAX_CHAT_WALLPAPER_BYTES) return { type: "custom", dataUrl: value.dataUrl };
  }
  return DEFAULT_CHAT_WALLPAPER;
}
