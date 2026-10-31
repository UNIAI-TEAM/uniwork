// The mid colour of each preset in packages/core/chat/chat-wallpaper-resolve.ts.
// The web paints a CSS gradient; the phone has no gradient view, so the wall
// is that stop. "default" keeps the dotted image.
import type { ChatWallpaperPresetId } from "@uniwork/core/chat/chat-wallpaper";

const FILL: Record<Exclude<ChatWallpaperPresetId, "default">, string> = {
  sky: "#9eb8e0",
  lavender: "#c9b3f0",
  sunset: "#ffb199",
  mint: "#9edfc4",
  slate: "#c5ced9",
  midnight: "#0f111a",
  rose: "#f5aac8",
  ocean: "#5ec4d4",
  forest: "#7db88a",
  sand: "#e8d4b8",
  dawn: "#ffd699",
  grape: "#a67dd4",
  coral: "#ff9a8b",
  paper: "#f0ebe3",
  waves: "#c8daf0",
  grid: "#e8ecf2",
  diagonal: "#efe4d4",
  hearts: "#ffd6e8",
  bloom: "#edd9f0",
  leaves: "#d0e8d8",
  stars: "#1e2840",
  bubbles: "#b8e4f5",
};

export function wallpaperColor(id: ChatWallpaperPresetId): string | null {
  if (id === "default") return null;
  return FILL[id];
}
