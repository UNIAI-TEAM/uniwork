// B4ui (UNI-927) - the Transitions panel's own i18n keys.
//
// The panel is self-contained: the SHARED locale files
// (packages/core/i18n/locales/{en,vi}.json) belong to the chrome worker, so
// this module carries every key the panel calls through t() and registers them
// into the shared i18next instance. The serialized UI-wire round copies the
// same entries into en.json/vi.json; i18next keeps the locale file's value when
// one already exists (addResourceBundle overwrite=false), so the copied entries
// win once they land and nothing here needs a second edit.
//
// Keys are the exact office.pptx.* paths the panel passes to t(); values are
// the vi (source) and en strings.

import { createPptxI18nRegistrar } from "../i18n-registrar";

export interface PptxPanelI18nEntry {
  en: string;
  vi: string;
}

/** Flat office.pptx.* key -> { en, vi }. The UI-wire round copies these. */
export const PPTX_TRANSITIONS_I18N: Record<string, PptxPanelI18nEntry> = {
  "office.pptx.transitions.panel_label": { en: "Transitions", vi: "Chuyển tiếp" },
  "office.pptx.transitions.gallery_label": { en: "Transition gallery", vi: "Thư viện chuyển tiếp" },
  "office.pptx.transitions.gallery_hint": {
    en: "Pick a transition for the current slide.",
    vi: "Chọn hiệu ứng chuyển tiếp cho trang hiện tại.",
  },
  "office.pptx.transitions.current": {
    en: "Current transition: {{name}}",
    vi: "Chuyển tiếp hiện tại: {{name}}",
  },
  "office.pptx.transitions.apply_to_all": { en: "Apply to all slides", vi: "Áp dụng cho tất cả trang" },
  "office.pptx.transitions.advance_label": { en: "Advance slide", vi: "Chuyển trang" },
  "office.pptx.transitions.advance_off": { en: "On mouse click", vi: "Khi bấm chuột" },
  "office.pptx.transitions.advance_on": { en: "Automatically after", vi: "Tự động sau" },
  "office.pptx.transitions.advance_seconds": { en: "Seconds", vi: "Giây" },
  "office.pptx.transitions.advance_invalid": {
    en: "Enter a number of seconds of 0 or more.",
    vi: "Nhập số giây từ 0 trở lên.",
  },
  "office.pptx.transitions.no_slide": {
    en: "Select a slide to set its transition.",
    vi: "Chọn một trang để đặt hiệu ứng chuyển tiếp.",
  },
  "office.pptx.transitions.loading": {
    en: "Reading the slide transition…",
    vi: "Đang đọc hiệu ứng chuyển tiếp…",
  },
  "office.pptx.transitions.error_title": {
    en: "The slide transition could not be read",
    vi: "Không đọc được hiệu ứng chuyển tiếp",
  },
  "office.pptx.transitions.error_hint": {
    en: "The presentation is unchanged. {{message}}",
    vi: "Bản trình bày không thay đổi. {{message}}",
  },
  "office.pptx.transitions.retry": { en: "Retry", vi: "Thử lại" },
  "office.pptx.transitions.unbound": {
    en: "Transitions are not connected to this editor yet.",
    vi: "Chuyển tiếp chưa được nối vào trình soạn thảo này.",
  },
  "office.pptx.transitions.pending": {
    en: "Applying the transition…",
    vi: "Đang áp dụng hiệu ứng chuyển tiếp…",
  },
  "office.pptx.transitions.readonly": {
    en: "This presentation is read-only.",
    vi: "Bản trình bày này chỉ để đọc.",
  },
  "office.pptx.transitions.kind.none": { en: "None", vi: "Không" },
  "office.pptx.transitions.kind.morph": { en: "Morph", vi: "Biến hình" },
  "office.pptx.transitions.kind.fade": { en: "Fade", vi: "Mờ dần" },
  "office.pptx.transitions.kind.push": { en: "Push", vi: "Đẩy" },
  "office.pptx.transitions.kind.wipe": { en: "Wipe", vi: "Quét" },
  "office.pptx.transitions.kind.split": { en: "Split", vi: "Tách" },
  "office.pptx.transitions.kind.circle": { en: "Circle", vi: "Vòng tròn" },
  "office.pptx.transitions.kind.cover": { en: "Cover", vi: "Che phủ" },
  "office.pptx.transitions.kind.pull": { en: "Pull", vi: "Kéo" },
  "office.pptx.transitions.kind.dissolve": { en: "Dissolve", vi: "Tan" },
  "office.pptx.transitions.kind.zoom": { en: "Zoom", vi: "Thu phóng" },
  "office.pptx.transitions.kind.random": { en: "Random", vi: "Ngẫu nhiên" },
};

/** Flat keys nested by dot, for one locale: { office: { pptx: { … } } }. */
export function pptxTransitionsResources(locale: "en" | "vi"): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(PPTX_TRANSITIONS_I18N)) {
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

/** Registers the panel's keys for every loaded locale (overwrite=false, so the
 * locale files win once the keys land there). Lazy and idempotent: importing
 * this module never touches i18next, the panel calls it on render. */
export const ensurePptxTransitionsI18n = createPptxI18nRegistrar(pptxTransitionsResources);
