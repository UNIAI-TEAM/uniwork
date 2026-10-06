/**
 * Format panel i18n (A4ui, UNI-927) - the panel's own dictionary.
 *
 * Same self-contained contract as the Design / Insert / Animations panels: the
 * SHARED locale files (packages/core/i18n/locales/{en,vi}.json) belong to the
 * chrome worker, so this panel keeps every string it renders in its own file -
 * a flat map of the exact `office.pptx.format.*` keys the components pass to
 * `t()`, each with its `en` and `vi` copy. The serialized UI-wire round copies
 * these entries into the shared locales (the `formatPanelDictionary` helper
 * below produces the nested shape those files use).
 *
 * Key parity is a hard rule: both locales exist for every key, every key a
 * component can produce (fill modes, dash names, anchors, autofit modes, align
 * modes) has an entry here, and both locales carry the same `{{vars}}` -
 * `format-i18n.test.ts` proves it against the model's vocabularies.
 */

/** One key's copy in both supported locales. */
export interface PptxFormatI18nEntry {
  en: string;
  vi: string;
}

/** Every `office.pptx.format.*` key this panel renders, in source order. */
export const PPTX_FORMAT_I18N: Readonly<Record<string, PptxFormatI18nEntry>> = {
  "office.pptx.format.title": { en: "Format", vi: "Định dạng" },
  "office.pptx.format.sections_label": { en: "Format tools", vi: "Công cụ định dạng" },
  "office.pptx.format.loading": { en: "Loading the format tools...", vi: "Đang tải công cụ định dạng..." },
  "office.pptx.format.busy": { en: "Applying...", vi: "Đang áp dụng..." },
  "office.pptx.format.empty": {
    en: "Select an element to format it",
    vi: "Chọn một đối tượng để định dạng",
  },
  "office.pptx.format.unbound": {
    en: "Format changes are not connected to this editor yet.",
    vi: "Thay đổi định dạng chưa được kết nối với trình soạn thảo này.",
  },
  "office.pptx.format.readonly": { en: "This presentation is read-only.", vi: "Bản trình bày này chỉ đọc." },
  "office.pptx.format.error_title": {
    en: "The format change could not be applied",
    vi: "Không thể áp dụng thay đổi định dạng",
  },
  "office.pptx.format.error_hint": {
    en: "The document was not changed. {{message}}",
    vi: "Tài liệu chưa bị thay đổi. {{message}}",
  },
  "office.pptx.format.invalid_color": { en: "Enter a color as #RRGGBB.", vi: "Nhập màu theo dạng #RRGGBB." },
  "office.pptx.format.invalid_number": { en: "Enter a number greater than 0.", vi: "Nhập một số lớn hơn 0." },
  "office.pptx.format.invalid_number_zero": { en: "Enter a number of 0 or more.", vi: "Nhập một số từ 0 trở lên." },

  // Fill
  "office.pptx.format.fill_label": { en: "Fill", vi: "Màu nền" },
  "office.pptx.format.fill.solid": { en: "Solid fill", vi: "Màu đơn" },
  "office.pptx.format.fill.gradient": { en: "Gradient fill", vi: "Chuyển sắc" },
  "office.pptx.format.fill.none": { en: "No fill", vi: "Không có màu nền" },
  "office.pptx.format.fill_color": { en: "Fill color", vi: "Màu nền" },
  "office.pptx.format.gradient_from": { en: "Gradient start color", vi: "Màu bắt đầu" },
  "office.pptx.format.gradient_to": { en: "Gradient end color", vi: "Màu kết thúc" },
  "office.pptx.format.gradient_angle": { en: "Gradient angle in degrees", vi: "Góc chuyển sắc (độ)" },
  "office.pptx.format.gradient_radial": { en: "Radial gradient", vi: "Chuyển sắc toả tròn" },

  // Line
  "office.pptx.format.line_label": { en: "Line", vi: "Đường viền" },
  "office.pptx.format.line.none": { en: "No outline", vi: "Không có đường viền" },
  "office.pptx.format.line.solid": { en: "Outline", vi: "Đường viền" },
  "office.pptx.format.line_color": { en: "Outline color", vi: "Màu đường viền" },
  "office.pptx.format.line_width": { en: "Outline width in points", vi: "Độ dày đường viền (điểm)" },
  "office.pptx.format.line_dash": { en: "Dash style", vi: "Kiểu nét" },
  "office.pptx.format.dash.solid": { en: "Solid", vi: "Liền" },
  "office.pptx.format.dash.dash": { en: "Dash", vi: "Gạch" },
  "office.pptx.format.dash.dot": { en: "Dot", vi: "Chấm" },
  "office.pptx.format.dash.lg_dash": { en: "Long dash", vi: "Gạch dài" },
  "office.pptx.format.dash.lg_dash_dot": { en: "Long dash dot", vi: "Gạch dài chấm" },
  "office.pptx.format.dash.lg_dash_dot_dot": { en: "Long dash dot dot", vi: "Gạch dài hai chấm" },
  "office.pptx.format.dash.sys_dash": { en: "System dash", vi: "Gạch hệ thống" },
  "office.pptx.format.dash.sys_dot": { en: "System dot", vi: "Chấm hệ thống" },

  // Effects
  "office.pptx.format.effects_label": { en: "Effects", vi: "Hiệu ứng" },
  "office.pptx.format.shadow_label": { en: "Shadow", vi: "Đổ bóng" },
  "office.pptx.format.shadow_on": { en: "Drop shadow", vi: "Đổ bóng" },
  "office.pptx.format.shadow_color": { en: "Shadow color", vi: "Màu bóng" },
  "office.pptx.format.shadow_blur": { en: "Shadow blur in points", vi: "Độ mờ bóng (điểm)" },
  "office.pptx.format.shadow_dist": { en: "Shadow distance in points", vi: "Khoảng cách bóng (điểm)" },
  "office.pptx.format.shadow_dir": { en: "Shadow direction in degrees", vi: "Hướng bóng (độ)" },
  "office.pptx.format.shadow_inner": { en: "Inner shadow", vi: "Bóng trong" },
  "office.pptx.format.glow_label": { en: "Glow", vi: "Phát sáng" },
  "office.pptx.format.glow_on": { en: "Glow", vi: "Phát sáng" },
  "office.pptx.format.glow_color": { en: "Glow color", vi: "Màu phát sáng" },
  "office.pptx.format.glow_radius": { en: "Glow radius in points", vi: "Bán kính phát sáng (điểm)" },
  "office.pptx.format.soft_edge_label": { en: "Soft edge in points", vi: "Làm mờ cạnh (điểm)" },

  // Size / geometry
  "office.pptx.format.geometry_label": { en: "Shape", vi: "Hình dạng" },
  "office.pptx.format.geometry_prst": { en: "Change shape", vi: "Đổi hình dạng" },
  "office.pptx.format.geometry_placeholder": { en: "Choose a shape", vi: "Chọn hình dạng" },

  // Arrange
  "office.pptx.format.arrange_label": { en: "Arrange", vi: "Sắp xếp" },
  "office.pptx.format.group": { en: "Group", vi: "Nhóm" },
  "office.pptx.format.ungroup": { en: "Ungroup", vi: "Tách nhóm" },
  "office.pptx.format.flip_h": { en: "Flip horizontally", vi: "Lật ngang" },
  "office.pptx.format.flip_v": { en: "Flip vertically", vi: "Lật dọc" },
  "office.pptx.format.align_label": { en: "Align", vi: "Căn chỉnh" },
  "office.pptx.format.align.left": { en: "Align left", vi: "Căn trái" },
  "office.pptx.format.align.center_h": { en: "Align center", vi: "Căn giữa" },
  "office.pptx.format.align.right": { en: "Align right", vi: "Căn phải" },
  "office.pptx.format.align.top": { en: "Align top", vi: "Căn trên" },
  "office.pptx.format.align.center_v": { en: "Align middle", vi: "Căn giữa dọc" },
  "office.pptx.format.align.bottom": { en: "Align bottom", vi: "Căn dưới" },
  "office.pptx.format.align_to_label": { en: "Align relative to", vi: "Căn theo" },
  "office.pptx.format.align_to_selection": { en: "Selection", vi: "Vùng chọn" },
  "office.pptx.format.align_to_slide": { en: "Slide", vi: "Trang" },
  "office.pptx.format.distribute_h": { en: "Distribute horizontally", vi: "Phân bố ngang" },
  "office.pptx.format.distribute_v": { en: "Distribute vertically", vi: "Phân bố dọc" },
  "office.pptx.format.need_two": {
    en: "Select at least two elements.",
    vi: "Chọn ít nhất hai đối tượng.",
  },
  "office.pptx.format.need_three": {
    en: "Select at least three elements.",
    vi: "Chọn ít nhất ba đối tượng.",
  },
  "office.pptx.format.need_group": {
    en: "Select a single group to ungroup.",
    vi: "Chọn một nhóm để tách.",
  },

  // Text
  "office.pptx.format.text_label": { en: "Text", vi: "Văn bản" },
  "office.pptx.format.anchor_label": { en: "Vertical anchor", vi: "Neo dọc" },
  "office.pptx.format.anchor.top": { en: "Top", vi: "Trên" },
  "office.pptx.format.anchor.middle": { en: "Middle", vi: "Giữa" },
  "office.pptx.format.anchor.bottom": { en: "Bottom", vi: "Dưới" },
  "office.pptx.format.autofit_label": { en: "Autofit", vi: "Tự động vừa" },
  "office.pptx.format.autofit.none": { en: "Do not autofit", vi: "Không tự động vừa" },
  "office.pptx.format.autofit.shrink": { en: "Shrink text on overflow", vi: "Thu nhỏ văn bản khi tràn" },
  "office.pptx.format.autofit.resize": { en: "Resize shape to fit text", vi: "Điều chỉnh hình theo văn bản" },
  "office.pptx.format.wrap": { en: "Wrap text in shape", vi: "Xuống dòng trong hình" },

  "office.pptx.format.apply": { en: "Apply", vi: "Áp dụng" },
};

/** Locales this panel ships copy for. */
export type PptxFormatLocale = "en" | "vi";

/**
 * Nest the flat key map into the shape the shared locale files use, so the
 * UI-wire round can merge it verbatim (`office.pptx.format.*` -> nested
 * objects). Pure: no i18next instance is touched here.
 */
export function formatPanelDictionary(locale: PptxFormatLocale): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(PPTX_FORMAT_I18N)) {
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