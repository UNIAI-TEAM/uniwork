// B3ui (UNI-927) - i18n parity test for the Charts panel's own keys.
//
// The panel cannot touch the shared locale files (the UI-wire round owns them),
// so its keys live in `./charts-i18n`. This pins the contract the wire round
// depends on: vi and en carry the same key set, the same `{{vars}}`, no blank
// copy, and a label for every chart kind and palette.
import { describe, expect, it } from "vitest";
import { CHART_KINDS } from "@uniwork/office-engine/pptx";
import { PPTX_CHART_LEGEND_POSITIONS, PPTX_CHART_PALETTES, chartKindLabelKey } from "./chart-model";
import { PPTX_CHARTS_I18N, PPTX_CHARTS_KIND_KEYS, pptxChartsResources } from "./charts-i18n";

const ENTRY_RE = /^office\.pptx\.charts\.[a-z0-9_.]+$/;

/** `{{var}}` names in a copy string, sorted. */
function vars(value: string): string[] {
  return (value.match(/\{\{\s*[a-zA-Z0-9_]+\s*\}\}/g) ?? []).map((match) => match.replace(/\s+/g, "")).sort();
}

describe("PPTX_CHARTS_I18N", () => {
  it("keeps every key under office.pptx.charts.* with en and vi copy", () => {
    const keys = Object.keys(PPTX_CHARTS_I18N);
    expect(keys.length).toBeGreaterThan(30);
    for (const key of keys) {
      expect(key, key).toMatch(ENTRY_RE);
      const entry = PPTX_CHARTS_I18N[key]!;
      expect(entry.en.trim().length, key + ".en").toBeGreaterThan(0);
      expect(entry.vi.trim().length, key + ".vi").toBeGreaterThan(0);
    }
  });

  it("carries the same {{vars}} in both locales", () => {
    for (const [key, entry] of Object.entries(PPTX_CHARTS_I18N)) {
      expect(vars(entry.vi), key).toEqual(vars(entry.en));
    }
  });

  it("has no duplicate keys", () => {
    const keys = Object.keys(PPTX_CHARTS_I18N);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("labels every chart kind the panel renders", () => {
    for (const kind of CHART_KINDS) {
      const entry = PPTX_CHARTS_I18N[chartKindLabelKey(kind)];
      expect(entry, "missing kind key for " + kind).toBeTruthy();
    }
    expect(PPTX_CHARTS_KIND_KEYS).toEqual(CHART_KINDS.map((kind) => chartKindLabelKey(kind)));
  });

  it("labels every palette and legend position", () => {
    for (const palette of PPTX_CHART_PALETTES) {
      expect(PPTX_CHARTS_I18N[palette.labelKey], palette.labelKey).toBeTruthy();
    }
    for (const position of PPTX_CHART_LEGEND_POSITIONS) {
      expect(PPTX_CHARTS_I18N["office.pptx.charts.legend." + position]).toBeTruthy();
    }
  });

  it("covers the static keys the panel calls through t()", () => {
    const called = [
      "office.pptx.charts.title",
      "office.pptx.charts.loading",
      "office.pptx.charts.empty",
      "office.pptx.charts.no_slide",
      "office.pptx.charts.no_selection",
      "office.pptx.charts.unbound",
      "office.pptx.charts.readonly",
      "office.pptx.charts.busy",
      "office.pptx.charts.error_title",
      "office.pptx.charts.error_hint",
      "office.pptx.charts.insert_section",
      "office.pptx.charts.insert_hint",
      "office.pptx.charts.insert",
      "office.pptx.charts.data_section",
      "office.pptx.charts.data_label",
      "office.pptx.charts.data_hint",
      "office.pptx.charts.data_apply",
      "office.pptx.charts.type_section",
      "office.pptx.charts.type_label",
      "office.pptx.charts.bar_dir_label",
      "office.pptx.charts.bar_dir.col",
      "office.pptx.charts.bar_dir.bar",
      "office.pptx.charts.style_section",
      "office.pptx.charts.title_label",
      "office.pptx.charts.title_placeholder",
      "office.pptx.charts.legend_label",
      "office.pptx.charts.data_labels",
      "office.pptx.charts.gridlines",
      "office.pptx.charts.palette_label",
      "office.pptx.charts.style_apply",
    ];
    const missing = called.filter((key) => !(key in PPTX_CHARTS_I18N));
    expect(missing).toEqual([]);
  });
});

describe("pptxChartsResources", () => {
  it("nests the flat keys into the shared locale shape for each locale", () => {
    const en = pptxChartsResources("en") as { office: { pptx: { charts: { title: string } } } };
    expect(en.office.pptx.charts.title).toBe(PPTX_CHARTS_I18N["office.pptx.charts.title"]!.en);
    const vi = pptxChartsResources("vi") as { office: { pptx: { charts: { title: string } } } };
    expect(vi.office.pptx.charts.title).toBe(PPTX_CHARTS_I18N["office.pptx.charts.title"]!.vi);
  });

  it("loses no key in nesting", () => {
    const countLeaves = (node: Record<string, unknown>): number =>
      Object.values(node).reduce<number>(
        (total, value) =>
          total + (typeof value === "object" && value !== null ? countLeaves(value as Record<string, unknown>) : 1),
        0,
      );
    expect(countLeaves(pptxChartsResources("en"))).toBe(Object.keys(PPTX_CHARTS_I18N).length);
  });
});