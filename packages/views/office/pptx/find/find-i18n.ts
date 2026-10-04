/**
 * Find & replace panel strings (A6ui, UNI-927).
 *
 * Per-panel i18n bundle, merged into `packages/core/i18n/locales/{en,vi}.json`
 * under `office.pptx.find` by the serialized wire round. This file never edits
 * the shared locales (the lane's shared-file rule), and every key here is also
 * present in the shared files with the same copy.
 */
export interface PptxFindI18nEntry {
  en: string;
  vi: string;
}

export const PPTX_FIND_I18N: Readonly<Record<string, PptxFindI18nEntry>> = {
  "office.pptx.find.title": { en: "Find and replace", vi: "Tìm và thay thế" },
  "office.pptx.find.label": { en: "Find and replace", vi: "Tìm và thay thế" },
  "office.pptx.find.query_label": { en: "Find", vi: "Tìm" },
  "office.pptx.find.query_placeholder": { en: "Find text", vi: "Tìm văn bản" },
  "office.pptx.find.replace_label": { en: "Replace with", vi: "Thay bằng" },
  "office.pptx.find.replace_placeholder": { en: "Replacement text", vi: "Văn bản thay thế" },
  "office.pptx.find.hint": { en: "Type to search the presentation", vi: "Nhập để tìm trong bản trình bày" },
  "office.pptx.find.match_case": { en: "Match case", vi: "Phân biệt chữ hoa chữ thường" },
  "office.pptx.find.matches": { en: "{{value}} matches", vi: "{{value}} kết quả" },
  "office.pptx.find.no_matches": { en: "No matches", vi: "Không có kết quả" },
  "office.pptx.find.hit_position": {
    en: "Match {{current}} of {{total}}",
    vi: "Kết quả {{current}} trên {{total}}",
  },
  "office.pptx.find.hit_slide": { en: "Slide {{index}}", vi: "Trang {{index}}" },
  "office.pptx.find.next": { en: "Find next", vi: "Tìm tiếp" },
  "office.pptx.find.previous": { en: "Find previous", vi: "Tìm lùi" },
  "office.pptx.find.replace_one": { en: "Replace", vi: "Thay thế" },
  "office.pptx.find.replace_all": { en: "Replace all", vi: "Thay thế tất cả" },
  "office.pptx.find.busy": { en: "Replacing…", vi: "Đang thay thế…" },
  "office.pptx.find.unbound": {
    en: "Find and replace are not connected to this editor yet.",
    vi: "Tìm và thay thế chưa được kết nối với trình soạn thảo này.",
  },
  "office.pptx.find.readonly": { en: "This presentation is read-only.", vi: "Bản trình bày này chỉ đọc." },
  "office.pptx.find.close": { en: "Close find and replace", vi: "Đóng tìm và thay thế" },
  "office.pptx.find.error_title": { en: "The replace failed", vi: "Thay thế thất bại" },
  "office.pptx.find.error_hint": {
    en: "The presentation is unchanged. {{message}}",
    vi: "Bản trình bày không thay đổi. {{message}}",
  },
};

/** Flat `{ key: text }` map for one locale, the shape i18next registers. */
export function findI18nResources(locale: "en" | "vi"): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(PPTX_FIND_I18N)) out[key] = value[locale];
  return out;
}