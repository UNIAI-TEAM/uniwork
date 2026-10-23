import { describe, expect, it } from "vitest";
import { bubbleImageSize, chatMediaSource, stableImageSource } from "./media-source";

describe("chatMediaSource", () => {
  it("keys a chat photo by its message and variant, whichever signed URL fetches it", () => {
    const a = chatMediaSource("https://s.example/f1?X-Amz-Date=20261021T090000Z&sig=a", "m1", "thumb");
    const b = chatMediaSource("https://s.example/f1?X-Amz-Date=20261021T100000Z&sig=b", "m1", "thumb");
    expect(a.cacheKey).toBe(b.cacheKey);
    expect(a.uri).not.toBe(b.uri);
    expect(chatMediaSource(a.uri, "m1", "full").cacheKey).not.toBe(a.cacheKey);
    expect(chatMediaSource(a.uri, "m2", "thumb").cacheKey).not.toBe(a.cacheKey);
  });
});

describe("stableImageSource", () => {
  it("keys an avatar by its path, not its signature", () => {
    expect(stableImageSource("https://s.example/avatars/f9.png?X-Amz-Signature=x#frag")).toEqual({
      uri: "https://s.example/avatars/f9.png?X-Amz-Signature=x#frag",
      cacheKey: "https://s.example/avatars/f9.png",
    });
    expect(stableImageSource("https://api.example/api/v1/avatar/u1").cacheKey).toBe("https://api.example/api/v1/avatar/u1");
  });
});

describe("bubbleImageSize", () => {
  it("draws a square without a size, as before", () => {
    expect(bubbleImageSize(undefined, undefined)).toEqual({ width: 230, height: 230 });
    expect(bubbleImageSize(1280, 0)).toEqual({ width: 230, height: 230 });
    expect(bubbleImageSize(-1, 10)).toEqual({ width: 230, height: 230 });
  });

  it("keeps a wide photo's shape at full width, never thinner than 120", () => {
    expect(bubbleImageSize(1280, 960)).toEqual({ width: 230, height: 173 });
    expect(bubbleImageSize(4000, 500)).toEqual({ width: 230, height: 120 });
  });

  it("keeps a tall photo's shape up to 300 high, never narrower than 120", () => {
    expect(bubbleImageSize(960, 1280)).toEqual({ width: 225, height: 300 });
    expect(bubbleImageSize(500, 4000)).toEqual({ width: 120, height: 300 });
  });
});
