import { describe, expect, it } from "vitest";
import { compareRows, compareTextBlocks, diffWords, summarizeCompare, type CompareEntry } from "./diff";

describe("compareTextBlocks", () => {
  it("reports identical documents as same entries and nothing else", () => {
    const entries = compareTextBlocks(["alpha", "beta"], ["alpha", "beta"]);
    expect(entries).toEqual([
      { kind: "same", left: "alpha", right: "alpha" },
      { kind: "same", left: "beta", right: "beta" },
    ]);
    expect(summarizeCompare(entries)).toEqual({ same: 2, added: 0, removed: 0, changed: 0 });
  });

  it("reports a block only the compared document has as added", () => {
    const entries = compareTextBlocks(["alpha"], ["alpha", "beta"]);
    expect(entries).toEqual([
      { kind: "same", left: "alpha", right: "alpha" },
      { kind: "added", left: null, right: "beta" },
    ]);
  });

  it("reports a block only the current document has as removed", () => {
    const entries = compareTextBlocks(["alpha", "beta"], ["alpha"]);
    expect(entries).toEqual([
      { kind: "same", left: "alpha", right: "alpha" },
      { kind: "removed", left: "beta", right: null },
    ]);
  });

  it("merges a removal followed by an addition into changed with word segments", () => {
    const entries = compareTextBlocks(["one two three"], ["one four three"]);
    expect(entries).toHaveLength(1);
    const entry = entries[0]!;
    expect(entry).toMatchObject({ kind: "changed", left: "one two three", right: "one four three" });
    expect(entry.leftWords).toEqual([
      { kind: "same", text: "one " },
      { kind: "removed", text: "two" },
      { kind: "same", text: " three" },
    ]);
    expect(entry.rightWords).toEqual([
      { kind: "same", text: "one " },
      { kind: "added", text: "four" },
      { kind: "same", text: " three" },
    ]);
  });

  it("keeps a mixed edit sequence in document order, deterministically", () => {
    const entries = compareTextBlocks(["keep", "old", "tail"], ["keep", "new", "tail", "extra"]);
    expect(entries.map((entry) => entry.kind)).toEqual(["same", "changed", "same", "added"]);
    expect(entries[1]).toMatchObject({ left: "old", right: "new" });
    expect(entries[3]).toMatchObject({ left: null, right: "extra" });
    // The walk must not depend on the input order of the two sides: swapping
    // the arguments swaps added/removed but keeps the same sequence length.
    const swapped = compareTextBlocks(["keep", "new", "tail", "extra"], ["keep", "old", "tail"]);
    expect(swapped.map((entry) => entry.kind)).toEqual(["same", "changed", "same", "removed"]);
  });

  it("treats two empty sides as identical and one-sided inputs as added/removed", () => {
    expect(compareTextBlocks([], [])).toEqual([]);
    expect(compareTextBlocks([], ["a", "b"])).toEqual([
      { kind: "added", left: null, right: "a" },
      { kind: "added", left: null, right: "b" },
    ]);
    expect(compareTextBlocks(["a", "b"], [])).toEqual([
      { kind: "removed", left: "a", right: null },
      { kind: "removed", left: "b", right: null },
    ]);
  });

  it("places every input row in exactly one entry, so nothing is dropped", () => {
    const left = ["a", "b", "c", "d"];
    const right = ["a", "x", "c", "d", "e"];
    const entries = compareTextBlocks(left, right);
    const leftRows = entries.filter((entry) => entry.kind !== "added").length;
    const rightRows = entries.filter((entry) => entry.kind !== "removed").length;
    expect(leftRows).toBe(left.length);
    expect(rightRows).toBe(right.length);
  });

  it("marks a changed pair even when the texts only differ in spacing", () => {
    const entries = compareTextBlocks(["hello  world"], ["hello world"]);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.kind).toBe("changed");
  });
});

describe("diffWords", () => {
  it("splits at token boundaries and keeps common words on both sides", () => {
    const { left, right } = diffWords("the quick brown fox", "the slow brown fox");
    expect(left).toEqual([
      { kind: "same", text: "the " },
      { kind: "removed", text: "quick" },
      { kind: "same", text: " brown fox" },
    ]);
    expect(right).toEqual([
      { kind: "same", text: "the " },
      { kind: "added", text: "slow" },
      { kind: "same", text: " brown fox" },
    ]);
  });

  it("marks a word inserted in the middle as added on the right only", () => {
    const { left, right } = diffWords("a b", "a very b");
    expect(left).toEqual([{ kind: "same", text: "a b" }]);
    expect(right).toEqual([
      { kind: "same", text: "a " },
      { kind: "added", text: "very " },
      { kind: "same", text: "b" },
    ]);
  });

  it("handles empty sides and text without words", () => {
    expect(diffWords("", "")).toEqual({ left: [], right: [] });
    expect(diffWords("", "x")).toEqual({ left: [], right: [{ kind: "added", text: "x" }] });
    expect(diffWords("x", "")).toEqual({ left: [{ kind: "removed", text: "x" }], right: [] });
    expect(diffWords("  ", " ")).toEqual({
      left: [{ kind: "removed", text: "  " }],
      right: [{ kind: "added", text: " " }],
    });
  });
});

describe("compareRows", () => {
  it("collapses unchanged runs between changed entries", () => {
    const entries: CompareEntry[] = [
      { kind: "same", left: "a", right: "a" },
      { kind: "same", left: "b", right: "b" },
      { kind: "changed", left: "c", right: "C" },
      { kind: "same", left: "d", right: "d" },
      { kind: "added", left: null, right: "e" },
    ];
    expect(compareRows(entries)).toEqual([
      { kind: "same", count: 2 },
      { kind: "entry", entry: entries[2] },
      { kind: "same", count: 1 },
      { kind: "entry", entry: entries[4] },
    ]);
  });

  it("returns a single run for an unchanged document", () => {
    const entries = compareTextBlocks(["a", "b"], ["a", "b"]);
    expect(compareRows(entries)).toEqual([{ kind: "same", count: 2 }]);
  });
});
