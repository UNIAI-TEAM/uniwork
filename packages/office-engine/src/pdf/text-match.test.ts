// Edit matching over synthetic text objects: which objects an edit resolves to,
// what replacement it plans, and when it refuses. Pure — no pdfium needed.
import { describe, expect, it } from "vitest";

import type { TextEditInput } from "./types.ts";
import {
  canReuseFont,
  indexOfUnits,
  joinRows,
  matchBounds,
  matchEdit,
  readingOrder,
} from "./text-match.ts";
import type { PageTextObj } from "./text-match.ts";

let nextObj = 100;
const obj = (
  text: string,
  bounds: [number, number, number, number],
  extra: Partial<PageTextObj> = {},
): PageTextObj => ({ obj: nextObj++, index: nextObj, text, font: 1, bounds, ...extra });

const edit = (over: Partial<TextEditInput>): TextEditInput => ({
  pageIndex: 0,
  rect: [0, 0, 100, 10],
  oldText: "",
  newText: "",
  fontSize: 10,
  ...over,
});

describe("indexOfUnits", () => {
  it("finds the first occurrence of a unit subarray", () => {
    expect(indexOfUnits(["a", "b", "c", "b", "c"], ["b", "c"])).toBe(1);
  });

  it("returns -1 for a miss, an empty needle and a needle longer than the haystack", () => {
    expect(indexOfUnits(["a", "b"], ["c"])).toBe(-1);
    expect(indexOfUnits(["a", "b"], [])).toBe(-1);
    expect(indexOfUnits(["a"], ["a", "b"])).toBe(-1);
  });

  it("matches astral units as units, not as UTF-16 offsets", () => {
    expect(indexOfUnits(["😀", "x", "y"], ["y"])).toBe(2);
  });
});

describe("readingOrder / joinRows", () => {
  const top = obj("top", [0, 90, 30, 100]);
  const right = obj("right", [50, 50, 90, 60]);
  const left = obj("left", [0, 51, 40, 61]);

  it("reads rows top to bottom and x within a row", () => {
    expect(readingOrder([right, top, left]).map((o) => o.text)).toEqual(["top", "left", "right"]);
  });

  it("joins the texts in that order", () => {
    expect(joinRows([right, left, top])).toBe("topleftright");
  });

  it("starts a new row when the vertical overlap is under half", () => {
    const a = obj("a", [0, 50, 10, 60]);
    const b = obj("b", [20, 58, 30, 68]); // 2pt overlap of a 10pt line
    expect(readingOrder([a, b]).map((o) => o.text)).toEqual(["b", "a"]);
  });

  it("handles an empty list", () => {
    expect(readingOrder([])).toEqual([]);
  });
});

describe("matchBounds", () => {
  it("is the union of the objects' bounds", () => {
    expect(
      matchBounds([obj("a", [10, 20, 30, 40]), obj("b", [5, 25, 50, 35]), obj("c", [0, 30, 8, 60])]),
    ).toEqual([0, 20, 50, 60]);
  });

  it("returns a single object's bounds as a copy", () => {
    const a = obj("a", [1, 2, 3, 4]);
    const b = matchBounds([a]);
    expect(b).toEqual([1, 2, 3, 4]);
    expect(b).not.toBe(a.bounds);
  });
});

