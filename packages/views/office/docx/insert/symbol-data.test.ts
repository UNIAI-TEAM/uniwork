import { describe, expect, it } from "vitest";
import { DOCX_SYMBOL_CATEGORIES, filterDocxSymbols } from "./symbol-data";

/** The search reads the localized name; the key stands in for one here. */
const translate = (key: string) => key;

describe("DOCX_SYMBOL_CATEGORIES", () => {
  it("covers the five common categories with unique glyphs and i18n names", () => {
    expect(DOCX_SYMBOL_CATEGORIES.map((group) => group.id)).toEqual([
      "currency",
      "arrows",
      "math",
      "punctuation",
      "greek",
    ]);
    const chars = DOCX_SYMBOL_CATEGORIES.flatMap((group) => group.symbols.map((entry) => entry.char));
    expect(new Set(chars).size).toBe(chars.length);
    for (const group of DOCX_SYMBOL_CATEGORIES) {
      expect(group.symbols.length).toBeGreaterThan(8);
      expect(group.labelKey).toBe(`office.docx.symbols.categories.${group.id}`);
      for (const entry of group.symbols) {
        expect(entry.nameKey.startsWith("office.docx.symbols.names.")).toBe(true);
      }
    }
  });
});

describe("filterDocxSymbols", () => {
  it("returns nothing for an empty query", () => {
    expect(filterDocxSymbols("", translate)).toEqual([]);
    expect(filterDocxSymbols("   ", translate)).toEqual([]);
  });

  it("matches a name across categories and ignores case", () => {
    expect(filterDocxSymbols("EURO", translate).map((entry) => entry.char)).toEqual(["€"]);
    expect(filterDocxSymbols("arrow", translate)).toHaveLength(12);
  });

  it("matches the glyph itself", () => {
    expect(filterDocxSymbols("∑", translate).map((entry) => entry.char)).toEqual(["∑"]);
    expect(filterDocxSymbols("₫", translate).map((entry) => entry.char)).toEqual(["₫"]);
  });

  it("returns no matches for an unknown query", () => {
    expect(filterDocxSymbols("zzzz", translate)).toEqual([]);
  });
});
