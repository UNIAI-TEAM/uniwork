/**
 * Header/footer panel i18n (B7ui, UNI-927) - the panel's own dictionary.
 *
 * The shared locale files (`packages/core/i18n/locales/{en,vi}.json`) are edited
 * by the serialized UI-wire round, so this panel keeps every string it renders
 * in its own file: a flat map of the exact `office.pptx.headerfooter.*` keys the
 * components pass to `t()`, each with its `en` and `vi` copy. The UI-wire round
 * copies these entries into the shared locales (the `headerFooterPanelDictionary`
 * helper below produces the nested shape those files use).
 *
 * Key parity is a hard rule: both locales exist for every key, and both carry
 * the same `{{vars}}` - `headerfooter-i18n.test.ts` proves it.
 */

/** One key's copy in both supported locales. */
export interface PptxHeaderFooterI18nEntry {
  en: string;
  vi: string;
}

/** Every `office.pptx.headerfooter.*` key this panel renders, in source order. */
export const PPTX_HEADERFOOTER_I18N: Readonly<Record<string, PptxHeaderFooterI18nEntry>> = {
  "office.pptx.headerfooter.title": { en: "Header and footer", vi: "Đầu trang và chân trang" },
  "office.pptx.headerfooter.loading": {
    en: "Loading header and footer options...",
    vi: "Đang tải tuỳ chọn đầu trang và chân trang...",
  },
  "office.pptx.headerfooter.empty": {
    en: "Open a presentation to add a header or footer",
    vi: "Mở một bản trình bày để thêm đầu trang hoặc chân trang",
  },
  "office.pptx.headerfooter.busy": { en: "Applying...", vi: "Đang áp dụng..." },
  "office.pptx.headerfooter.error_title": {
    en: "The header and footer could not be applied",
    vi: "Không thể áp dụng đầu trang và chân trang",
  },
  "office.pptx.headerfooter.error_hint": {
    en: "The document was not changed. {{message}}",
    vi: "Tài liệu chưa bị thay đổi. {{message}}",
  },
  "office.pptx.headerfooter.unbound": {
    en: "Header and footer changes are not connected to this editor yet.",
    vi: "Thay đổi đầu trang và chân trang chưa được kết nối với trình soạn thảo này.",
  },
  "office.pptx.headerfooter.readonly": {
    en: "This presentation is read-only.",
    vi: "Bản trình bày này chỉ đọc.",
  },
  "office.pptx.headerfooter.footer_label": { en: "Footer text", vi: "Nội dung chân trang" },
  "office.pptx.headerfooter.footer_placeholder": {
    en: "Text shown at the bottom of every slide",
    vi: "Nội dung hiển thị ở cuối mỗi trang",
  },
  "office.pptx.headerfooter.slide_number_label": { en: "Slide number", vi: "Số trang" },
  "office.pptx.headerfooter.slide_number_hint": {
    en: "Show the slide number on every slide",
    vi: "Hiển thị số trang trên mọi trang",
  },
  "office.pptx.headerfooter.date_label": { en: "Date", vi: "Ngày" },
  "office.pptx.headerfooter.date_placeholder": { en: "Date text", vi: "Nội dung ngày" },
  "office.pptx.headerfooter.date_auto_label": { en: "Update automatically", vi: "Tự động cập nhật" },
  "office.pptx.headerfooter.date_auto_hint": {
    en: "Use a date field that PowerPoint refreshes when the file opens",
    vi: "Dùng trường ngày mà PowerPoint tự làm mới khi mở tệp",
  },
  "office.pptx.headerfooter.apply": { en: "Apply to all", vi: "Áp dụng cho tất cả" },
  "office.pptx.headerfooter.reset": { en: "Remove all", vi: "Xoá tất cả" },
  "office.pptx.headerfooter.reset_hint": {
    en: "Clear the footer, date and slide number from every slide",
    vi: "Xoá chân trang, ngày và số trang khỏi mọi trang",
  },
  "office.pptx.headerfooter.invalid_text": {
    en: "Keep the text under {{max}} characters.",
    vi: "Giữ nội dung dưới {{max}} ký tự.",
  },
  "office.pptx.headerfooter.no_changes": {
    en: "Add a footer, a date or the slide number first.",
    vi: "Hãy thêm chân trang, ngày hoặc số trang trước.",
  },
};

/** Locales this panel ships copy for. */
export type PptxHeaderFooterLocale = "en" | "vi";

/**
 * Nest the flat key map into the shape the shared locale files use, so the
 * UI-wire round can merge it verbatim (`office.pptx.headerfooter.*` -> nested
 * objects). Pure: no i18next instance is touched here.
 */
export function headerFooterPanelDictionary(locale: PptxHeaderFooterLocale): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(PPTX_HEADERFOOTER_I18N)) {
    const parts = key.split(".");
    let node = root;
    for (const part of parts.slice(0, -1)) {
      const next = node[part];
      if (typeof next !== "object" || next === null) node[part] = {};
      node = node[part] as Record<string, unknown>;
    }
    node[parts[parts.length - 1] as string] = entry[locale];
  }
  return root;
}