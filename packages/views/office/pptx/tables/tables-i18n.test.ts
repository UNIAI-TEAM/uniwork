import { describe, expect, it } from "vitest";
import { PPTX_TABLES_I18N, tablesPanelDictionary } from "./tables-i18n";
import { PPTX_TABLE_STYLE_PRESETS } from "./table-model";

const ENTRY_RE = /^office\.pptx\.tables\.[A-Za-z0-9_.]+$/;

describe("PPTX_TABLES_I18N", () => {
  it("keeps every key under office.pptx.tables.* with en and vi copy", () => {
    const keys = Object.keys(PPTX_TABLES_I18N);
    expect(keys.length).toBeGreaterThan(30);
    for (const key of keys) {
      expect(key, key).toMatch(ENTRY_RE);
      const entry = PPTX_TABLES_I18N[key]!;
      expect(entry.en.trim().length, key + ".en").toBeGreaterThan(0);
      expect(entry.vi.trim().length, key + ".vi").toBeGreaterThan(0);
    }
  });

  it("carries the same {{vars}} in both locales for every key", () => {
    const vars = (value: string) =>
      (value.match(/\{\{\s*[a-zA-Z0-9_]+\s*\}\}/g) ?? []).map((v) => v.replace(/\s+/g, "")).sort();
    for (const [key, entry] of Object.entries(PPTX_TABLES_I18N)) {
      expect(vars(entry.vi), key).toEqual(vars(entry.en));
    }
  });

  it("has a name for every style preset and every anchor", () => {
    for (const preset of PPTX_TABLE_STYLE_PRESETS) {
      expect(PPTX_TABLES_I18N[preset.nameKey], preset.nameKey).toBeDefined();
    }
    for (const anchor of ["top", "middle", "bottom"]) {
      expect(PPTX_TABLES_I18N["office.pptx.tables.cell.anchor." + anchor]).toBeDefined();
    }
  });

  it("keeps every vi value free of lossy-channel corruption", () => {
    const suspicious = Object.entries(PPTX_TABLES_I18N)
      .filter(([, entry]) => /[A-Za-z]\?|\?[A-Za-z]/.test(entry.vi) || entry.vi.includes("\uFFFD"))
      .map(([key]) => key);
    expect(suspicious).toEqual([]);
  });
});

describe("tablesPanelDictionary", () => {
  it("nests the flat keys into the shared locale shape", () => {
    const en = tablesPanelDictionary("en") as {
      office: { pptx: { tables: { title: string; insert: { rows: string } } } };
    };
    expect(en.office.pptx.tables.title).toBe(PPTX_TABLES_I18N["office.pptx.tables.title"]!.en);
    expect(en.office.pptx.tables.insert.rows).toBe(PPTX_TABLES_I18N["office.pptx.tables.insert.rows"]!.en);
    const vi = tablesPanelDictionary("vi") as { office: { pptx: { tables: { title: string } } } };
    expect(vi.office.pptx.tables.title).toBe(PPTX_TABLES_I18N["office.pptx.tables.title"]!.vi);
  });

  it("produces the same leaf count as the flat map", () => {
    const countLeaves = (node: Record<string, unknown>): number =>
      Object.values(node).reduce<number>(
        (total, value) =>
          total + (typeof value === "object" && value !== null ? countLeaves(value as Record<string, unknown>) : 1),
        0,
      );
    expect(countLeaves(tablesPanelDictionary("en"))).toBe(Object.keys(PPTX_TABLES_I18N).length);
  });
});