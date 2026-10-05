import { describe, expect, it } from "vitest";
import { firstFontFamily } from "./font-family-display";

describe("firstFontFamily", () => {
  it("returns the first family unquoted", () => {
    expect(firstFontFamily('"Times New Roman", serif')).toBe("Times New Roman");
    expect(firstFontFamily("Calibri, Arial")).toBe("Calibri");
  });
  it("returns null for empty or generic-only stacks", () => {
    expect(firstFontFamily("")).toBeNull();
    expect(firstFontFamily("sans-serif")).toBeNull();
  });
});
