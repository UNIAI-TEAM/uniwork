import { describe, expect, it } from "vitest";
import { contrastRatio, hslToRgb, relativeLuminance } from "./contrast";

describe("contrast", () => {
  it("reads hsl() tokens as sRGB", () => {
    expect(hslToRgb("hsl(0 0% 100%)")).toEqual([1, 1, 1]);
    expect(hslToRgb("hsl(0 100% 50%)")).toEqual([1, 0, 0]);
    expect(hslToRgb("hsl(240 100% 50%)")).toEqual([0, 0, 1]);
    expect(() => hslToRgb("#fff")).toThrow("not an hsl() token");
  });

  it("gives white and black their WCAG luminance and the 21:1 extreme, in either order", () => {
    expect(relativeLuminance("hsl(0 0% 100%)")).toBe(1);
    expect(relativeLuminance("hsl(0 0% 0%)")).toBe(0);
    expect(contrastRatio("hsl(0 0% 0%)", "hsl(0 0% 100%)")).toBe(21);
    expect(contrastRatio("hsl(0 0% 100%)", "hsl(0 0% 0%)")).toBe(21);
    // #767676 on white is the classic 4.54:1.
    expect(contrastRatio("hsl(0 0% 46.3%)", "hsl(0 0% 100%)")).toBeCloseTo(4.54, 1);
  });
});
