/**
 * Slide master view i18n (B6ui, UNI-927) - the panel's own dictionary.
 *
 * Same pattern as the header/footer panel: the shared locale files belong to
 * the wire round, so every string this panel renders lives here as a flat map
 * of exact `office.pptx.masters.*` keys with `en` and `vi` copy. The wire round
 * merges `mastersPanelDictionary(locale)` into
 * `packages/core/i18n/locales/{en,vi}.json`.
 */

export interface PptxMastersI18nEntry {
  en: string;
  vi: string;
}

export const PPTX_MASTERS_I18N: Readonly<Record<string, PptxMastersI18nEntry>> = {
  "office.pptx.masters.title": { en: "Slide master", vi: "Bản cái trang chiếu" },
  "office.pptx.masters.close": { en: "Close master view", vi: "Đóng chế độ bản cái" },
  "office.pptx.masters.loading": {
    en: "Loading the slide master...",
    vi: "Đang tải bản cái trang chiếu...",
  },
  "office.pptx.masters.unbound": {
    en: "Slide master changes are not connected to this editor yet.",
    vi: "Thay đổi bản cái trang chiếu chưa được kết nối với trình soạn thảo này.",
  },
  "office.pptx.masters.busy": { en: "Applying...", vi: "Đang áp dụng..." },
  "office.pptx.masters.parts_label": { en: "Masters and layouts", vi: "Bản cái và bố cục" },
  "office.pptx.masters.parts_empty": {
    en: "This presentation has no slide master or layouts.",
    vi: "Bản trình bày này không có bản cái hay bố cục nào.",
  },
  "office.pptx.masters.kind_master": { en: "Master", vi: "Bản cái" },
  "office.pptx.masters.kind_layout": { en: "Layout", vi: "Bố cục" },
  "office.pptx.masters.elements_label": { en: "Elements", vi: "Phần tử" },
  "office.pptx.masters.no_part": {
    en: "Select a master or layout to edit it.",
    vi: "Chọn một bản cái hoặc bố cục để chỉnh sửa.",
  },
  "office.pptx.masters.elements_empty": {
    en: "This part has no elements.",
    vi: "Phần này không có phần tử nào.",
  },
  "office.pptx.masters.no_element": {
    en: "Select an element to edit it.",
    vi: "Chọn một phần tử để chỉnh sửa.",
  },
  "office.pptx.masters.inspector_label": { en: "Element properties", vi: "Thuộc tính phần tử" },
  "office.pptx.masters.text_label": { en: "Text", vi: "Nội dung" },
  "office.pptx.masters.text_placeholder": {
    en: "Text shown on the master",
    vi: "Nội dung hiển thị trên bản cái",
  },
  "office.pptx.masters.text_apply": { en: "Apply text", vi: "Áp dụng nội dung" },
  "office.pptx.masters.position_label": { en: "Position and size (px)", vi: "Vị trí và kích thước (px)" },
  "office.pptx.masters.x": { en: "X", vi: "X" },
  "office.pptx.masters.y": { en: "Y", vi: "Y" },
  "office.pptx.masters.w": { en: "Width", vi: "Rộng" },
  "office.pptx.masters.h": { en: "Height", vi: "Cao" },
  "office.pptx.masters.box_invalid": {
    en: "Enter valid numbers; width and height must be at least 1.",
    vi: "Nhập số hợp lệ; chiều rộng và chiều cao phải từ 1 trở lên.",
  },
  "office.pptx.masters.box_apply": { en: "Apply position", vi: "Áp dụng vị trí" },
  "office.pptx.masters.fill_label": { en: "Fill colour", vi: "Màu tô" },
  "office.pptx.masters.fill_apply": { en: "Apply fill", vi: "Áp dụng màu tô" },
  "office.pptx.masters.fill_clear": { en: "No fill", vi: "Không tô" },
  "office.pptx.masters.stroke_label": { en: "Outline colour", vi: "Màu viền" },
  "office.pptx.masters.stroke_width": { en: "Outline width (pt)", vi: "Độ dày viền (pt)" },
  "office.pptx.masters.stroke_width_invalid": {
    en: "Outline width must be a number from 0 to {{max}}.",
    vi: "Độ dày viền phải là số từ 0 đến {{max}}.",
  },
  "office.pptx.masters.stroke_apply": { en: "Apply outline", vi: "Áp dụng viền" },
  "office.pptx.masters.stroke_clear": { en: "No outline", vi: "Không viền" },
  "office.pptx.masters.color_hex": { en: "Hex colour", vi: "Mã màu hex" },
  "office.pptx.masters.color_invalid": {
    en: "Enter a colour like #4472C4.",
    vi: "Nhập màu dạng #4472C4.",
  },
  "office.pptx.masters.delete": { en: "Delete element", vi: "Xoá phần tử" },
  // T01: rename, add placeholder, placeholder text style.
  "office.pptx.masters.rename_layout": { en: "Layout name", vi: "Tên bố cục" },
  "office.pptx.masters.rename_master": { en: "Master name", vi: "Tên bản cái" },
  "office.pptx.masters.rename_apply": { en: "Rename", vi: "Đổi tên" },
  "office.pptx.masters.add_placeholder_label": { en: "Add placeholder", vi: "Thêm chỗ dành sẵn" },
  "office.pptx.masters.add_placeholder": { en: "Add", vi: "Thêm" },
  "office.pptx.masters.placeholder_title": { en: "Title", vi: "Tiêu đề" },
  "office.pptx.masters.placeholder_body": { en: "Content", vi: "Nội dung" },
  "office.pptx.masters.placeholder_pic": { en: "Picture", vi: "Hình ảnh" },
  "office.pptx.masters.placeholder_chart": { en: "Chart", vi: "Biểu đồ" },
  "office.pptx.masters.placeholder_tbl": { en: "Table", vi: "Bảng" },
  "office.pptx.masters.placeholder_dt": { en: "Date", vi: "Ngày" },
  "office.pptx.masters.placeholder_ftr": { en: "Footer", vi: "Chân trang" },
  "office.pptx.masters.placeholder_sldnum": { en: "Slide number", vi: "Số trang chiếu" },
  "office.pptx.masters.text_style_label": { en: "Placeholder text style", vi: "Kiểu chữ của chỗ dành sẵn" },
  "office.pptx.masters.font_size": { en: "Size (pt)", vi: "Cỡ chữ (pt)" },
  "office.pptx.masters.font_color": { en: "Text colour", vi: "Màu chữ" },
  "office.pptx.masters.font_name": { en: "Font", vi: "Phông chữ" },
  "office.pptx.masters.bold": { en: "Bold", vi: "Đậm" },
  "office.pptx.masters.italic": { en: "Italic", vi: "Nghiêng" },
  "office.pptx.masters.text_style_invalid": { en: "Enter a size from 1 to 400 and a colour like #1F4E79.", vi: "Nhập cỡ chữ từ 1 đến 400 và màu dạng #1F4E79." },
  "office.pptx.masters.text_style_apply": { en: "Apply text style", vi: "Áp dụng kiểu chữ" },
  // UNI-939 visual fix: localized element names, style confirmation, canvas preview tag.
  "office.pptx.masters.placeholder_ctrtitle": { en: "Centered title", vi: "Tiêu đề giữa" },
  "office.pptx.masters.placeholder_subtitle": { en: "Subtitle", vi: "Tiêu đề phụ" },
  "office.pptx.masters.placeholder_obj": { en: "Object", vi: "Đối tượng" },
  "office.pptx.masters.placeholder_clipart": { en: "Clip art", vi: "Hình minh hoạ" },
  "office.pptx.masters.placeholder_dgm": { en: "Diagram", vi: "Sơ đồ" },
  "office.pptx.masters.placeholder_media": { en: "Media", vi: "Phương tiện" },
  "office.pptx.masters.placeholder_sldimg": { en: "Slide image", vi: "Hình trang chiếu" },
  "office.pptx.masters.placeholder_hdr": { en: "Header", vi: "Đầu trang" },
  "office.pptx.masters.placeholder_other": { en: "Placeholder", vi: "Chỗ dành sẵn" },
  "office.pptx.masters.type_text": { en: "Text box", vi: "Hộp văn bản" },
  "office.pptx.masters.type_shape": { en: "Shape", vi: "Hình" },
  "office.pptx.masters.type_picture": { en: "Picture", vi: "Hình ảnh" },
  "office.pptx.masters.type_group": { en: "Group", vi: "Nhóm" },
  "office.pptx.masters.type_table": { en: "Table", vi: "Bảng" },
  "office.pptx.masters.type_chart": { en: "Chart", vi: "Biểu đồ" },
  "office.pptx.masters.type_passthrough": { en: "Embedded object", vi: "Đối tượng nhúng" },
  "office.pptx.masters.type_other": { en: "Element", vi: "Phần tử" },
  "office.pptx.masters.text_style_applied": { en: "Text style applied.", vi: "Đã áp dụng kiểu chữ." },
  "office.pptx.masters.preview_label": { en: "{{kind}}: {{name}} (preview)", vi: "{{kind}}: {{name}} (xem trước)" },
};

export type PptxMastersLocale = "en" | "vi";

/** Nest the flat key map into the shape the shared locale files use. Pure. */
export function mastersPanelDictionary(locale: PptxMastersLocale): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(PPTX_MASTERS_I18N)) {
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
