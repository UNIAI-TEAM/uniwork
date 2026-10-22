import { afterEach, describe, expect, it } from "vitest";
import { resetChatWallpapersForTests, useChatWallpaperStore } from "./chat-wallpaper-store";

afterEach(() => resetChatWallpapersForTests());

describe("useChatWallpaperStore", () => {
  it("keeps wallpaper per room", () => {
    const store = useChatWallpaperStore;
    store.getState().setPreset("room-a", "sky");
    store.getState().setPreset("room-b", "mint");
    expect(store.getState().wallpaperFor("room-a")).toEqual({ type: "preset", id: "sky" });
    expect(store.getState().wallpaperFor("room-b")).toEqual({ type: "preset", id: "mint" });
    expect(store.getState().wallpaperFor("room-c")).toEqual({ type: "default" });
    store.getState().reset("room-a");
    expect(store.getState().wallpaperFor("room-a")).toEqual({ type: "default" });
  });

  it("rejects an oversized custom wallpaper", () => {
    const huge = `data:image/png;base64,${"a".repeat(900_001)}`;
    expect(() => useChatWallpaperStore.getState().setCustom("room-x", huge)).toThrow("wallpaper_too_large");
  });
});
