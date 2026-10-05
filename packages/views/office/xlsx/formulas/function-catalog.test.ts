import { describe, expect, it } from "vitest";
import en from "@uniwork/core/i18n/locales/en.json";
import vi from "@uniwork/core/i18n/locales/vi.json";
import {
  functionCategoryLabelKey,
  functionInsertionText,
  matchFunctions,
  XLSX_FUNCTIONS,
  XLSX_FUNCTION_CATEGORIES,
} from "./function-catalog";

function lookup(dictionary: unknown, key: string): unknown {
  return key.split(".").reduce<unknown>((node, part) => {
    if (!node || typeof node !== "object") return undefined;
    return (node as Record<string, unknown>)[part];
  }, dictionary);
}

function stringPaths(dictionary: unknown): string[] {
  const paths: string[] = [];
  const walk = (node: unknown, prefix: string) => {
    if (!node || typeof node !== "object") return;
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (typeof value === "string") paths.push(path);
      else walk(value, path);
    }
  };
  walk(dictionary, "");
  return paths.sort();
}

describe("XLSX_FUNCTIONS catalog", () => {
  it("stays bounded and names every function once", () => {
    expect(XLSX_FUNCTIONS.length).toBeGreaterThanOrEqual(40);
    expect(XLSX_FUNCTIONS.length).toBeLessThanOrEqual(60);
    const names = XLSX_FUNCTIONS.map((spec) => spec.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(name).toBe(name.toUpperCase());
  });

  it("covers the usual categories and uses only declared ones", () => {
    const present = new Set(XLSX_FUNCTIONS.map((spec) => spec.category));
    expect([...present].sort()).toEqual([...XLSX_FUNCTION_CATEGORIES].sort());
    for (const category of XLSX_FUNCTION_CATEGORIES) {
      expect(XLSX_FUNCTIONS.filter((spec) => spec.category === category).length).toBeGreaterThan(0);
    }
  });

  it("gives every row a NAME(...) signature and a description key under the subtree", () => {
    for (const spec of XLSX_FUNCTIONS) {
      expect(spec.signature.startsWith(`${spec.name}(`)).toBe(true);
      expect(spec.signature.endsWith(")")).toBe(true);
      expect(spec.descriptionKey).toBe(`office.xlsx.formulas.fn.${spec.name.toLowerCase()}`);
    }
  });

  it("inserts =NAME( text and labels categories through the shared keys", () => {
    expect(functionInsertionText("sum")).toBe("=SUM(");
    expect(functionInsertionText("VLOOKUP")).toBe("=VLOOKUP(");
    expect(functionCategoryLabelKey("date")).toBe("office.xlsx.formulas.categories.date");
  });

  it("filters by category and case-insensitive name substring", () => {
    expect(matchFunctions("sum").map((spec) => spec.name)).toEqual(["SUM", "SUMIF", "SUMIFS", "SUMPRODUCT"]);
    expect(matchFunctions("vlook", "lookup").map((spec) => spec.name)).toEqual(["VLOOKUP"]);
    expect(matchFunctions("VLOOKUP", "text")).toEqual([]);
    expect(matchFunctions("", "financial").every((spec) => spec.category === "financial")).toBe(true);
    expect(matchFunctions("").length).toBe(XLSX_FUNCTIONS.length);
  });
});

describe("xlsx formulas i18n", () => {
  it("describes every catalog function and category in both locales", () => {
    for (const spec of XLSX_FUNCTIONS) {
      for (const locale of [en, vi]) {
        expect(typeof lookup(locale, spec.descriptionKey), `${spec.name} ${spec.descriptionKey}`).toBe("string");
      }
    }
    for (const category of XLSX_FUNCTION_CATEGORIES) {
      for (const locale of [en, vi]) {
        expect(typeof lookup(locale, functionCategoryLabelKey(category))).toBe("string");
      }
      expect(typeof lookup(en, "office.xlsx.formulas.categories.all")).toBe("string");
      expect(typeof lookup(vi, "office.xlsx.formulas.categories.all")).toBe("string");
    }
  });

  it("keeps the formulas subtree in vi/en key parity", () => {
    const subtree = (dictionary: unknown) => stringPaths(lookup(dictionary, "office.xlsx.formulas"));
    expect(subtree(vi).length).toBeGreaterThan(0);
    expect(subtree(vi)).toEqual(subtree(en));
  });
});
