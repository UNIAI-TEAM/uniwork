import { describe, expect, it } from "vitest";
import { fitWithin } from "./meeting-background-image";

describe("fitWithin", () => {
  it("shrinks the longest edge to the limit and keeps the aspect ratio", () => {
    expect(fitWithin(4000, 3000)).toEqual({ width: 1280, height: 960 });
    expect(fitWithin(1080, 1920)).toEqual({ width: 720, height: 1280 });
  });

  it("never enlarges a small image", () => {
    expect(fitWithin(640, 480)).toEqual({ width: 640, height: 480 });
  });
});
