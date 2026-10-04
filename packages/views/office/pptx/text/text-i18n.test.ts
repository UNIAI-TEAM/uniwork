import { describe, expect, it } from "vitest";
import { PPTX_TEXT_I18N, pptxTextDictionary } from "./text-i18n";

describe("A1ui text i18n bundle", () => {
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

  it("keeps every key under office.pptx.text and nests under that subtree", () => {
    for (const key of Object.keys(PPTX_TEXT_I18N)) expect(key.startsWith("office.pptx.text."), key).toBe(true);
    expect(pptxTextDictionary("en")).toEqual({
      office: { pptx: { text: { target_label: "Double-click to edit this text", editor_label: "Edit slide text", hint: "Ctrl+Enter to save, Esc to cancel", empty_refused: "Text cannot be empty. Type something or press Esc to cancel." } } },
    });
  });
});