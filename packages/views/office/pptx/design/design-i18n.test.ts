import { describe, expect, it } from "vitest";
import { PPTX_DESIGN_I18N, designPanelDictionary } from "./design-i18n";
import { PPTX_DESIGN_SLIDE_SIZES, PPTX_DESIGN_THEMES } from "./design-model";

const ENTRY_RE = /^office\.pptx\.design\.[a-z0-9_.]+$/;

describe("PPTX_DESIGN_I18N", () => {
  it("keeps every key under office.pptx.design.* with en and vi copy", () => {
    const keys = Object.keys(PPTX_DESIGN_I18N);
    expect(keys.length).toBeGreaterThan(30);
    for (const key of keys) {
      expect(key, key).toMatch(ENTRY_RE);
      const entry = PPTX_DESIGN_I18N[key]!;
      expect(entry, key).toBeTypeOf("object");
      expect(entry.en.trim().length, `${key}.en`).toBeGreaterThan(0);
      expect(entry.vi.trim().length, `${key}.vi`).toBeGreaterThan(0);
    }
  });

  it("carries the same {{vars}} in both locales for every key", () => {
    const vars = (value: string) => (value.match(/\{\{\s*[a-zA-Z0-9_]+\s*\}\}/g) ?? []).map((v) => v.replace(/\s+/g, "")).sort();
    for (const [key, entry] of Object.entries(PPTX_DESIGN_I18N)) {
      expect(vars(entry.vi), key).toEqual(vars(entry.en));
    }
  });

  it("has a name for every built-in theme and size preset", () => {
    for (const theme of PPTX_DESIGN_THEMES) {
      expect(PPTX_DESIGN_I18N[theme.nameKey], theme.nameKey).toBeDefined();
    }
    for (const preset of PPTX_DESIGN_SLIDE_SIZES) {
      expect(PPTX_DESIGN_I18N[preset.labelKey], preset.labelKey).toBeDefined();
    }
  });

  it("covers the static keys the components call through t()", () => {
    const called = [
      "office.pptx.design.title",
      "office.pptx.design.loading",
      "office.pptx.design.empty",
      "office.pptx.design.busy",
      "office.pptx.design.unbound",
      "office.pptx.design.error_title",
      "office.pptx.design.error_hint",
      "office.pptx.design.themes_label",
      "office.pptx.design.theme_group_label",
      "office.pptx.design.theme_apply",
      "office.pptx.design.theme_active",
      "office.pptx.design.slide_size_label",
      "office.pptx.design.size_group_label",
      "office.pptx.design.size.custom",
      "office.pptx.design.layout_label",
      "office.pptx.design.layout_group_label",
      "office.pptx.design.layout_empty",
      "office.pptx.design.layout_apply",
      "office.pptx.design.layout_reset",
      "office.pptx.design.background_label",
      "office.pptx.design.background_open",
      "office.pptx.design.background_title",
      "office.pptx.design.background_description",
      "office.pptx.design.background_close",
      "office.pptx.design.fill_group_label",
      "office.pptx.design.fill.solid",
      "office.pptx.design.fill.gradient",
      "office.pptx.design.fill.image",
      "office.pptx.design.solid_color",
      "office.pptx.design.gradient_from",
      "office.pptx.design.gradient_to",
      "office.pptx.design.gradient_angle",
      "office.pptx.design.gradient_radial",
      "office.pptx.design.image_choose",
      "office.pptx.design.image_tile",
      "office.pptx.design.image_none",
      "office.pptx.design.image_selected",
      "office.pptx.design.image_read_failed",
      "office.pptx.design.hide_graphics",
      "office.pptx.design.apply_to_all",
      "office.pptx.design.apply_to_all_hint",
      "office.pptx.design.reset",
      "office.pptx.design.reset_hint",
      "office.pptx.design.invalid_color",
      "office.pptx.design.apply",
    ];
    const missing = called.filter((key) => !(key in PPTX_DESIGN_I18N));
    expect(missing).toEqual([]);
  });
});

describe("designPanelDictionary", () => {
  it("nests the flat keys into the shared locale shape for each locale", () => {
    const en = designPanelDictionary("en") as { office: { pptx: { design: { title: string; fill: { solid: string } } } } };
    expect(en.office.pptx.design.title).toBe(PPTX_DESIGN_I18N["office.pptx.design.title"]!.en);
    expect(en.office.pptx.design.fill.solid).toBe(PPTX_DESIGN_I18N["office.pptx.design.fill.solid"]!.en);
    const vi = designPanelDictionary("vi") as { office: { pptx: { design: { title: string } } } };
    expect(vi.office.pptx.design.title).toBe(PPTX_DESIGN_I18N["office.pptx.design.title"]!.vi);
  });

  it("produces the same leaf count as the flat map (no key lost in nesting)", () => {
    const countLeaves = (node: Record<string, unknown>): number =>
      Object.values(node).reduce<number>((total, value) => total + (typeof value === "object" && value !== null ? countLeaves(value as Record<string, unknown>) : 1), 0);
    expect(countLeaves(designPanelDictionary("en"))).toBe(Object.keys(PPTX_DESIGN_I18N).length);
  });
});