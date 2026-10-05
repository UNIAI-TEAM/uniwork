import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PPTX_SORTER_MESSAGES, pptxSorterI18nResources } from "./sorter-i18n";

/**
 * The panel's keys live here until the UI-wire round merges them into the shared
 * locale files. Two contracts must hold at that moment, so they are pinned now:
 *
 * 1. vi/en parity - every key has both strings and the same `{{vars}}`;
 * 2. the keys are EXACTLY the ones the panel calls through `t(...)` - a key the
 *    panel asks for and this table lacks would render as a raw key in the app.
 */
const PANEL_FILES = ["./sorter-panel.tsx", "./sorter-sections.tsx", "./sortable-slide-tile.tsx"];
const HELPERS_FILE = "./sorter-helpers.ts";

/** i18next JSON v4 plural forms collapse onto one stem (the panel calls the stem). */
const PLURAL_SUFFIXES = ["_zero", "_one", "_two", "_few", "_many", "_other"];

function stem(key: string): string {
  const suffix = PLURAL_SUFFIXES.find((candidate) => key.endsWith(candidate));
  return suffix ? key.slice(0, -suffix.length) : key;
}

function calledKeys(): Set<string> {
  const keys = new Set<string>();
  for (const file of PANEL_FILES) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    for (const match of source.matchAll(/t\(\s*"(office\.pptx\.[^"]+)"/g)) {
      keys.add(match[1] as string);
    }
  }
  // Standard layout names resolve through full-key literals in the helpers (the panel's t() takes them dynamically).
  const helpers = readFileSync(new URL(HELPERS_FILE, import.meta.url), "utf8");
  for (const match of helpers.matchAll(/"(office[.]pptx[.]sorter[.]layout[.][a-z_]+)"/g)) keys.add(match[1] as string);
  return keys;
}

function variablesOf(value: string): string[] {
  return [...value.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)].map((match) => match[1] as string).sort();
}

describe("sorter i18n table", () => {
  it("declares the exact keys the panel calls, plural stems collapsed", () => {
    const declared = new Set(Object.keys(PPTX_SORTER_MESSAGES));
    const called = calledKeys();
    expect(called.size).toBeGreaterThan(20);
    const declaredStems = new Set([...declared].map(stem));
    for (const key of called) expect(declaredStems.has(key), `missing table entry for ${key}`).toBe(true);
    const calledStems = new Set([...called].map(stem));
    for (const key of declared) expect(calledStems.has(stem(key)), `unused table entry ${key}`).toBe(true);
  });

  it("keeps vi/en parity with the same variables", () => {
    for (const [key, message] of Object.entries(PPTX_SORTER_MESSAGES)) {
      expect(message.en.trim().length, `${key} en`).toBeGreaterThan(0);
      expect(message.vi.trim().length, `${key} vi`).toBeGreaterThan(0);
      expect(variablesOf(message.vi), `${key} vars`).toEqual(variablesOf(message.en));
    }
  });

  it("uses the office.pptx.sorter/sections subtrees only", () => {
    for (const key of Object.keys(PPTX_SORTER_MESSAGES)) {
      expect(key.startsWith("office.pptx.sorter.") || key.startsWith("office.pptx.sections."), key).toBe(true);
    }
  });

  it("reshapes the flat table into nested i18next resources", () => {
    const resources = pptxSorterI18nResources({
      "office.pptx.sections.title": { en: "Sections", vi: "Phần" },
    });
    expect(resources.en).toEqual({ office: { pptx: { sections: { title: "Sections" } } } });
    expect(resources.vi).toEqual({ office: { pptx: { sections: { title: "Phần" } } } });
  });
});