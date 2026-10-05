/**
 * Hyperlink editor strings (A6ui, UNI-927).
 *
 * Per-panel i18n bundle, merged into `packages/core/i18n/locales/{en,vi}.json`
 * under `office.pptx.links` by the serialized wire round. This file never edits
 * the shared locales (the lane's shared-file rule).
 */
export interface PptxLinkI18nEntry {
  en: string;
  vi: string;
}

export const PPTX_LINK_I18N: Readonly<Record<string, PptxLinkI18nEntry>> = {
  "office.pptx.links.title": { en: "Hyperlink", vi: "Siêu liên kết" },
  "office.pptx.links.label": { en: "Edit hyperlink", vi: "Sửa siêu liên kết" },
  "office.pptx.links.mode_url": { en: "Web address", vi: "Địa chỉ web" },
  "office.pptx.links.mode_slide": { en: "Place in this document", vi: "Vị trí trong tài liệu" },
  "office.pptx.links.mode_action": { en: "Show action", vi: "Hành động trình chiếu" },
  "office.pptx.links.mode_label": { en: "Link type", vi: "Kiểu liên kết" },
  "office.pptx.links.url_label": { en: "Address", vi: "Địa chỉ" },
  "office.pptx.links.url_placeholder": { en: "https://example.com", vi: "https://example.com" },
  "office.pptx.links.slide_label": { en: "Go to slide", vi: "Đi tới trang" },
  "office.pptx.links.action_label": { en: "Action", vi: "Hành động" },
  "office.pptx.links.apply": { en: "Apply", vi: "Áp dụng" },
  "office.pptx.links.remove": { en: "Remove link", vi: "Xoá liên kết" },
  "office.pptx.links.close": { en: "Close", vi: "Đóng" },
  "office.pptx.links.none": { en: "No link", vi: "Chưa có liên kết" },
  "office.pptx.links.url_summary": { en: "Link: {{url}}", vi: "Liên kết: {{url}}" },
  "office.pptx.links.slide_summary": { en: "Jump to slide {{index}}", vi: "Tới trang {{index}}" },
  "office.pptx.links.invalid_url": {
    en: "Enter a web address such as https://example.com.",
    vi: "Nhập địa chỉ web, ví dụ https://example.com.",
  },
  "office.pptx.links.invalid_slide": { en: "Choose a slide in this deck.", vi: "Chọn một trang trong bản trình bày." },
  "office.pptx.links.invalid_action": { en: "Choose a show action.", vi: "Chọn một hành động trình chiếu." },
  "office.pptx.links.no_selection": {
    en: "Select an element to link.",
    vi: "Chọn một phần tử để gắn liên kết.",
  },
  "office.pptx.links.unbound": {
    en: "Hyperlinks are not connected to this editor yet.",
    vi: "Siêu liên kết chưa được kết nối với trình soạn thảo này.",
  },
  "office.pptx.links.busy": { en: "Applying the link…", vi: "Đang áp dụng liên kết…" },
  "office.pptx.links.error_title": { en: "The link could not be applied", vi: "Không áp dụng được liên kết" },
  "office.pptx.links.error_hint": {
    en: "The presentation is unchanged. {{message}}",
    vi: "Bản trình bày không thay đổi. {{message}}",
  },
  "office.pptx.links.action.nextslide": { en: "Next slide", vi: "Trang kế tiếp" },
  "office.pptx.links.action.previousslide": { en: "Previous slide", vi: "Trang trước" },
  "office.pptx.links.action.firstslide": { en: "First slide", vi: "Trang đầu" },
  "office.pptx.links.action.lastslide": { en: "Last slide", vi: "Trang cuối" },
  "office.pptx.links.action.lastslideviewed": { en: "Last slide viewed", vi: "Trang vừa xem" },
  "office.pptx.links.action.endshow": { en: "End show", vi: "Kết thúc trình chiếu" },
};

/** Flat `{ key: text }` map for one locale, the shape i18next registers. */
export function linkI18nResources(locale: "en" | "vi"): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(PPTX_LINK_I18N)) out[key] = value[locale];
  return out;
}