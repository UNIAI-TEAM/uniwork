/**
 * Design panel i18n (B1 UI half, UNI-927) - the panel's own dictionary.
 *
 * The shared locale files (packages/core/i18n/locales/{en,vi}.json) belong to
 * the chrome worker, so this panel keeps every string it renders in its own
 * file: a flat map of the exact `office.pptx.design.*` keys the components pass
 * to `t()`, each with its `en` and `vi` copy. The serialized UI-wire round
 * copies these entries into the shared locales (the `designPanelDictionary`
 * helper below produces the nested shape those files use).
 *
 * Key parity is a hard rule: both locales exist for every key, and every key a
 * component can produce (theme names, slide-size presets) has an entry here -
 * `design-i18n.test.ts` proves it against the model's key builders.
 */

/** One key's copy in both supported locales. */
export interface PptxDesignI18nEntry {
  en: string;
  vi: string;
}

/** Every `office.pptx.design.*` key this panel renders, in source order. */
export const PPTX_DESIGN_I18N: Readonly<Record<string, PptxDesignI18nEntry>> = {
  "office.pptx.design.title": { en: "Design", vi: "Thiết kế" },
  "office.pptx.design.loading": { en: "Loading design options...", vi: "Đang tải các tuỳ chọn thiết kế..." },
  "office.pptx.design.empty": {
    en: "Open a presentation to change its design",
    vi: "Mở một bản trình bày để thay đổi thiết kế",
  },
  "office.pptx.design.busy": { en: "Applying...", vi: "Đang áp dụng..." },
  "office.pptx.design.error_title": {
    en: "The design change could not be applied",
    vi: "Không thể áp dụng thay đổi thiết kế",
  },
  "office.pptx.design.error_hint": {
    en: "The document was not changed. {{message}}",
    vi: "Tài liệu chưa bị thay đổi. {{message}}",
  },
  "office.pptx.design.unbound": {
    en: "Design changes are not connected to this editor yet.",
    vi: "Thay đổi thiết kế chưa được kết nối với trình soạn thảo này.",
  },
  "office.pptx.design.readonly": { en: "This presentation is read-only.", vi: "Bản trình bày này chỉ đọc." },
  "office.pptx.design.themes_label": { en: "Themes", vi: "Chủ đề" },
  "office.pptx.design.theme_group_label": { en: "Theme gallery", vi: "Thư viện chủ đề" },
  "office.pptx.design.theme_apply": { en: "Apply theme {{name}}", vi: "Áp dụng chủ đề {{name}}" },
  "office.pptx.design.theme_active": { en: "{{name}} (current theme)", vi: "{{name}} (chủ đề hiện tại)" },
  "office.pptx.design.theme.office": { en: "Office", vi: "Office" },
  "office.pptx.design.theme.slate": { en: "Slate", vi: "Đá phiến" },
  "office.pptx.design.theme.forest": { en: "Forest", vi: "Rừng xanh" },
  "office.pptx.design.theme.ember": { en: "Ember", vi: "Than hồng" },
  "office.pptx.design.theme.indigo": { en: "Indigo", vi: "Chàm" },
  "office.pptx.design.theme.midnight": { en: "Midnight", vi: "Nửa đêm" },
  "office.pptx.design.slide_size_label": { en: "Slide size", vi: "Kích thước trang" },
  "office.pptx.design.size_group_label": { en: "Slide size presets", vi: "Kích thước trang có sẵn" },
  "office.pptx.design.size.16_9": { en: "Widescreen (16:9)", vi: "Màn hình rộng (16:9)" },
  "office.pptx.design.size.4_3": { en: "Standard (4:3)", vi: "Tiêu chuẩn (4:3)" },
  "office.pptx.design.size.custom": {
    en: "Custom ({{width}} x {{height}} in)",
    vi: "Tuỳ chỉnh ({{width}} x {{height}} in)",
  },
  "office.pptx.design.layout_label": { en: "Layout", vi: "Bố cục" },
  "office.pptx.design.layout_group_label": { en: "Slide layouts", vi: "Bố cục trang" },
  "office.pptx.design.layout_empty": {
    en: "This presentation exposes no layouts",
    vi: "Bản trình bày này không có bố cục nào",
  },
  "office.pptx.design.layout_apply": { en: "Use layout {{name}}", vi: "Dùng bố cục {{name}}" },
  "office.pptx.design.layout_reset": { en: "Reset to master layout", vi: "Đặt lại về bố cục trang cái" },
  "office.pptx.design.background_label": { en: "Background", vi: "Nền" },
  "office.pptx.design.background_open": { en: "Format background", vi: "Định dạng nền" },
  "office.pptx.design.background_title": { en: "Format background", vi: "Định dạng nền" },
  "office.pptx.design.background_description": {
    en: "Set the fill for the selected slide or for every slide.",
    vi: "Đặt kiểu nền cho trang đang chọn hoặc cho mọi trang.",
  },
  "office.pptx.design.background_close": { en: "Close", vi: "Đóng" },
  "office.pptx.design.fill_group_label": { en: "Background fill", vi: "Kiểu nền" },
  "office.pptx.design.fill.solid": { en: "Solid", vi: "Màu đơn" },
  "office.pptx.design.fill.gradient": { en: "Gradient", vi: "Chuyển sắc" },
  "office.pptx.design.fill.image": { en: "Picture", vi: "Hình ảnh" },
  "office.pptx.design.solid_color": { en: "Fill color", vi: "Màu nền" },
  "office.pptx.design.gradient_from": { en: "Gradient start color", vi: "Màu bắt đầu" },
  "office.pptx.design.gradient_to": { en: "Gradient end color", vi: "Màu kết thúc" },
  "office.pptx.design.gradient_angle": { en: "Gradient angle in degrees", vi: "Góc chuyển sắc (độ)" },
  "office.pptx.design.gradient_radial": { en: "Radial gradient", vi: "Chuyển sắc toả tròn" },
  "office.pptx.design.image_choose": { en: "Choose a picture", vi: "Chọn hình ảnh" },
  "office.pptx.design.image_tile": { en: "Tile the picture", vi: "Lát hình ảnh" },
  "office.pptx.design.image_none": { en: "No picture selected", vi: "Chưa chọn hình ảnh" },
  "office.pptx.design.image_selected": { en: "Picture selected: {{name}}", vi: "Đã chọn hình ảnh: {{name}}" },
  "office.pptx.design.image_read_failed": { en: "The picture could not be read.", vi: "Không đọc được hình ảnh." },
  "office.pptx.design.hide_graphics": { en: "Hide background graphics", vi: "Ẩn hình nền của trang cái" },
  "office.pptx.design.apply_to_all": { en: "Apply to all slides", vi: "Áp dụng cho mọi trang" },
  "office.pptx.design.apply_to_all_hint": {
    en: "Use this background on all {{total}} slides",
    vi: "Dùng nền này cho tất cả {{total}} trang",
  },
  "office.pptx.design.reset": { en: "Reset background", vi: "Đặt lại nền" },
  "office.pptx.design.reset_hint": {
    en: "Restore the layout or master background",
    vi: "Khôi phục nền của bố cục hoặc trang cái",
  },
  "office.pptx.design.invalid_color": { en: "Enter a color as #RRGGBB.", vi: "Nhập màu theo dạng #RRGGBB." },
  "office.pptx.design.apply": { en: "Apply", vi: "Áp dụng" },
};

/** Locales this panel ships copy for. */
export type PptxDesignLocale = "en" | "vi";

/**
 * Nest the flat key map into the shape the shared locale files use, so the
 * UI-wire round can merge it verbatim (`office.pptx.design.*` -> nested
 * objects). Pure: no i18next instance is touched here.
 */
export function designPanelDictionary(locale: PptxDesignLocale): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(PPTX_DESIGN_I18N)) {
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