// B8ui (UNI-927) - i18n parity test for the Media panel's own keys.
import { describe, expect, it } from "vitest";
import { PPTX_MEDIA_I18N, mediaPanelDictionary, pptxMediaI18nVars } from "./media-i18n";

const entries = Object.entries(PPTX_MEDIA_I18N);

describe("pptx media i18n", () => {
  it("keeps every key under the office.pptx.media subtree", () => {
    for (const [key] of entries) expect(key.startsWith("office.pptx.media."), key).toBe(true);
  });

  it("has no blank English or Vietnamese copy", () => {
    const blank = entries.filter(([, entry]) => entry.en.trim() === "" || entry.vi.trim() === "").map(([key]) => key);
    expect(blank).toEqual([]);
  });

  it("uses the same interpolation variables on both sides", () => {
    const mismatched = entries
      .filter(([, entry]) => pptxMediaI18nVars(entry.en).join(",") !== pptxMediaI18nVars(entry.vi).join(","))
      .map(([key]) => key);
    expect(mismatched).toEqual([]);
  });

  it("nests a locale dictionary under office.pptx.media", () => {
    const en = mediaPanelDictionary("en") as { office: { pptx: { media: Record<string, unknown> } } };
    expect(en.office.pptx.media.title).toBe(PPTX_MEDIA_I18N["office.pptx.media.title"]!.en);
    const vi = mediaPanelDictionary("vi") as { office: { pptx: { media: Record<string, unknown> } } };
    expect(vi.office.pptx.media.title).toBe(PPTX_MEDIA_I18N["office.pptx.media.title"]!.vi);
  });

  it("keeps every vi value free of lossy-channel corruption", () => {
    const suspicious = entries
      .filter(([, entry]) => /[A-Za-z]\?|\?[A-Za-z]/.test(entry.vi) || entry.vi.includes("\uFFFD"))
      .map(([key]) => key);
    expect(suspicious).toEqual([]);
  });
});