import { describe, expect, it } from "vitest";
import { listWindow } from "./use-windowed-list";

describe("listWindow", () => {
  it("mounts the rows in view plus a margin, padding the rest", () => {
    // 50px rows, 500px viewport scrolled to row 100.
    expect(listWindow(1000, 5000, 500, 50, 8)).toEqual({
      start: 92,
      end: 118,
      padTop: 92 * 50,
      padBottom: (1000 - 118) * 50,
    });
  });

  it("clamps at both ends of the list", () => {
    expect(listWindow(30, 0, 500, 50, 8)).toEqual({ start: 0, end: 18, padTop: 0, padBottom: 12 * 50 });
    expect(listWindow(30, 99_999, 500, 50, 8)).toEqual({ start: 30, end: 30, padTop: 1500, padBottom: 0 });
  });

  it("assumes a screenful before the container has a height", () => {
    const w = listWindow(1000, 0, 0, 0);
    expect(w.start).toBe(0);
    expect(w.end).toBeGreaterThan(10);
    expect(w.end).toBeLessThan(40);
  });
});
