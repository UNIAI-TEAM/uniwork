import { describe, expect, it } from "vitest";
import en from "@uniwork/core/i18n/locales/en.json";
import viLocale from "@uniwork/core/i18n/locales/vi.json";
import {
  numberFormatCommandParams,
  selectionFormatCells,
  validateCustomFormat,
  XLSX_CUSTOM_FORMAT_MAX_LENGTH,
  XLSX_NUMBER_FORMAT_CATEGORIES,
  XLSX_NUMBER_FORMAT_COMMANDS,
  XLSX_NUMBER_FORMAT_MAX_CELLS,
} from "./catalog";

function flattenKeys(node: unknown, prefix = ""): string[] {
  if (!node || typeof node !== "object") return [];
  const paths: string[] = [];
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") paths.push(path);
    else paths.push(...flattenKeys(value, path));
  }
  return paths;
}

function numberFormatKeys(dictionary: unknown): string[] {
  const subtree = (dictionary as { office?: { xlsx?: { toolbar?: { groups?: { numberFormat?: unknown } } } } })
    ?.office?.xlsx?.toolbar?.groups?.numberFormat;
  return flattenKeys(subtree).sort();
}

describe("xlsx number format catalog", () => {
  it("covers the contracted categories with unique preset ids and non-empty patterns", () => {
    expect(XLSX_NUMBER_FORMAT_CATEGORIES.map((category) => category.id)).toEqual([
      "general", "number", "currency", "accounting", "date", "time", "percent", "text",
    ]);
    const ids = XLSX_NUMBER_FORMAT_CATEGORIES.flatMap((category) => category.presets.map((preset) => preset.id));
    expect(new Set(ids).size).toBe(ids.length);
    for (const category of XLSX_NUMBER_FORMAT_CATEGORIES) {
      expect(category.presets.length).toBeGreaterThan(0);
      for (const preset of category.presets) expect(preset.pattern.trim()).not.toBe("");
    }
  });

  it("pins the numfmt command ids and the key patterns", () => {
    expect(XLSX_NUMBER_FORMAT_COMMANDS).toEqual({
      set: "sheet.command.numfmt.set.numfmt",
      increaseDecimals: "sheet.command.numfmt.add.decimal.command",
      decreaseDecimals: "sheet.command.numfmt.subtract.decimal.command",
    });
    const patterns = new Map(
      XLSX_NUMBER_FORMAT_CATEGORIES.flatMap((category) => category.presets.map((preset) => [preset.id, preset.pattern])),
    );
    expect(patterns.get("general")).toBe("General");
    expect(patterns.get("number-thousands-decimal2")).toBe("#,##0.00");
    expect(patterns.get("currency-vnd")).toContain("₫");
    expect(patterns.get("currency-usd")).toContain("$");
    expect(patterns.get("currency-eur")).toContain("€");
    expect(patterns.get("date-iso")).toBe("yyyy-mm-dd");
    expect(patterns.get("percent-decimal2")).toBe("0.00%");
    expect(patterns.get("text")).toBe("@");
  });

  it("carries the same number-format keys in vi and en and resolves every catalog label", () => {
    const keys = numberFormatKeys(viLocale);
    expect(keys.length).toBeGreaterThan(0);
    expect(keys).toEqual(numberFormatKeys(en));
    const labelKeys = XLSX_NUMBER_FORMAT_CATEGORIES.flatMap((category) => [
      category.labelKey,
      ...category.presets.map((preset) => preset.labelKey),
    ]);
    const dotted = new Set(keys.map((key) => `office.xlsx.toolbar.groups.numberFormat.${key}`));
    for (const labelKey of labelKeys) expect(dotted.has(labelKey)).toBe(true);
  });
});

describe("validateCustomFormat", () => {
  it("accepts and trims a valid format code", () => {
    expect(validateCustomFormat("  #,##0.00  ")).toEqual({ pattern: "#,##0.00" });
    expect(validateCustomFormat("@")).toEqual({ pattern: "@" });
    expect(validateCustomFormat("0".repeat(XLSX_CUSTOM_FORMAT_MAX_LENGTH))).toEqual({
      pattern: "0".repeat(XLSX_CUSTOM_FORMAT_MAX_LENGTH),
    });
  });

  it("refuses empty, whitespace-only and over-long entries", () => {
    expect(validateCustomFormat("")).toEqual({ error: "empty" });
    expect(validateCustomFormat("   ")).toEqual({ error: "empty" });
    expect(validateCustomFormat("0".repeat(XLSX_CUSTOM_FORMAT_MAX_LENGTH + 1))).toEqual({ error: "tooLong" });
  });

  it("refuses line breaks and control characters, trimming pasted edge whitespace", () => {
    expect(validateCustomFormat("0.00\n")).toEqual({ pattern: "0.00" });
    expect(validateCustomFormat("0.0\n0")).toEqual({ error: "controlChar" });
    expect(validateCustomFormat("0.0\r0")).toEqual({ error: "controlChar" });
    expect(validateCustomFormat('0.00"a\u0007b"')).toEqual({ error: "controlChar" });
  });
});

describe("selectionFormatCells", () => {
  it("expands a single address and a range, normalizing reversed corners", () => {
    expect(selectionFormatCells(null)).toBeNull();
    expect(selectionFormatCells({ sheet: "S1", address: "B3" })).toEqual([{ row: 2, column: 1 }]);
    const range = selectionFormatCells({ sheet: "S1", address: "C1", endAddress: "D2" });
    expect(range).toEqual([
      { row: 0, column: 2 },
      { row: 0, column: 3 },
      { row: 1, column: 2 },
      { row: 1, column: 3 },
    ]);
    expect(selectionFormatCells({ sheet: "S1", address: "B2", endAddress: "A1" })).toEqual([
      { row: 0, column: 0 },
      { row: 0, column: 1 },
      { row: 1, column: 0 },
      { row: 1, column: 1 },
    ]);
    expect(selectionFormatCells({ sheet: "S1", address: "AA10" })).toEqual([{ row: 9, column: 26 }]);
  });

  it("refuses unparsable addresses and selections over the policy cell bound", () => {
    expect(selectionFormatCells({ sheet: "S1", address: "nope" })).toBeNull();
    expect(selectionFormatCells({ sheet: "S1", address: "A1", endAddress: "??" })).toBeNull();
    expect(selectionFormatCells({ sheet: "S1", address: "A1", endAddress: "CV1000" })).toHaveLength(
      XLSX_NUMBER_FORMAT_MAX_CELLS,
    );
    expect(selectionFormatCells({ sheet: "S1", address: "A1", endAddress: "CV1001" })).toBeNull();
  });

  it("builds the pinned set-numfmt params shape", () => {
    expect(numberFormatCommandParams([{ row: 0, column: 1 }], "0.00")).toEqual({
      values: [{ row: 0, col: 1, pattern: "0.00" }],
    });
  });
});
