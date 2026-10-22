import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { resetChatWallpapersForTests, useChatWallpaperStore } from "@uniwork/core/chat/chat-wallpaper-store";
import { ChatWallpaperPicker } from "./chat-wallpaper-picker";

initI18n();

beforeEach(() => resetChatWallpapersForTests());

describe("ChatWallpaperPicker", () => {
  it("selects a preset for one room only", () => {
    render(<ChatWallpaperPicker roomId="room-a" />);
    fireEvent.click(screen.getByRole("button", { name: "Trời xanh" }));
    expect(useChatWallpaperStore.getState().wallpaperFor("room-a")).toEqual({ type: "preset", id: "sky" });
    expect(useChatWallpaperStore.getState().wallpaperFor("room-b")).toEqual({ type: "default" });
  });
});