describe("canReuseFont", () => {
  const line = obj("Hello World", [0, 0, 100, 10]);
  const all = [line, obj("xyz", [0, 20, 30, 30], { font: 2 })];
  const can = (over: Partial<TextEditInput>, newText: string, whole = true, matches = [line]) =>
    canReuseFont(edit({ ...over, newText }), newText, matches, all, whole);

  it("reuses the face for an ASCII replacement drawn only from glyphs already in use", () => {
    expect(can({}, "Hello Hold")).toBe(true);
  });

  it("rebuilds when a glyph is not drawn anywhere with that font", () => {
    expect(can({}, "Hello Z")).toBe(false);
    // the glyph exists on the page, but with another font
    expect(can({}, "xyz")).toBe(false);
  });

  it("rebuilds for non-ASCII text", () => {
    expect(can({}, "Hèllo")).toBe(false);
  });

  it("rebuilds when more than one object matched", () => {
    expect(can({}, "Hello", true, [line, line])).toBe(false);
  });

  it("rebuilds for every style or position override", () => {
    expect(can({ newFontSize: 12 }, "Hello")).toBe(false);
    expect(can({ newColor: [1, 2, 3] }, "Hello")).toBe(false);
    expect(can({ newFont: "noto" }, "Hello")).toBe(false);
    expect(can({ lineXOffsets: [0] }, "Hello")).toBe(false);
    expect(can({ newItalic: true }, "Hello")).toBe(false);
    expect(can({ styleRuns: [{ start: 0, end: 2, bold: true }] }, "Hello")).toBe(false);
    expect(can({ colorRuns: [{ start: 0, end: 2, color: [1, 2, 3] }] }, "Hello")).toBe(false);
  });

  it("allows bold on the original face only for a whole-run match", () => {
    expect(can({ newBold: true }, "Hello", true)).toBe(true);
    expect(can({ newBold: true }, "Hello", false)).toBe(false);
    expect(can({ newBold: true, newFont: "noto" }, "Hello", true)).toBe(false);
  });

  it("accepts spaces and the empty string", () => {
    expect(can({}, "  ")).toBe(true);
    expect(can({}, "")).toBe(true);
  });
});

describe("matchEdit — whole-run matches", () => {
  it("resolves one object by rect and plans the spliced replacement", () => {
    const a = obj("Hello World", [0, 0, 80, 10]);
    const res = matchEdit(
      [a, obj("Other", [0, 50, 40, 60])],
      edit({ rect: [0, 0, 80, 10], oldText: "Hello World", newText: "Hello Earth" }),
    );
    expect(res).toEqual({ matches: [a], newText: "Hello Earth", whole: true });
  });

  it("matches through the NFKC fold and keeps the engine codepoints of the unchanged head", () => {
    const a = obj("ﬁne  day", [0, 0, 80, 10]);
    const res = matchEdit([a], edit({ rect: [0, 0, 80, 10], oldText: "fine day", newText: "fine night" }));
    expect(res).toMatchObject({ whole: true, newText: "ﬁne  night" });
  });

  it("joins a line of several objects whatever their content-stream order", () => {
    const right = obj("World", [50, 0, 100, 10]);
    const left = obj("Hello ", [0, 0, 50, 10]);
    const res = matchEdit(
      [right, left],
      edit({ rect: [0, 0, 100, 10], oldText: "Hello World", newText: "Hello Mars" }),
    );
    expect(res).toMatchObject({ whole: true, newText: "Hello Mars" });
    expect((res as { matches: PageTextObj[] }).matches).toHaveLength(2);
  });

  it("returns an empty replacement for a deletion and for whitespace-only newText", () => {
    const a = obj("gone", [0, 0, 40, 10]);
    expect(matchEdit([a], edit({ rect: [0, 0, 40, 10], oldText: "gone", newText: "" }))).toMatchObject({
      newText: "",
      whole: true,
    });
    expect(
      matchEdit([a], edit({ rect: [0, 0, 40, 10], oldText: "gone", newText: " \n  " })),
    ).toMatchObject({ newText: "", whole: true });
  });

  it("keeps newText's own line breaks for a paragraph rebuild (lineLeading set)", () => {
    const a = obj("one two", [0, 0, 80, 10]);
    const res = matchEdit(
      [a],
      edit({ rect: [0, 0, 80, 10], oldText: "one two", newText: "one\ntwo three", lineLeading: 12 }),
    );
    expect(res).toMatchObject({ newText: "one\ntwo three", whole: true });
  });

  it("separates stacked layers of one baseline and edits only the addressed layer", () => {
    // An earlier overflowing edit left two runs drawn over each other
    const first = obj("hello", [0, 0, 50, 10]);
    const second = obj("world", [0, 0, 50, 10]);
    const res = matchEdit(
      [first, second],
      edit({ rect: [0, 0, 50, 10], oldText: "world", newText: "earth" }),
    );
    expect(res).toMatchObject({ matches: [second], newText: "earth", whole: true });
  });

  it("ignores an object that only bleeds into the rect", () => {
    const neighbour = obj("below", [0, -9, 40, 1]);
    const target = obj("above", [0, 0, 40, 10]);
    const res = matchEdit([neighbour, target], edit({ rect: [0, 0, 40, 10], oldText: "above", newText: "ABOVE" }));
    expect(res).toMatchObject({ matches: [target], whole: true });
  });
});

