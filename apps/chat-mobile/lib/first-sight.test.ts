import { describe, expect, it } from "vitest";
import { createFirstSight } from "./first-sight";

describe("createFirstSight", () => {
  it("is true the first time a key is seen and false after, per tracker", () => {
    const seen = createFirstSight(10);
    expect(seen("a")).toBe(true);
    expect(seen("a")).toBe(false);
    expect(seen("b")).toBe(true);
    expect(createFirstSight(10)("a")).toBe(true);
  });

  it("forgets the oldest key past its limit, so it stays small over a long session", () => {
    const seen = createFirstSight(2);
    seen("a");
    seen("b");
    seen("c");
    expect(seen("b")).toBe(false);
    expect(seen("c")).toBe(false);
    expect(seen("a")).toBe(true);
  });
});
