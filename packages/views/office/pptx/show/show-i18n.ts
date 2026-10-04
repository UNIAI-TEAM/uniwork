"use client";

/**
 * Slide-show i18n keys (C2, UNI-927).
 *
 * Per-panel bundle, the same shape the transitions panel uses: every key the
 * show surface and the presenter view call through t() lives here, and the
 * shared locale files (packages/core/i18n/locales/{en,vi}.json) carry the same
 * entries under office.pptx.show.*. Registration is overwrite=false, so the
 * locale file wins once the keys land there.
 */
import { getI18n } from "react-i18next";

export interface PptxShowI18nEntry {
  en: string;
  vi: string;
}

/** Flat office.pptx.* key -> { en, vi }. */
export const PPTX_SHOW_I18N: Record<string, PptxShowI18nEntry> = {
  "office.pptx.show.label": { en: "Slide show", vi: "Trình chiếu" },
  "office.pptx.show.exit": { en: "End show", vi: "Kết thúc trình chiếu" },
  "office.pptx.show.next": { en: "Next slide", vi: "Trang tiếp theo" },
  "office.pptx.show.previous": { en: "Previous slide", vi: "Trang trước" },
  "office.pptx.show.counter": { en: "Slide {{current}} of {{total}}", vi: "Trang {{current}} / {{total}}" },
  "office.pptx.show.timer": { en: "Elapsed {{elapsed}}", vi: "Đã trình bày {{elapsed}}" },
  "office.pptx.show.notes": { en: "Speaker notes", vi: "Ghi chú diễn giả" },
  "office.pptx.show.notes_empty": { en: "No speaker notes for this slide.", vi: "Trang chiếu này chưa có ghi chú." },
  "office.pptx.show.current_slide": { en: "Current slide {{index}}", vi: "Trang hiện tại {{index}}" },
  "office.pptx.show.next_slide": { en: "Next slide {{index}}", vi: "Trang kế tiếp {{index}}" },
};

/** Flat keys nested by dot, for one locale: { office: { pptx: { ... } } }. */
export function pptxShowResources(locale: "en" | "vi"): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(PPTX_SHOW_I18N)) {
    const parts = key.split(".");
    let node = out;
    for (const part of parts.slice(0, -1)) {
      const existing = node[part];
      const next = existing && typeof existing === "object" ? (existing as Record<string, unknown>) : {};
      node[part] = next;
      node = next;
    }
    node[parts[parts.length - 1] as string] = entry[locale];
  }
  return out;
}

/** Register the show keys for every locale whose bundle is already loaded. */
export function registerPptxShowI18n(): void {
  const i18n = getI18n();
  for (const locale of ["en", "vi"] as const) {
    if (!i18n.hasResourceBundle(locale, "translation")) continue;
    i18n.addResourceBundle(locale, "translation", pptxShowResources(locale), true, false);
  }
}

registerPptxShowI18n();
{
  const i18n = getI18n();
  i18n.on("initialized", () => { registerPptxShowI18n(); });
  i18n.on("languageChanged", () => { registerPptxShowI18n(); });
}
