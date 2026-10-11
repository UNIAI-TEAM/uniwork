// Direct tests of the text fold machinery: radical folding, NFKC unit maps and
// the engine-codepoint splices that keep unedited text byte-identical.
import { describe, expect, it } from "vitest";

import { foldRadicals } from "./radicals.ts";
import { foldMap, mergeEngineCodepoints, norm, spliceIntoEngine } from "./text-fold.ts";

// Radical-block variants: U+2E84 stands for U+4E59, Kangxi U+2F00 for U+4E00.
const RAD_OTSU = "⺄";
const OTSU = "乙";
const KANGXI_ONE = "⼀";
const ONE = "一";

describe("foldRadicals", () => {
  it("maps radical-block codepoints to the unified ideograph", () => {
    expect(foldRadicals(`a${RAD_OTSU}b`)).toBe(`a${OTSU}b`);
  });

  it("returns text without radicals unchanged", () => {
    expect(foldRadicals("Tiếng Việt")).toBe("Tiếng Việt");
  });

  it("leaves an unmapped codepoint of the radical range as it is", () => {
    // U+2E80 sits inside the folded range but has no table entry
    expect(foldRadicals("⺀")).toBe("⺀");
  });
});

describe("norm", () => {
  it("drops whitespace and folds compatibility forms", () => {
    expect(norm("ﬁ  x y")).toBe("fixy");
  });

  it("makes a radical variant equal to the unified ideograph", () => {
    expect(norm(`${RAD_OTSU}${KANGXI_ONE}`)).toBe(norm(`${OTSU}${ONE}`));
  });

  it("keeps Vietnamese diacritics distinguishable", () => {
    expect(norm("đầy đủ")).toBe("đầyđủ");
    expect(norm("đầy")).not.toBe(norm("day"));
  });
});

describe("foldMap", () => {
  it("maps each folded unit back to its source char span", () => {
    const f = foldMap("ﬁx");
    expect(f.units).toEqual(["f", "i", "x"]);
    expect(f.idx).toEqual([0, 0, 1, 2]);
    expect(f.end).toEqual([1, 1, 2]);
  });

  it("drops whitespace unless asked to keep one collapsed space", () => {
    expect(foldMap("a  \n b").units).toEqual(["a", "b"]);
    const kept = foldMap("a  \n b", true);
    expect(kept.units).toEqual(["a", " ", "b"]);
    expect(kept.idx).toEqual([0, 1, 5, 6]);
  });

  it("counts an astral codepoint as one char of two code units", () => {
    const f = foldMap("😀a");
    expect(f.units).toEqual(["😀", "a"]);
    expect(f.idx).toEqual([0, 2, 3]);
    expect(f.end).toEqual([2, 3]);
  });

  it("treats ideographic and no-break spaces as whitespace", () => {
    expect(foldMap("a　b c").units).toEqual(["a", "b", "c"]);
  });
});

describe("spliceIntoEngine", () => {
  it("replaces only the changed middle", () => {
    expect(spliceIntoEngine("Hello World", "Hello World", "Hello Earth")).toBe("Hello Earth");
  });

  it("keeps the engine's own codepoints for the untouched head", () => {
    expect(spliceIntoEngine(`${RAD_OTSU}b`, `${OTSU}b`, `${OTSU}c`)).toBe(`${RAD_OTSU}c`);
  });

  it("keeps the engine's codepoints for an untouched tail", () => {
    expect(spliceIntoEngine(`a${RAD_OTSU}`, `a${OTSU}`, `z${OTSU}`)).toBe(`z${RAD_OTSU}`);
  });

  it("backs the cut off a ligature instead of splitting it", () => {
    // The engine holds the single ligature char; the edit changes the middle letter
    expect(spliceIntoEngine("ﬁx", "fix", "fax")).toBe("fax");
  });

  it("backs a split suffix off as well", () => {
    expect(spliceIntoEngine("ﬁ", "fi", "ai")).toBe("ai");
    expect(spliceIntoEngine("ﬁ", "fi", "fa")).toBe("fa");
  });

  it("keeps a ligature the line break would split as typed", () => {
    // the break falls inside the engine's single ligature char
    expect(spliceIntoEngine("ﬁx", "fix", "f\nix")).toBe("f\nix");
    expect(spliceIntoEngine("ﬁx", "fix", "a\nix")).toBe("a\nix");
  });

  it("keeps the engine's ligature on a line it does not cross", () => {
    expect(spliceIntoEngine("ﬁx", "fix", "fi\nx")).toBe("ﬁ\nx");
  });

  it("restores a word space the engine's line join ran together", () => {
    expect(spliceIntoEngine("abcdef", "abc def", "abc def\nxyz")).toBe("abc def\nxyz");
  });

  it("lets the engine's spacing survive around a retained boundary space", () => {
    expect(spliceIntoEngine("ab cd", "ab cd", "ab ce")).toBe("ab ce");
  });

  it("rebuilds a multi-line replacement line by line", () => {
    const out = spliceIntoEngine(`${RAD_OTSU}${KANGXI_ONE}`, `${OTSU}${ONE}`, `${OTSU}\n${ONE}x`);
    expect(out).toBe(`${RAD_OTSU}\n${ONE}x`);
  });

  it("restores the space a reflow moved across an old line seam", () => {
    // Engine join of two line objects carries no space between them
    const out = spliceIntoEngine("HelloWorld", "Hello World", "Hello\nWorld");
    expect(out).toBe("Hello\nWorld");
    const moved = spliceIntoEngine("abcdef", "abc def", "ab\ncdef");
    expect(moved).toBe("ab\ncdef");
  });

  it("types a new middle line while retaining engine text on unchanged lines", () => {
    const out = spliceIntoEngine("one" + RAD_OTSU, "one" + OTSU, "one\nnew\n" + OTSU);
    expect(out).toBe("one\nnew\n" + RAD_OTSU);
  });
});

describe("mergeEngineCodepoints", () => {
  it("keeps newText's line structure and swaps unchanged units back to the engine's", () => {
    expect(mergeEngineCodepoints(`${RAD_OTSU}${OTSU}`, `${OTSU}${OTSU}`, `${OTSU}\n${OTSU}x`)).toBe(
      `${RAD_OTSU}\n${OTSU}x`,
    );
  });

  it("returns newText untouched when the engine text does not match oldText's units", () => {
    expect(mergeEngineCodepoints("abc", "abcd", "abcde")).toBe("abcde");
  });

  it("writes the engine's variant for an unchanged tail", () => {
    expect(mergeEngineCodepoints(`a${RAD_OTSU}`, `a${OTSU}`, `b ${OTSU}`)).toBe(`b ${RAD_OTSU}`);
  });

  it("keeps a typed middle as typed", () => {
    expect(mergeEngineCodepoints("abc", "abc", "aXc")).toBe("aXc");
  });

  it("does not emit a ligature twice when it spans several units", () => {
    expect(mergeEngineCodepoints("ﬁx", "fix", "fix y")).toBe("ﬁx y");
  });

  it("backs off a boundary that would split a ligature", () => {
    expect(mergeEngineCodepoints("ﬁx", "fix", "fax")).toBe("fax");
    expect(mergeEngineCodepoints("ﬁx", "fix", "ix")).toBe("ix");
  });
});
