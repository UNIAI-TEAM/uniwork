import { describe, expect, it } from "vitest";
import { computeDropPosition } from "./position";

const rows = [
  { id: "a", position: 1024 },
  { id: "b", position: 2048 },
  { id: "c", position: 3072 },
];

describe("computeDropPosition", () => {
  it("empty column → 1024", () => {
    expect(computeDropPosition([], 0)).toBe(1024);
  });
  it("drop at head → half of first", () => {
    expect(computeDropPosition(rows, 0)).toBe(512);
  });
  it("drop in middle → midpoint of neighbours", () => {
    expect(computeDropPosition(rows, 1)).toBe(1536);
  });
  it("drop at tail → last + 1024", () => {
    expect(computeDropPosition(rows, 3)).toBe(4096);
  });
});
