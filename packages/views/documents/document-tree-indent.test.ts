import { describe, expect, it } from "vitest";
import { treeIconLeft, treeRowPaddingLeft } from "./document-tree-indent";

describe("tree indent columns", () => {
  it("steps 20px per level from 8px and caps at 120px", () => {
    expect([0, 1, 2, 6, 20].map(treeRowPaddingLeft)).toEqual([8, 28, 48, 120, 120]);
  });

  it("puts the icon box 20px past the row padding: 16px chevron slot, -4px pull, 8px gap", () => {
    expect([0, 1, 2].map(treeIconLeft)).toEqual([28, 48, 68]);
  });

  it("keeps each child's chevron column under its parent's icon", () => {
    expect(treeRowPaddingLeft(1)).toBe(treeIconLeft(0));
    expect(treeIconLeft(1) - treeIconLeft(0)).toBe(20);
  });
});
