import { describe, expect, it } from "vitest";
import type { RendererRangeCell } from "../xlsx-render-model-bridge";
import {
  FIND_REPLACE_OP_LIMIT,
  buildFindReplacement,
  exceedsFindReplaceLimit,
  findCellText,
  findMatches,
  normalizeFindQuery,
  replaceInCellText,
  type XlsxFindMatch,
} from "./find-match";

const cell = (value: RendererRangeCell["value"], row = 0, column = 0, formula?: string): RendererRangeCell => ({
  row,
  column,
  value,
  ...(formula === undefined ? {} : { formula }),
});

describe("normalizeFindQuery", () => {
  it("trims the query and treats whitespace-only as empty", () => {
    expect(normalizeFindQuery("  abc  ")).toBe("abc");
    expect(normalizeFindQuery("")).toBeNull();
    expect(normalizeFindQuery("   ")).toBeNull();
  });
});

describe("findCellText", () => {
  it("maps the pinned display text and skips empty cells", () => {
    expect(findCellText(cell("abc"))).toBe("abc");
    expect(findCellText(cell(12.5))).toBe("12.5");
    expect(findCellText(cell(true))).toBe("1");
    expect(findCellText(cell(false))).toBe("0");
    expect(findCellText(cell(null))).toBeNull();
    expect(findCellText(cell(""))).toBeNull();
    expect(findCellText(cell(Number.NaN))).toBeNull();
  });
});

describe("findMatches", () => {
  const cells = [
    cell("Alpha", 1, 1),
    cell("alpha two", 0, 2),
    cell(null, 2, 0),
    cell("beta", 3, 0),
    cell("not here", 0, 1, "=SUM(A1:B1)"),
  ];

  it("returns matches in row-major order", () => {
    const matches = findMatches(cells, "a", false);
    expect(matches.map((match) => [match.row, match.column])).toEqual([[0, 2], [1, 1], [3, 0]]);
  });

  it("is case-insensitive by default and case-sensitive on request", () => {
    expect(findMatches(cells, "ALPHA", false)).toHaveLength(2);
    expect(findMatches(cells, "ALPHA", true)).toHaveLength(0);
    expect(findMatches(cells, "Alpha", true)).toHaveLength(1);
  });

  it("marks formula cells as matched but not replaceable", () => {
    const matches = findMatches(cells, "not here", false);
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ row: 0, column: 1, text: "not here", replaceable: false });
    expect(findMatches([cell("plain")], "plain", false)[0]?.replaceable).toBe(true);
  });

  it("has no matches for an empty query", () => {
    expect(findMatches(cells, "   ", false)).toEqual([]);
  });

  it("treats the query as a literal, never a pattern", () => {
    const literal = [cell("a.b", 0, 0), cell("axb", 0, 1)];
    expect(findMatches(literal, "a.b", false).map((match) => match.column)).toEqual([0]);
  });
});

describe("replaceInCellText", () => {
  it("replaces every occurrence, preserving the text around them", () => {
    expect(replaceInCellText("one two one", "one", "1", true)).toBe("1 two 1");
  });

  it("replaces case-insensitively when match-case is off", () => {
    expect(replaceInCellText("Alpha alpha", "ALPHA", "x", false)).toBe("x x");
    expect(replaceInCellText("Alpha alpha", "ALPHA", "x", true)).toBe("Alpha alpha");
  });

  it("keeps regex metacharacters and dollar signs literal", () => {
    expect(replaceInCellText("a.b", ".", "-", true)).toBe("a-b");
    expect(replaceInCellText("price", "price", "$&100", true)).toBe("$&100");
    expect(replaceInCellText("aa", "a", "$1", true)).toBe("$1$1");
  });

  it("returns the text unchanged for an empty query", () => {
    expect(replaceInCellText("abc", "  ", "x", false)).toBe("abc");
  });
});

describe("buildFindReplacement", () => {
  const match = (over: Partial<XlsxFindMatch> = {}): XlsxFindMatch => ({
    row: 0,
    column: 0,
    text: "old",
    replaceable: true,
    ...over,
  });

  it("builds the set-range-values record for writable matches", () => {
    const batch = buildFindReplacement([match({ row: 1, column: 2 })], "old", "new", false);
    expect(batch.count).toBe(1);
    expect(batch.value).toEqual({ "1": { "2": { v: "new" } } });
  });

  it("coerces replacements through the manual-typing value rule", () => {
    // "5" -> "7" in a number cell must stay numeric (SUM keeps counting it).
    expect(buildFindReplacement([match({ text: "5" })], "5", "7", false).value).toEqual({ "0": { "0": { v: 7 } } });
    expect(buildFindReplacement([match({ text: "1.50" })], "1.50", "-2.5", false).value).toEqual({ "0": { "0": { v: -2.5 } } });
    expect(buildFindReplacement([match({ text: "flag" })], "flag", "TRUE", false).value).toEqual({ "0": { "0": { v: true } } });
    expect(buildFindReplacement([match({ text: "old" })], "old", "beta", false).value).toEqual({ "0": { "0": { v: "beta" } } });
    expect(buildFindReplacement([match({ text: "old" })], "old", "", false).value).toEqual({ "0": { "0": { v: null } } });
    // A formula-looking replacement stays literal text: replace writes values.
    expect(buildFindReplacement([match({ text: "old" })], "old", "=A1", false).value).toEqual({ "0": { "0": { v: "=A1" } } });
  });

  it("skips formula matches and no-op replacements", () => {
    const batch = buildFindReplacement(
      [match({ replaceable: false }), match({ row: 5, text: "same" })],
      "same",
      "same",
      false,
    );
    expect(batch.count).toBe(0);
    expect(batch.value).toEqual({});
  });
});

describe("exceedsFindReplaceLimit", () => {
  it("refuses only above the engine's per-job op bound", () => {
    expect(FIND_REPLACE_OP_LIMIT).toBe(10_000);
    expect(exceedsFindReplaceLimit(0)).toBe(false);
    expect(exceedsFindReplaceLimit(FIND_REPLACE_OP_LIMIT)).toBe(false);
    expect(exceedsFindReplaceLimit(FIND_REPLACE_OP_LIMIT + 1)).toBe(true);
  });
});
