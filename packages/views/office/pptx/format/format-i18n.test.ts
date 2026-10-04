import { describe, expect, it } from "vitest";
import { PPTX_FORMAT_I18N, formatPanelDictionary } from "./format-i18n";
import { PPTX_FORMAT_DASHES, formatAlignKey, formatDashKey } from "./format-model";
import { PPTX_ALIGN_MODES, PPTX_TEXT_ANCHORS, PPTX_TEXT_AUTOFIT } from "@uniwork/office-engine/pptx";

const ENTRY_RE = /^office\.pptx\.format\.[a-z0-9_.]+$/;

describe("PPTX_FORMAT_I18N", () => {
  it("keeps every key under office.pptx.format.* with en and vi copy", () => {
    const keys = Object.keys(PPTX_FORMAT_I18N);
    expect(keys.length).toBeGreaterThan(50);
    for (const key of keys) {
      expect(key, key).toMatch(ENTRY_RE);
      const entry = PPTX_FORMAT_I18N[key]!;
      expect(entry.en.trim().length, `${key}.en`).toBeGreaterThan(0);
      expect(entry.vi.trim().length, `${key}.vi`).toBeGreaterThan(0);
    }
  });

  it("carries the same {{vars}} in both locales for every key", () => {
    const vars = (value: string) => (value.match(/\{\{\s*[a-zA-Z0-9_]+\s*\}\}/g) ?? []).map((v) => v.replace(/\s+/g, "")).sort();
    for (const [key, entry] of Object.entries(PPTX_FORMAT_I18N)) {
      expect(vars(entry.vi), key).toEqual(vars(entry.en));
    }
  });

  it("has a label for every engine vocabulary the panel renders", () => {
    for (const dash of PPTX_FORMAT_DASHES) {
      expect(PPTX_FORMAT_I18N[formatDashKey(dash)], dash).toBeDefined();
    }
    for (const mode of PPTX_ALIGN_MODES) {
      expect(PPTX_FORMAT_I18N[formatAlignKey(mode)], mode).toBeDefined();
    }
    for (const anchor of PPTX_TEXT_ANCHORS) {
      expect(PPTX_FORMAT_I18N["office.pptx.format.anchor." + anchor], anchor).toBeDefined();
    }
    for (const autofit of PPTX_TEXT_AUTOFIT) {
      expect(PPTX_FORMAT_I18N["office.pptx.format.autofit." + autofit], autofit).toBeDefined();
    }
  });

  it("covers the static keys the components call through t()", () => {
    const called = [
      "office.pptx.format.title",
      "office.pptx.format.loading",
      "office.pptx.format.busy",
      "office.pptx.format.empty",
      "office.pptx.format.unbound",
      "office.pptx.format.readonly",
      "office.pptx.format.error_title",
      "office.pptx.format.error_hint",
      "office.pptx.format.invalid_color",
      "office.pptx.format.invalid_number",
      "office.pptx.format.invalid_number_zero",
      "office.pptx.format.fill_label",
      "office.pptx.format.fill.solid",
      "office.pptx.format.fill.gradient",
      "office.pptx.format.fill.none",
      "office.pptx.format.fill_color",
      "office.pptx.format.gradient_from",
      "office.pptx.format.gradient_to",
      "office.pptx.format.gradient_angle",
      "office.pptx.format.gradient_radial",
      "office.pptx.format.line_label",
      "office.pptx.format.line.none",
      "office.pptx.format.line.solid",
      "office.pptx.format.line_color",
      "office.pptx.format.line_width",
      "office.pptx.format.line_dash",
      "office.pptx.format.effects_label",
      "office.pptx.format.shadow_label",
      "office.pptx.format.shadow_on",
      "office.pptx.format.shadow_color",
      "office.pptx.format.shadow_blur",
      "office.pptx.format.shadow_dist",
      "office.pptx.format.shadow_dir",
      "office.pptx.format.shadow_inner",
      "office.pptx.format.glow_label",
      "office.pptx.format.glow_on",
      "office.pptx.format.glow_color",
      "office.pptx.format.glow_radius",
      "office.pptx.format.soft_edge_label",
      "office.pptx.format.geometry_label",
      "office.pptx.format.geometry_prst",
      "office.pptx.format.geometry_hint",
      "office.pptx.format.adjust_label",
      "office.pptx.format.adjust_placeholder",
      "office.pptx.format.adjust_hint",
      "office.pptx.format.adjust_invalid",
      "office.pptx.format.arrange_label",
      "office.pptx.format.group",
      "office.pptx.format.ungroup",
      "office.pptx.format.flip_h",
      "office.pptx.format.flip_v",
      "office.pptx.format.align_label",
      "office.pptx.format.align_to_label",
      "office.pptx.format.align_to_selection",
      "office.pptx.format.align_to_slide",
      "office.pptx.format.distribute_h",
      "office.pptx.format.distribute_v",
      "office.pptx.format.need_two",
      "office.pptx.format.need_three",
      "office.pptx.format.need_group",
      "office.pptx.format.text_label",
      "office.pptx.format.anchor_label",
      "office.pptx.format.autofit_label",
      "office.pptx.format.wrap",
      "office.pptx.format.apply",
    ];
    const missing = called.filter((key) => !(key in PPTX_FORMAT_I18N));
    expect(missing).toEqual([]);
  });
});

describe("formatPanelDictionary", () => {
  it("nests the flat keys into the shared locale shape for each locale", () => {
    const en = formatPanelDictionary("en") as { office: { pptx: { format: { title: string; fill: { solid: string } } } } };
    expect(en.office.pptx.format.title).toBe(PPTX_FORMAT_I18N["office.pptx.format.title"]!.en);
    expect(en.office.pptx.format.fill.solid).toBe(PPTX_FORMAT_I18N["office.pptx.format.fill.solid"]!.en);
    const vi = formatPanelDictionary("vi") as { office: { pptx: { format: { title: string } } } };
    expect(vi.office.pptx.format.title).toBe(PPTX_FORMAT_I18N["office.pptx.format.title"]!.vi);
  });

  it("produces the same leaf count as the flat map (no key lost in nesting)", () => {
    const countLeaves = (node: Record<string, unknown>): number =>
      Object.values(node).reduce<number>(
        (total, value) => total + (typeof value === "object" && value !== null ? countLeaves(value as Record<string, unknown>) : 1),
        0,
      );
    expect(countLeaves(formatPanelDictionary("en"))).toBe(Object.keys(PPTX_FORMAT_I18N).length);
  });
});