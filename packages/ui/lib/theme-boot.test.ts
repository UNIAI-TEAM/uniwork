import { describe, expect, it } from "vitest";
import { themeBootScript } from "./theme-boot";

describe("themeBootScript", () => {
  it("runs without throwing", () => {
    expect(() => new Function(themeBootScript())()).not.toThrow();
  });
});
