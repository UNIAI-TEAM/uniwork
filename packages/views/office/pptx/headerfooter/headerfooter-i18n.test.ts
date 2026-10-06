import { describe, expect, it } from "vitest";
import { PPTX_HEADERFOOTER_I18N, headerFooterPanelDictionary } from "./headerfooter-i18n";

const ENTRY_RE = /^office\.pptx\.headerfooter\.[a-z0-9_.]+$/;

describe("PPTX_HEADERFOOTER_I18N", () => {
  it("keeps every key under office.pptx.headerfooter.* with en and vi copy", () => {
    const keys = Object.keys(PPTX_HEADERFOOTER_I18N);
    expect(keys.length).toBeGreaterThan(15);
    for (const key of keys) {
      expect(key, key).toMatch(ENTRY_RE);
      const entry = PPTX_HEADERFOOTER_I18N[key]!;
      expect(entry.en.trim().length, key + ".en").toBeGreaterThan(0);
      expect(entry.vi.trim().length, key + ".vi").toBeGreaterThan(0);
    }
  });

  it("carries the same {{vars}} in both locales for every key", () => {
    const vars = (value: string) =>
      (value.match(/\{\{\s*[a-zA-Z0-9_]+\s*\}\}/g) ?? []).map((v) => v.replace(/\s+/g, "")).sort();
    for (const [key, entry] of Object.entries(PPTX_HEADERFOOTER_I18N)) {
      expect(vars(entry.vi), key).toEqual(vars(entry.en));
    }
  });

  it("covers the static keys the panel calls through t()", () => {
    const called = [
      "office.pptx.headerfooter.title",
      "office.pptx.headerfooter.loading",
      "office.pptx.headerfooter.empty",
      "office.pptx.headerfooter.busy",
      "office.pptx.headerfooter.unbound",
      "office.pptx.headerfooter.readonly",
      "office.pptx.headerfooter.error_title",
      "office.pptx.headerfooter.error_hint",
      "office.pptx.headerfooter.footer_label",
      "office.pptx.headerfooter.footer_placeholder",
      "office.pptx.headerfooter.slide_number_label",
      "office.pptx.headerfooter.slide_number_hint",
      "office.pptx.headerfooter.date_label",
      "office.pptx.headerfooter.date_placeholder",
      "office.pptx.headerfooter.date_auto_label",
      "office.pptx.headerfooter.date_auto_hint",
      "office.pptx.headerfooter.apply",
      "office.pptx.headerfooter.reset",
      "office.pptx.headerfooter.reset_hint",
      "office.pptx.headerfooter.invalid_text",
      "office.pptx.headerfooter.no_changes",
    ];
    expect(called.filter((key) => !(key in PPTX_HEADERFOOTER_I18N))).toEqual([]);
  });

  it("keeps every vi value free of lossy-channel corruption", () => {
    const suspicious = Object.entries(PPTX_HEADERFOOTER_I18N)
      .filter(([, entry]) => /[A-Za-z]\?|\?[A-Za-z]/.test(entry.vi) || entry.vi.includes("\uFFFD"))
      .map(([key]) => key);
    expect(suspicious).toEqual([]);
  });
});

describe("headerFooterPanelDictionary", () => {
  it("nests the flat keys into the shared locale shape for each locale", () => {
    const en = headerFooterPanelDictionary("en") as {
      office: { pptx: { headerfooter: { title: string } } };
    };
    expect(en.office.pptx.headerfooter.title).toBe(PPTX_HEADERFOOTER_I18N["office.pptx.headerfooter.title"]!.en);
    const vi = headerFooterPanelDictionary("vi") as { office: { pptx: { headerfooter: { title: string } } } };
    expect(vi.office.pptx.headerfooter.title).toBe(PPTX_HEADERFOOTER_I18N["office.pptx.headerfooter.title"]!.vi);
  });

  it("produces the same leaf count as the flat map", () => {
    const countLeaves = (node: Record<string, unknown>): number =>
      Object.values(node).reduce<number>(
        (total, value) =>
          total + (typeof value === "object" && value !== null ? countLeaves(value as Record<string, unknown>) : 1),
        0,
      );
    expect(countLeaves(headerFooterPanelDictionary("en"))).toBe(Object.keys(PPTX_HEADERFOOTER_I18N).length);
  });
});