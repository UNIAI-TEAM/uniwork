import { describe, expect, it } from "vitest";
import { MOBILE_RADIUS, continuousCorners } from "./radius";

describe("radius tokens", () => {
  it("carries the tokens.css ladder in px and the continuous curve style", () => {
    expect(MOBILE_RADIUS).toEqual({ sm: 6, md: 8, control: 10, lg: 12, xl: 16, "2xl": 20, "3xl": 32 });
    expect(continuousCorners).toEqual({ borderCurve: "continuous" });
  });
});
