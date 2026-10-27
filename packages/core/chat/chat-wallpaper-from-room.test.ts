import { describe, expect, it } from "vitest";
import {
  chatWallpaperFromRoom,
  chatWallpaperObjectKey,
  preferStableChatWallpaper,
} from "./chat-wallpaper-from-room";

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

describe("preferStableChatWallpaper", () => {
  const objectPath = "https://minio.example/bucket/chat/wallpapers/01ABC/original";
  const first = `${objectPath}?X-Amz-Signature=aaa&X-Amz-Date=20261027T010000Z`;
  const rotated = `${objectPath}?X-Amz-Signature=bbb&X-Amz-Date=20261027T020000Z`;
  const other = "https://minio.example/bucket/chat/wallpapers/01DEF/original?X-Amz-Signature=ccc";

  it("keeps the previous URL when only the presign rotates", () => {
    const previous = { type: "custom" as const, dataUrl: first };
    const next = { type: "custom" as const, dataUrl: rotated };
    expect(preferStableChatWallpaper(previous, next)).toBe(previous);
  });

  it("takes the next URL when the wallpaper object changes", () => {
    const previous = { type: "custom" as const, dataUrl: first };
    const next = { type: "custom" as const, dataUrl: other };
    expect(preferStableChatWallpaper(previous, next)).toBe(next);
  });

  it("takes the next wallpaper when the preset changes", () => {
    const previous = { type: "custom" as const, dataUrl: first };
    const next = { type: "preset" as const, id: "mint" as const };
    expect(preferStableChatWallpaper(previous, next)).toBe(next);
  });

  it("strips query and fragment for the object key", () => {
    expect(chatWallpaperObjectKey(rotated)).toBe(objectPath);
  });
});
