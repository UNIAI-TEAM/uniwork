import { describe, expect, it } from "vitest";
import { CHAT_WALL_DOT_CLASS, resolveChatWallSurface } from "./chat-wallpaper-resolve";

describe("resolveChatWallSurface", () => {
  it("keeps the dotted wall for the default choice", () => {
    expect(resolveChatWallSurface({ type: "default" }).className).toBe(CHAT_WALL_DOT_CLASS);
  });

  it("maps a custom image to a cover background", () => {
    const surface = resolveChatWallSurface({ type: "custom", dataUrl: "data:image/png;base64,abc" });
    expect(surface.style?.backgroundImage).toContain("data:image/png");
  });

  it("layers a repeating SVG pattern over a gradient preset", () => {
    const surface = resolveChatWallSurface({ type: "preset", id: "bloom" });
    expect(surface.style?.backgroundImage).toContain("data:image/svg+xml");
    expect(surface.style?.backgroundRepeat).toBe("repeat, no-repeat");
  });
});
