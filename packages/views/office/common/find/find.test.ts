import { describe, expect, it } from "vitest";
import {
  applyEdits,
  findMatches,
  type FindMatch,
  type FindQuery,
  type FindReplaceEdit,
  type FindResult,
} from "./index";

function query(overrides: Partial<FindQuery> & Pick<FindQuery, "text" | "query">): FindQuery {
  return { caseSensitive: false, wholeWord: false, regex: false, ...overrides };
}

/** Type-level checks for the barrel's public shapes. */
const MATCH: FindMatch = { start: 0, end: 1 };
const RESULT: FindResult = { matches: [MATCH], count: 1, invalidPattern: false };
const EDIT: FindReplaceEdit = { start: 0, end: 1, replacement: "x" };

/** A composed/decomposed pair that renders identically: "Nguyễn". */
const COMPOSED = "Nguyễn";
const DECOMPOSED = "Nguye\u0302\u0303n";

describe("findMatches literal", () => {
  it("exposes the result shape the barrel documents", () => {
    expect(RESULT.count).toBe(1);
    expect(applyEdits("a", [EDIT])).toBe("x");
  });

  it("returns every occurrence in order with original offsets", () => {
    const result = findMatches(query({ text: "one two one two one", query: "one" }));
    expect(result.matches).toEqual([
      { start: 0, end: 3 },
      { start: 8, end: 11 },
      { start: 16, end: 19 },
    ]);
    expect(result.count).toBe(3);
    expect(result.invalidPattern).toBe(false);
  });

  it("is case-insensitive by default and respects the flag when set", () => {
    expect(findMatches(query({ text: "Aa aA aa", query: "aa" })).count).toBe(3);
    expect(findMatches(query({ text: "Aa aA aa", query: "aa", caseSensitive: true })).matches).toEqual([
      { start: 6, end: 8 },
    ]);
  });

  it("does not overlap: aa in aaaa is two matches", () => {
    expect(findMatches(query({ text: "aaaa", query: "aa" })).matches).toEqual([
      { start: 0, end: 2 },
      { start: 2, end: 4 },
    ]);
  });

  it("returns no matches for an empty query or an empty document", () => {
    expect(findMatches(query({ text: "abc", query: "" })).count).toBe(0);
    expect(findMatches(query({ text: "", query: "a" })).count).toBe(0);
  });
});

describe("findMatches Vietnamese and Unicode", () => {
  it("matches accented text case-insensitively", () => {
    const result = findMatches(query({ text: "Phố Nguyễn Huệ", query: "nguyễn" }));
    expect(result.matches).toEqual([{ start: 4, end: 10 }]);
  });

  it("matches a composed query against decomposed text and maps offsets back", () => {
    const result = findMatches(query({ text: `Chị ${DECOMPOSED} ơi`, query: COMPOSED }));
    expect(result.count).toBe(1);
    // The reported range covers the original base letter AND its two marks.
    const match = result.matches[0]!;
    expect("Chị ".length).toBe(match.start);
    expect(`Chị ${DECOMPOSED}`.length).toBe(match.end);
  });

  it("matches a decomposed query against composed text", () => {
    const result = findMatches(query({ text: COMPOSED, query: DECOMPOSED }));
    expect(result.matches).toEqual([{ start: 0, end: COMPOSED.length }]);
  });

  it("never folds away a length-changing letter's offsets (İ)", () => {
    // Lowercasing U+0130 produces two code units, so the folded map must widen
    // the first unit back to the single original code unit.
    expect(findMatches(query({ text: "\u0130", query: "i\u0307" })).matches).toEqual([{ start: 0, end: 1 }]);
    // A match after it must still report original offsets, not folded ones.
    expect(findMatches(query({ text: "\u0130x", query: "x" })).matches).toEqual([{ start: 1, end: 2 }]);
  });
});

describe("findMatches wholeWord", () => {
  it("requires non-word characters on both sides", () => {
    const text = "cat concat cat.";
    expect(findMatches(query({ text, query: "cat", wholeWord: true })).matches).toEqual([
      { start: 0, end: 3 },
      { start: 11, end: 14 },
    ]);
  });

  it("treats Vietnamese accented letters as word characters", () => {
    const text = "Đường phố Đườngxá";
    expect(findMatches(query({ text, query: "Đường", wholeWord: true })).matches).toEqual([
      { start: 0, end: 5 },
    ]);
  });

  it("treats digits and underscore as word characters", () => {
    const text = "id id_2 id2";
    expect(findMatches(query({ text, query: "id", wholeWord: true })).matches).toEqual([{ start: 0, end: 2 }]);
  });

  it("accepts a match that spans the whole string", () => {
    expect(findMatches(query({ text: "cat", query: "cat", wholeWord: true })).count).toBe(1);
  });

  it("combines with regex", () => {
    const text = "cat concat cot";
    const result = findMatches(query({ text, query: "c.t", regex: true, wholeWord: true }));
    expect(result.matches).toEqual([
      { start: 0, end: 3 },
      { start: 11, end: 14 },
    ]);
  });
});

