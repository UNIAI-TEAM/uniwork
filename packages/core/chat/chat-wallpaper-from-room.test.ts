import { describe, expect, it } from "vitest";
import { chatWallpaperFromRoom } from "./chat-wallpaper-from-room";

describe("chatWallpaperFromRoom", () => {
  it("maps a custom wallpaper URL from the room row", () => {
    expect(
      chatWallpaperFromRoom({ wallpaper: { preset: "custom", url: "https://cdn.example/w.jpg" } }),
    ).toEqual({ type: "custom", dataUrl: "https://cdn.example/w.jpg" });
  });

  it("falls back to default for an unknown preset", () => {
    expect(chatWallpaperFromRoom({ wallpaper: { preset: "not-a-preset" } })).toEqual({ type: "default" });
  });
});
