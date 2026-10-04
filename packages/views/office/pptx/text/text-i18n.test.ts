import { describe, expect, it } from "vitest";
import { PPTX_TEXT_I18N, pptxTextDictionary } from "./text-i18n";
import { PPTX_TEXT_BULLET_OPTIONS, PPTX_TEXT_FONT_TOGGLES } from "./text-format-model";

const ENTRY_RE = /^office\.pptx\.text\.[a-z0-9_.]+$/;

describe("PPTX text i18n bundle", () => {
  it("carries an en and a vi string for every key, none empty", () => {
    for (const [key, value] of Object.entries(PPTX_TEXT_I18N)) {
      expect(value.en.trim(), key + " en").not.toBe("");
      expect(value.vi.trim(), key + " vi").not.toBe("");
    }
  });

  it("uses the same interpolation variables on both sides", () => {
    const vars = (text: string) => [...text.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort().join(",");
    for (const [key, value] of Object.entries(PPTX_TEXT_I18N)) expect(vars(value.vi), key).toBe(vars(value.en));
  });

  it("keeps every key under office.pptx.text with the expected shape", () => {
    for (const key of Object.keys(PPTX_TEXT_I18N)) expect(key, key).toMatch(ENTRY_RE);
  });

  it("keeps the four A1ui keys unchanged", () => {
    expect(PPTX_TEXT_I18N["office.pptx.text.target_label"]!.en).toBe("Double-click to edit this text");
    expect(PPTX_TEXT_I18N["office.pptx.text.editor_label"]!.en).toBe("Edit slide text");
    expect(PPTX_TEXT_I18N["office.pptx.text.hint"]!.en).toBe("Ctrl+Enter to save, Esc to cancel");
    expect(PPTX_TEXT_I18N["office.pptx.text.empty_refused"]!.en).toContain("Text cannot be empty");
  });

  it("has a label for every control vocabulary the panel renders", () => {
    for (const toggle of PPTX_TEXT_FONT_TOGGLES) {
      expect(PPTX_TEXT_I18N["office.pptx.text.format.toggle." + toggle], toggle).toBeDefined();
    }
    for (const bullet of PPTX_TEXT_BULLET_OPTIONS) {
      expect(PPTX_TEXT_I18N["office.pptx.text.format.bullet." + bullet], bullet).toBeDefined();
    }
    for (const align of ["left", "center", "right", "justify"]) {
      expect(PPTX_TEXT_I18N["office.pptx.text.format.align." + align], align).toBeDefined();
    }
  });

  it("nests the flat keys under office.pptx.text for each locale", () => {
    const en = pptxTextDictionary("en") as { office: { pptx: { text: Record<string, unknown> } } };
    expect(en.office.pptx.text.target_label).toBe(PPTX_TEXT_I18N["office.pptx.text.target_label"]!.en);
    const format = en.office.pptx.text.format as Record<string, unknown>;
    expect(format.title).toBe("Text");
    expect((format.toggle as Record<string, string>).bold).toBe("Bold");
    const vi = pptxTextDictionary("vi") as { office: { pptx: { text: { format: { title: string } } } } };
    expect(vi.office.pptx.text.format.title).toBe(PPTX_TEXT_I18N["office.pptx.text.format.title"]!.vi);
  });

  it("produces the same leaf count as the flat map (no key lost in nesting)", () => {
    const countLeaves = (node: Record<string, unknown>): number =>
      Object.values(node).reduce<number>(
        (total, value) => total + (typeof value === "object" && value !== null ? countLeaves(value as Record<string, unknown>) : 1),
        0,
      );
    expect(countLeaves(pptxTextDictionary("en"))).toBe(Object.keys(PPTX_TEXT_I18N).length);
  });
});
