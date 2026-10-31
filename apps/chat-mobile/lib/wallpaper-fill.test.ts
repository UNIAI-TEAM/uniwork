import { CHAT_WALLPAPER_PRESET_IDS } from "@uniwork/core/chat/chat-wallpaper";
import { describe, expect, it } from "vitest";
import { wallpaperColor } from "./wallpaper-fill";

describe("wallpaperColor", () => {
  it("paints each preset as its mid colour and leaves the dotted default alone", () => {
    expect(wallpaperColor("default")).toBeNull();
    expect(wallpaperColor("stars")).toBe("#1e2840");
    for (const id of CHAT_WALLPAPER_PRESET_IDS) {
      if (id === "default") continue;
      expect(wallpaperColor(id), id).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});
