// THEME mirrors global.css: both modes name the same slots, every one an hsl()
// colour, so a token added to one mode cannot fall back to undefined in the other.
import { describe, expect, it } from "vitest";
import { THEME } from "./theme";

describe("THEME", () => {
  it("declares every slot in both modes, as an hsl() colour", () => {
    expect(Object.keys(THEME.dark).sort()).toEqual(Object.keys(THEME.light).sort());
    for (const value of [...Object.values(THEME.light), ...Object.values(THEME.dark)]) expect(value).toMatch(/^hsla?\(/);
  });
});
