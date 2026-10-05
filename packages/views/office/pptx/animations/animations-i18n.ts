// B5ui (UNI-927) - the Animations pane's own i18n keys.
//
// Same self-contained contract as the Transitions panel: the SHARED locale files
// belong to the chrome worker, so the pane carries its keys here and registers
// them into the shared i18next instance on import. The serialized UI-wire round
// copies these entries into en.json/vi.json (i18next keeps the locale file's
// value once it lands, because addResourceBundle uses overwrite=false).
//
// Keys are the exact office.pptx.* paths the pane passes to t().

import { createPptxI18nRegistrar } from "../i18n-registrar";

export interface PptxPanelI18nEntry {
  en: string;
  vi: string;
}

/** Flat office.pptx.* key -> { en, vi }. The UI-wire round copies these. */
export const PPTX_ANIMATIONS_I18N: Record<string, PptxPanelI18nEntry> = {
  "office.pptx.animations.panel_label": { en: "Animations", vi: "Hoạt ảnh" },
  "office.pptx.animations.list_label": { en: "Animation order", vi: "Thứ tự hoạt ảnh" },
  "office.pptx.animations.list_hint": {
    en: "Effects play top to bottom.",
    vi: "Các hiệu ứng chạy từ trên xuống dưới.",
  },
  "office.pptx.animations.empty": { en: "No animations on this slide", vi: "Trang này chưa có hoạt ảnh" },
  "office.pptx.animations.empty_hint": {
    en: "Add an effect to animate a shape or text.",
    vi: "Thêm hiệu ứng để tạo hoạt ảnh cho hình hoặc văn bản.",
  },
  "office.pptx.animations.no_slide": {
    en: "Select a slide to see its animations.",
    vi: "Chọn một trang để xem hoạt ảnh của trang đó.",
  },
  "office.pptx.animations.no_target": {
    en: "Select a shape or text box to add an animation.",
    vi: "Chọn một hình hoặc hộp văn bản để thêm hoạt ảnh.",
  },
  "office.pptx.animations.loading": {
    en: "Reading the slide animations…",
    vi: "Đang đọc hoạt ảnh của trang…",
  },
  "office.pptx.animations.error_title": {
    en: "The slide animations could not be read",
    vi: "Không đọc được hoạt ảnh của trang",
  },
  "office.pptx.animations.error_hint": {
    en: "The presentation is unchanged. {{message}}",
    vi: "Bản trình bày không thay đổi. {{message}}",
  },
  "office.pptx.animations.retry": { en: "Retry", vi: "Thử lại" },
  "office.pptx.animations.unbound": {
    en: "Animations are not connected to this editor yet.",
    vi: "Hoạt ảnh chưa được nối vào trình soạn thảo này.",
  },
  "office.pptx.animations.readonly": { en: "This presentation is read-only.", vi: "Bản trình bày này chỉ để đọc." },
  "office.pptx.animations.pending": { en: "Applying the animation change…", vi: "Đang áp dụng thay đổi hoạt ảnh…" },
  "office.pptx.animations.add_label": { en: "Add animation", vi: "Thêm hoạt ảnh" },
  "office.pptx.animations.add_hint": {
    en: "Adds the effect to the selected shape.",
    vi: "Thêm hiệu ứng vào hình đang chọn.",
  },
  "office.pptx.animations.effect_label": { en: "Effect", vi: "Hiệu ứng" },
  "office.pptx.animations.trigger_label": { en: "Start", vi: "Bắt đầu" },
  "office.pptx.animations.duration_label": { en: "Duration (seconds)", vi: "Thời lượng (giây)" },
  "office.pptx.animations.delay_label": { en: "Delay (seconds)", vi: "Độ trễ (giây)" },
  "office.pptx.animations.timing_invalid": {
    en: "Enter a number of seconds of 0 or more.",
    vi: "Nhập số giây từ 0 trở lên.",
  },
  "office.pptx.animations.move_up": { en: "Move up", vi: "Di chuyển lên" },
  "office.pptx.animations.move_down": { en: "Di chuyển xuống", vi: "Di chuyển xuống" },
  "office.pptx.animations.remove": { en: "Remove animation", vi: "Xóa hoạt ảnh" },
  "office.pptx.animations.preview": { en: "Preview", vi: "Xem trước" },
  "office.pptx.animations.preview_unbound": {
    en: "Preview is not connected to this editor yet.",
    vi: "Xem trước chưa được nối vào trình soạn thảo này.",
  },
  "office.pptx.animations.step": { en: "Step {{n}}", vi: "Bước {{n}}" },
  "office.pptx.animations.auto_step": { en: "Automatic", vi: "Tự động" },
  "office.pptx.animations.row_aria": {
    en: "{{effect}}, starts {{trigger}}",
    vi: "{{effect}}, bắt đầu {{trigger}}",
  },
  "office.pptx.animations.row_timing": {
    en: "{{trigger}} · {{duration}}",
    vi: "{{trigger}} · {{duration}}",
  },
  "office.pptx.animations.class.entrance": { en: "Entrance", vi: "Xuất hiện" },
  "office.pptx.animations.class.emphasis": { en: "Emphasis", vi: "Nhấn mạnh" },
  "office.pptx.animations.class.exit": { en: "Exit", vi: "Biến mất" },
  "office.pptx.animations.class.path": { en: "Motion path", vi: "Đường chuyển động" },
  "office.pptx.animations.trigger.onClick": { en: "On click", vi: "Khi bấm" },
  "office.pptx.animations.trigger.withPrev": { en: "With previous", vi: "Cùng hiệu ứng trước" },
  "office.pptx.animations.trigger.afterPrev": { en: "After previous", vi: "Sau hiệu ứng trước" },
  "office.pptx.animations.effect.appear": { en: "Appear", vi: "Xuất hiện" },
  "office.pptx.animations.effect.fade": { en: "Fade", vi: "Mờ dần" },
  "office.pptx.animations.effect.flyIn": { en: "Fly in", vi: "Bay vào" },
  "office.pptx.animations.effect.wipe": { en: "Wipe", vi: "Quét" },
  "office.pptx.animations.effect.wipeDown": { en: "Wipe down", vi: "Quét xuống" },
  "office.pptx.animations.effect.splitIn": { en: "Split", vi: "Tách" },
  "office.pptx.animations.effect.bounce": { en: "Bounce", vi: "Nảy" },
  "office.pptx.animations.effect.flipIn": { en: "Flip in", vi: "Lật vào" },
  "office.pptx.animations.effect.zoom": { en: "Zoom", vi: "Thu phóng" },
  "office.pptx.animations.effect.pulse": { en: "Pulse", vi: "Nhịp" },
  "office.pptx.animations.effect.spin": { en: "Spin", vi: "Xoay" },
  "office.pptx.animations.effect.grow": { en: "Grow", vi: "Phóng to" },
  "office.pptx.animations.effect.teeter": { en: "Teeter", vi: "Lắc lư" },
  "office.pptx.animations.effect.disappear": { en: "Disappear", vi: "Biến mất" },
  "office.pptx.animations.effect.fadeOut": { en: "Fade out", vi: "Mờ đi" },
  "office.pptx.animations.effect.flyOut": { en: "Fly out", vi: "Bay ra" },
  "office.pptx.animations.effect.wipeOut": { en: "Wipe out", vi: "Quét ra" },
  "office.pptx.animations.effect.shrink": { en: "Shrink", vi: "Thu nhỏ" },
  "office.pptx.animations.effect.zoomOut": { en: "Zoom out", vi: "Thu nhỏ dần" },
  "office.pptx.animations.effect.motionPath": { en: "Motion path", vi: "Đường chuyển động" },
};

/** Flat keys nested by dot, for one locale: { office: { pptx: { … } } }. */
export function pptxAnimationsResources(locale: "en" | "vi"): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(PPTX_ANIMATIONS_I18N)) {
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
export const ensurePptxAnimationsI18n = createPptxI18nRegistrar(pptxAnimationsResources);
