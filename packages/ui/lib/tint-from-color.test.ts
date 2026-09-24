import { describe, expect, it } from "vitest";
import { tintFromColor } from "./tint-from-color";

describe("tintFromColor", () => {
  it("maps the server's seeded status colours onto their tints", () => {
    expect(tintFromColor("#ef4444")).toBe("red");
    expect(tintFromColor("#f59e0b")).toBe("yellow");
    expect(tintFromColor("#22c55e")).toBe("green");
    expect(tintFromColor("#3b82f6")).toBe("blue");
    expect(tintFromColor("#6b7280")).toBe("gray");
  });

  it("covers the remaining hues", () => {
    expect(tintFromColor("#7612fa")).toBe("violet");
    expect(tintFromColor("#fa12e3")).toBe("pink");
    expect(tintFromColor("#12a594")).toBe("teal");
    expect(tintFromColor("#f76808")).toBe("orange");
  });

  it("is gray for anything it cannot read", () => {
    expect(tintFromColor("")).toBe("gray");
    expect(tintFromColor(undefined)).toBe("gray");
    expect(tintFromColor("rebeccapurple")).toBe("gray");
    expect(tintFromColor("#ffffff")).toBe("gray");
  });
});