describe("matchEdit — fragment of a container", () => {
  it("splices the fragment into the container object's whole text", () => {
    const a = obj("Hello big World", [0, 0, 150, 10]);
    const res = matchEdit([a], edit({ rect: [40, 0, 70, 10], oldText: "big", newText: "small" }));
    expect(res).toEqual({ matches: [a], newText: "Hello small World", whole: false });
  });

  it("keeps the gap whitespace when only the style changes (oldText === newText)", () => {
    const a = obj("Hello big World", [0, 0, 150, 10]);
    const res = matchEdit([a], edit({ rect: [40, 0, 70, 10], oldText: "big", newText: "big" }));
    expect(res).toMatchObject({ newText: "Hello big World", whole: false });
  });

  it("deletes a fragment by planning the container minus the fragment", () => {
    const a = obj("Hello big World", [0, 0, 150, 10]);
    const res = matchEdit([a], edit({ rect: [40, 0, 70, 10], oldText: "big", newText: "" }));
    expect(res).toMatchObject({ whole: false });
    expect((res as { newText: string }).newText.replace(/\s+/g, " ")).toMatch(/^Hello\s?World$|^Hello +World$/);
  });
});

describe("matchEdit — text-first rescue", () => {
  const left = obj("Hello ", [0, 0, 60, 10]);
  const right = obj("World", [60, 0, 110, 10]);

  it("finds a line whose edge object the rect clips below the containment threshold", () => {
    const res = matchEdit(
      [left, right],
      edit({ rect: [40, 0, 100, 10], oldText: "Hello World", newText: "Hello Mars" }),
    );
    expect(res).toMatchObject({ whole: true, newText: "Hello Mars" });
    expect((res as { matches: PageTextObj[] }).matches).toEqual([left, right]);
  });

  it("matches a fragment that starts and ends mid-object and keeps the outer text", () => {
    const res = matchEdit(
      [left, right],
      edit({ rect: [40, 0, 100, 10], oldText: "lo Wo", newText: "lo Xo" }),
    );
    expect(res).toMatchObject({ whole: false, newText: "Hello Xorld" });
  });

  it("refuses a fragment rescue that carries paragraph positioning", () => {
    const res = matchEdit(
      [left, right],
      edit({ rect: [40, 0, 100, 10], oldText: "lo Wo", newText: "lo Xo", origin: [0, 0] }),
    );
    expect(res).toEqual({ reason: "the edited text could not be located on the page" });
  });

  it("picks the occurrence whose bounds best overlap the rect when text repeats", () => {
    const one = obj("ab", [0, 0, 20, 10]);
    const two = obj("ab", [40, 0, 60, 10]);
    const res = matchEdit(
      [one, two],
      edit({ rect: [38, 0, 62, 10], oldText: "ab", newText: "cd" }),
    ) as { matches: PageTextObj[] };
    expect(res.matches).toEqual([two]);
  });
});

describe("matchEdit — refusals", () => {
  it("reports an edit whose text is not on the page", () => {
    const res = matchEdit([obj("abc", [0, 0, 30, 10])], edit({ rect: [0, 0, 30, 10], oldText: "zzz", newText: "y" }));
    expect(res).toEqual({ reason: "the edited text could not be located on the page" });
  });

  it("reports an empty page", () => {
    expect(matchEdit([], edit({ oldText: "abc", newText: "abd" }))).toEqual({
      reason: "the edited text could not be located on the page",
    });
  });

  it("reports an empty oldText as unlocatable", () => {
    expect(matchEdit([obj("abc", [0, 0, 30, 10])], edit({ rect: [0, 0, 30, 10], oldText: "", newText: "x" }))).toHaveProperty(
      "reason",
    );
  });
});
