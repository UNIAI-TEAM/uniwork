// A3ui (UNI-927) - i18n parity test for the Insert panel's own keys.
//
// The panel cannot touch the shared locale files (the UI-wire round owns them),
// so its keys live in `./insert-i18n`. This pins the contract the wire round
// depends on: vi and en carry the same key set, the same `{{vars}}`, and no
// blank copy - the same three rules `packages/core/i18n/parity.test.ts` applies
// to the real dictionaries.
import { describe, expect, it } from "vitest";
import { PPTX_INSERT_I18N, pptxInsertI18nVars, pptxInsertNestedDictionary } from "./insert-i18n";

const entries = Object.entries(PPTX_INSERT_I18N);

describe("pptx insert i18n", () => {
  it("keeps every key under the office.pptx.insert subtree", () => {
    for (const [key] of entries) expect(key.startsWith("office.pptx.insert."), key).toBe(true);
  });

  it("has no blank English or Vietnamese copy", () => {
    const blank = entries.filter(([, entry]) => entry.en.trim() === "" || entry.vi.trim() === "").map(([key]) => key);
    expect(blank).toEqual([]);
  });

  it("uses the same interpolation variables on both sides", () => {
    const mismatched = entries
      .filter(([, entry]) => pptxInsertI18nVars(entry.en).join(",") !== pptxInsertI18nVars(entry.vi).join(","))
      .map(([key]) => key);
    expect(mismatched).toEqual([]);
  });

  it("has no duplicate keys (the map literal already forbids them, this pins it)", () => {
    expect(entries.length).toBe(new Set(entries.map(([key]) => key)).size);
  });

  it("nests a locale dictionary under office.pptx.insert", () => {
    const en = pptxInsertNestedDictionary("en");
    const office = en.office as Record<string, unknown>;
    const pptx = office.pptx as Record<string, unknown>;
    const insert = pptx.insert as Record<string, unknown>;
    expect(insert.title).toBe(PPTX_INSERT_I18N["office.pptx.insert.title"]!.en);
    const shapes = insert.shapes as Record<string, unknown>;
    expect((shapes.prst as Record<string, unknown>).rect).toBe("Rectangle");
    const vi = pptxInsertNestedDictionary("vi");
    const viInsert = ((vi.office as Record<string, unknown>).pptx as Record<string, unknown>).insert as Record<string, unknown>;
    expect(viInsert.title).toBe(PPTX_INSERT_I18N["office.pptx.insert.title"]!.vi);
  });
});