describe("findMatches regex", () => {
  it("matches code points, not surrogate halves (S4-1)", () => {
    const result = findMatches(query({ text: "a\u{1F600}b", query: ".", regex: true, caseSensitive: true }));
    expect(result.matches).toEqual([
      { start: 0, end: 1 },
      { start: 1, end: 3 },
      { start: 3, end: 4 },
    ]);
    // Replace-all must not write a lone surrogate back into the document.
    const replaced = applyEdits(
      "a\u{1F600}b",
      result.matches.map((match) => ({ start: match.start, end: match.end, replacement: "x" })),
    );
    expect(replaced).toBe("xxx");
    expect(replaced).not.toMatch(/[\uD800-\uDFFF]/u);
  });

  it("anchors ^ and $ per line (S4-4)", () => {
    expect(findMatches(query({ text: "a\nfoo", query: "^foo", regex: true })).matches).toEqual([
      { start: 2, end: 5 },
    ]);
    expect(findMatches(query({ text: "foo\nfoo", query: "^foo", regex: true })).count).toBe(2);
    expect(findMatches(query({ text: "foo\nbar", query: "foo$", regex: true })).matches).toEqual([
      { start: 0, end: 3 },
    ]);
  });

  it("compiles the query as a global pattern", () => {
    const result = findMatches(query({ text: "a1 b22 c333", query: "\\d+", regex: true }));
    expect(result.matches).toEqual([
      { start: 1, end: 2 },
      { start: 4, end: 6 },
      { start: 8, end: 11 },
    ]);
  });

  it("honours caseSensitive on the compiled pattern", () => {
    expect(findMatches(query({ text: "Ab aB", query: "ab", regex: true })).count).toBe(2);
    expect(findMatches(query({ text: "Ab aB", query: "ab", regex: true, caseSensitive: true })).count).toBe(0);
  });

  it("reports an invalid pattern as a typed state instead of throwing", () => {
    const result = findMatches(query({ text: "anything", query: "(", regex: true }));
    expect(result).toEqual({ matches: [], count: 0, invalidPattern: true });
  });

  it("reports an invalid pattern even on an empty query or document (S4-5)", () => {
    expect(findMatches(query({ text: "", query: "(", regex: true })).invalidPattern).toBe(true);
    expect(findMatches(query({ text: "abc", query: "", regex: true })).invalidPattern).toBe(false);
  });

  it("guards against zero-length matches looping forever", () => {
    expect(findMatches(query({ text: "abc", query: "^", regex: true })).count).toBe(0);
    expect(findMatches(query({ text: "abc", query: "(?=b)", regex: true })).count).toBe(0);
    expect(findMatches(query({ text: "bab", query: "a*", regex: true })).matches).toEqual([{ start: 1, end: 2 }]);
  });

  it("does not leak lastIndex between calls", () => {
    const input = query({ text: "a1 a2", query: "a\\d", regex: true });
    expect(findMatches(input)).toEqual(findMatches(input));
    expect(findMatches(input).count).toBe(2);
  });
});

describe("findMatches fold semantics (S4-6)", () => {
  // The fold is simple, per-unit and therefore asymmetric on purpose: it is
  // what keeps the offset map exact. These pins fail if a future change makes
  // folding length-changing, so the "fix" cannot land silently.
  it("folds \u0130 to i\u0307, so a shorter needle matches and a longer one does not", () => {
    expect(findMatches(query({ text: "\u0130", query: "i" })).matches).toEqual([{ start: 0, end: 1 }]);
    expect(findMatches(query({ text: "i", query: "\u0130" })).count).toBe(0);
  });

  it("uses simple folding, so the final sigma is not folded to sigma", () => {
    expect(findMatches(query({ text: "\u03c2", query: "\u03c3" })).count).toBe(0);
    expect(findMatches(query({ text: "\u03a3", query: "\u03c3" })).matches).toEqual([{ start: 0, end: 1 }]);
  });
});

describe("findMatches literal fold overlap (S4-3)", () => {
  it("keeps mapped ranges non-overlapping when folding widens a unit", () => {
    // `İ` folds to the two-unit piece "i\u0307", so the needle "̇i" (U+0307 +
    // "i") starts a second folded match one unit into the first one's original
    // range. The mapped ranges must stay non-overlapping.
    const result = findMatches(query({ text: "\u0130\u0130i", query: "\u0307i" }));
    expect(result.matches).toEqual([{ start: 0, end: 2 }]);
    expect(result.count).toBe(1);
    for (let i = 1; i < result.matches.length; i += 1) {
      expect(result.matches[i]!.start).toBeGreaterThanOrEqual(result.matches[i - 1]!.end);
    }
    // Every counted match is applied, so the counter cannot lie.
    const edits = result.matches.map((match) => ({ start: match.start, end: match.end, replacement: "X" }));
    expect(edits).toHaveLength(result.count);
    expect(applyEdits("\u0130\u0130i", edits)).toBe("Xi");
  });
});

describe("applyEdits", () => {
  it("applies edits left to right", () => {
    const text = "one two one";
    expect(
      applyEdits(text, [
        { start: 0, end: 3, replacement: "1" },
        { start: 8, end: 11, replacement: "2" },
      ]),
    ).toBe("1 two 2");
  });

  it("accepts a replacement list straight from findMatches", () => {
    const text = "cat cat";
    const edits = findMatches(query({ text, query: "cat" })).matches.map((match) => ({
      start: match.start,
      end: match.end,
      replacement: "dog",
    }));
    expect(applyEdits(text, edits)).toBe("dog dog");
  });

  it("skips an overlapping edit rather than corrupting the text", () => {
    expect(applyEdits("abcdef", [
      { start: 0, end: 4, replacement: "X" },
      { start: 2, end: 6, replacement: "Y" },
    ])).toBe("Xef");
  });

  it("returns the text unchanged for no edits", () => {
    expect(applyEdits("abc", [])).toBe("abc");
  });
});
