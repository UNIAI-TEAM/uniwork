import {
  type ChatWallpaper,
  type ChatWallpaperPresetId,
  DEFAULT_CHAT_WALLPAPER,
} from "./chat-wallpaper";
import { CHAT_WALLPAPER_PATTERN_SVGS, chatWallPatternStyle } from "./chat-wallpaper-patterns";

/** Tailwind classes for the default dotted chat wall. */
export const CHAT_WALL_DOT_CLASS =
  "bg-chat-wall bg-[radial-gradient(var(--chat-wall-dot)_1.2px,transparent_1.4px)] bg-size-[22px_22px]";

export type ChatWallSurfaceStyle = {
  background?: string;
  backgroundImage?: string;
  backgroundSize?: string;
  backgroundPosition?: string;
  backgroundRepeat?: string;
};

export type ChatWallSurface = { className: string; style?: ChatWallSurfaceStyle };

const PRESET_SURFACES: Record<ChatWallpaperPresetId, ChatWallSurface> = {
  default: { className: CHAT_WALL_DOT_CLASS },
  sky: {
    className: "",
    style: { background: "linear-gradient(165deg, #dce9f8 0%, #9eb8e0 55%, #7a9cc9 100%)" },
  },
  lavender: {
    className: "",
    style: { background: "linear-gradient(165deg, #efe4ff 0%, #c9b3f0 50%, #9f84d8 100%)" },
  },
  sunset: {
    className: "",
    style: { background: "linear-gradient(165deg, #ffe8d4 0%, #ffb199 45%, #e8785a 100%)" },
  },
  mint: {
    className: "",
    style: { background: "linear-gradient(165deg, #dff7ec 0%, #9edfc4 50%, #5fbf9a 100%)" },
  },
  slate: {
    className: "",
    style: { background: "linear-gradient(165deg, #eef1f5 0%, #c5ced9 50%, #8a96a8 100%)" },
  },
  midnight: {
    className: "",
    style: { background: "linear-gradient(165deg, #1a1d2e 0%, #0f111a 40%, #050608 100%)" },
  },
  rose: {
    className: "",
    style: { background: "linear-gradient(165deg, #ffe8f2 0%, #f5aac8 50%, #d977a8 100%)" },
  },
  ocean: {
    className: "",
    style: { background: "linear-gradient(165deg, #d8f5f8 0%, #5ec4d4 50%, #2a8a9e 100%)" },
  },
  forest: {
    className: "",
    style: { background: "linear-gradient(165deg, #e4f2e8 0%, #7db88a 45%, #3d7356 100%)" },
  },
  sand: {
    className: "",
    style: { background: "linear-gradient(165deg, #faf3e8 0%, #e8d4b8 50%, #c4a882 100%)" },
  },
  dawn: {
    className: "",
    style: { background: "linear-gradient(165deg, #fff9e6 0%, #ffd699 40%, #ffb84d 100%)" },
  },
  grape: {
    className: "",
    style: { background: "linear-gradient(165deg, #ecd9ff 0%, #a67dd4 45%, #6b3fa0 100%)" },
  },
  coral: {
    className: "",
    style: { background: "linear-gradient(165deg, #ffe8e0 0%, #ff9a8b 50%, #e85d4d 100%)" },
  },
  paper: {
    className: "",
    style: { background: "linear-gradient(165deg, #fdfbf7 0%, #f0ebe3 50%, #ddd5c8 100%)" },
  },
  waves: {
    className: "",
    style: chatWallPatternStyle(
      "linear-gradient(165deg, #e4eef8 0%, #c8daf0 100%)",
      CHAT_WALLPAPER_PATTERN_SVGS.waves,
      "80px 40px",
    ),
  },
  grid: {
    className: "",
    style: chatWallPatternStyle(
      "linear-gradient(165deg, #f4f6f9 0%, #e8ecf2 100%)",
      CHAT_WALLPAPER_PATTERN_SVGS.grid,
      "28px 28px",
    ),
  },
  diagonal: {
    className: "",
    style: chatWallPatternStyle(
      "linear-gradient(165deg, #faf3e8 0%, #efe4d4 100%)",
      CHAT_WALLPAPER_PATTERN_SVGS.diagonal,
      "16px 16px",
    ),
  },
  hearts: {
    className: "",
    style: chatWallPatternStyle(
      "linear-gradient(165deg, #ffeef5 0%, #ffd6e8 100%)",
      CHAT_WALLPAPER_PATTERN_SVGS.hearts,
      "36px 36px",
    ),
  },
  bloom: {
    className: "",
    style: chatWallPatternStyle(
      "linear-gradient(165deg, #faf0f8 0%, #edd9f0 100%)",
      CHAT_WALLPAPER_PATTERN_SVGS.bloom,
      "56px 56px",
    ),
  },
  leaves: {
    className: "",
    style: chatWallPatternStyle(
      "linear-gradient(165deg, #e8f5ec 0%, #d0e8d8 100%)",
      CHAT_WALLPAPER_PATTERN_SVGS.leaves,
      "44px 44px",
    ),
  },
  stars: {
    className: "",
    style: chatWallPatternStyle(
      "linear-gradient(165deg, #1e2840 0%, #0f1525 100%)",
      CHAT_WALLPAPER_PATTERN_SVGS.stars,
      "48px 48px",
    ),
  },
  bubbles: {
    className: "",
    style: chatWallPatternStyle(
      "linear-gradient(165deg, #dff3fb 0%, #b8e4f5 100%)",
      CHAT_WALLPAPER_PATTERN_SVGS.bubbles,
      "52px 52px",
    ),
  },
};

/** Maps a stored wallpaper choice to CSS for the conversation scroll surface. */
export function resolveChatWallSurface(wallpaper: ChatWallpaper = DEFAULT_CHAT_WALLPAPER): ChatWallSurface {
  if (wallpaper.type === "default") return PRESET_SURFACES.default;
  if (wallpaper.type === "preset") return PRESET_SURFACES[wallpaper.id] ?? PRESET_SURFACES.default;
  return {
    className: "bg-cover bg-center bg-no-repeat",
    style: {
      backgroundImage: `url("${wallpaper.dataUrl.replace(/"/g, "%22")}")`,
      backgroundSize: "cover",
      backgroundPosition: "center",
      backgroundRepeat: "no-repeat",
    },
  };
}
