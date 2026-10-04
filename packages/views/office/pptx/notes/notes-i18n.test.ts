import { describe, expect, it } from "vitest";
import { PPTX_NOTES_I18N, notesI18nResources } from "./notes-i18n";
import { PPTX_COMMENTS_I18N } from "../comments/comments-i18n";

/** Every key the pane/panel call through t() is declared here; the UI-wire
 * round nests these under office.pptx.notes / office.pptx.comments. */
const ALL = { ...PPTX_NOTES_I18N, ...PPTX_COMMENTS_I18N };

describe("A5 panel i18n bundles", () => {
  it("carries an en and a vi string for every key, none empty", () => {
    for (const [key, value] of Object.entries(ALL)) {
      expect(value.en.trim(), key + " en").not.toBe("");
      expect(value.vi.trim(), key + " vi").not.toBe("");
    }
  });

  it("uses the same interpolation variables on both sides", () => {
    const vars = (text: string) => [...text.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort().join(",");
    for (const [key, value] of Object.entries(ALL)) {
      expect(vars(value.vi), key).toBe(vars(value.en));
    }
  });

  it("keeps every key under office.pptx.notes / office.pptx.comments", () => {
    for (const key of Object.keys(ALL)) {
      expect(key.startsWith("office.pptx.notes.") || key.startsWith("office.pptx.comments."), key).toBe(true);
    }
  });

  it("projects a flat { key: text } resource map per locale", () => {
    const en = notesI18nResources("en");
    const vi = notesI18nResources("vi");
    expect(Object.keys(en).sort()).toEqual(Object.keys(PPTX_NOTES_I18N).sort());
    expect(en["office.pptx.notes.title"]).toBe("Speaker notes");
    expect(vi["office.pptx.notes.title"]).toBe("Ghi chú trình bày");
  });
});
