// chainLayers: assigning same-baseline extents to z-layers.
import { describe, expect, it } from "vitest";

import { chainLayers } from "./x-layers";

const ext = (left: number, right: number) => ({ left, right });

describe("chainLayers", () => {
  it("returns no assignments for no extents", () => {
    expect(chainLayers([])).toEqual([]);
  });

  it("keeps non-overlapping extents of one line on a single chain", () => {
    expect(chainLayers([ext(0, 10), ext(12, 20), ext(22, 30)])).toEqual([0, 0, 0]);
  });

  it("puts a heavily overlapping extent on a new chain", () => {
    // The second run is drawn over the first: it must not read as the same line.
    expect(chainLayers([ext(0, 20), ext(2, 18)])).toEqual([0, 1]);
  });

  it("treats a small overlap (30% of the shorter run or less) as the same line", () => {
    expect(chainLayers([ext(0, 10), ext(9, 20)])).toEqual([0, 0]);
    // 4 of 10 overlaps more than 30% of the shorter extent, so it starts a new chain.
    expect(chainLayers([ext(0, 10), ext(6, 16)])).toEqual([0, 1]);
  });

  it("continues the chain whose tail is nearest", () => {
    // Tails end at 10 (chain 0) and 40 (chain 1); the next extent sits 5 from chain 1.
    expect(chainLayers([ext(0, 10), ext(0, 40), ext(45, 50)])).toEqual([0, 1, 1]);
  });

  it("lets the longer chain win when two tail gaps are within the tie margin", () => {
    // Chain 0 ends up with three members (tail 16-20), chain 1 with two (tail 11-25).
    // The last extent is 7 from chain 0 and 2 from chain 1.
    const extents = [ext(0, 10), ext(0, 10), ext(11, 15), ext(16, 20), ext(11, 25), ext(27, 30)];
    expect(chainLayers(extents, 0)).toEqual([0, 1, 0, 0, 1, 1]);
    expect(chainLayers(extents, 4)).toEqual([0, 1, 0, 0, 1, 1]);
    expect(chainLayers(extents, 5)).toEqual([0, 1, 0, 0, 1, 0]);
  });

  it("starts a fresh chain only when every existing chain overlaps", () => {
    const out = chainLayers([ext(0, 30), ext(5, 25), ext(10, 20)]);
    expect(out).toEqual([0, 1, 2]);
  });
});
