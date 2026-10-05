/**
 * A2 UI half (UNI-927) - the slide sorter's own message table.
 *
 * The shared locale files (`packages/core/i18n/locales/{en,vi}.json`) are owned by
 * the CHROME worker during this wave, so this panel keeps its `office.pptx.sorter.*`
 * and `office.pptx.sections.*` keys here. The serialized UI-wire round copies the
 * entries below into `office.pptx` in both locale files verbatim; nothing else in
 * this folder depends on their location, so the merge is a pure data move.
 *
 * Keys are FULL i18next keys (including the `office.pptx.` prefix) because the panel
 * calls `t("office.pptx.sorter.<key>")` with no key prefix - the exact call shape the
 * UI-wire contract requires. `pptxSorterI18nResources()` reshapes the flat table into
 * the nested object i18next wants, so tests can register it through
 * `registerLocaleBundle` without touching the shared files.
 */

/** One message: the English copy and its Vietnamese parity string. */
export interface PptxSorterMessage {
  en: string;
  vi: string;
}

/** The panel's flat message table: full key -> { en, vi }. */
export const PPTX_SORTER_MESSAGES: Readonly<Record<string, PptxSorterMessage>> = {
  "office.pptx.sorter.title": { en: "Slide sorter", vi: "Sắp xếp trang chiếu" },
  "office.pptx.sorter.label": { en: "Slide sorter panel", vi: "Bảng sắp xếp trang chiếu" },
  "office.pptx.sorter.grid_label": { en: "Slides", vi: "Trang chiếu" },
  "office.pptx.sorter.actions_label": { en: "Slide actions", vi: "Thao tác trang chiếu" },
  "office.pptx.sorter.slide_label": { en: "Slide {{index}}{{label}}", vi: "Trang chiếu {{index}}{{label}}" },
  "office.pptx.sorter.slide_hidden": { en: "Hidden", vi: "Đang ẩn" },
  "office.pptx.sorter.loading": { en: "Loading slides…", vi: "Đang tải trang chiếu…" },
  "office.pptx.sorter.error_title": { en: "The slide sorter could not load", vi: "Không tải được bảng sắp xếp trang chiếu" },
  "office.pptx.sorter.error_hint": { en: "The presentation is unchanged. {{message}}", vi: "Bản trình bày không thay đổi. {{message}}" },
  "office.pptx.sorter.unbound": { en: "No presentation is open.", vi: "Chưa mở bản trình bày nào." },
  "office.pptx.sorter.empty": { en: "This presentation has no slides.", vi: "Bản trình bày này chưa có trang chiếu." },
  "office.pptx.sorter.readonly": { en: "This presentation is read-only.", vi: "Bản trình bày này chỉ đọc." },
  "office.pptx.sorter.pending": { en: "Applying the slide change…", vi: "Đang áp dụng thay đổi trang chiếu…" },
  "office.pptx.sorter.no_selection": { en: "Select a slide to act on it.", vi: "Chọn một trang chiếu để thao tác." },
  "office.pptx.sorter.selected": { en: "Selected: slide {{index}}", vi: "Đang chọn: trang chiếu {{index}}" },
  "office.pptx.sorter.new": { en: "New slide", vi: "Trang chiếu mới" },
  "office.pptx.sorter.new_label": { en: "New slide from a layout", vi: "Trang chiếu mới theo bố cục" },
  "office.pptx.sorter.new_blank": { en: "Blank slide", vi: "Trang chiếu trống" },
  "office.pptx.sorter.layout.title_slide": { en: "Title Slide", vi: "Trang tiêu đề" },
  "office.pptx.sorter.layout.title_content": { en: "Title and Content", vi: "Tiêu đề và nội dung" },
  "office.pptx.sorter.layout.section_header": { en: "Section Header", vi: "Tiêu đề phần" },
  "office.pptx.sorter.layout.two_content": { en: "Two Content", vi: "Hai nội dung" },
  "office.pptx.sorter.layout.comparison": { en: "Comparison", vi: "So sánh" },
  "office.pptx.sorter.layout.title_only": { en: "Title Only", vi: "Chỉ có tiêu đề" },
  "office.pptx.sorter.layout.blank": { en: "Blank", vi: "Bố cục trống" },
  "office.pptx.sorter.layout.content_caption": { en: "Content with Caption", vi: "Nội dung kèm chú thích" },
  "office.pptx.sorter.layout.picture_caption": { en: "Picture with Caption", vi: "Hình ảnh kèm chú thích" },
  "office.pptx.sorter.layout.title_vertical_text": { en: "Title and Vertical Text", vi: "Tiêu đề và văn bản dọc" },
  "office.pptx.sorter.layout.vertical_title_text": { en: "Vertical Title and Text", vi: "Tiêu đề dọc và văn bản" },
  "office.pptx.sorter.layouts_unavailable": { en: "Layouts are not available for this presentation.", vi: "Bản trình bày này không có bố cục khả dụng." },
  "office.pptx.sorter.layouts_empty": { en: "This presentation has no layouts.", vi: "Bản trình bày này không có bố cục nào." },
  "office.pptx.sorter.duplicate": { en: "Duplicate slide", vi: "Nhân bản trang chiếu" },
  "office.pptx.sorter.delete": { en: "Delete slide", vi: "Xoá trang chiếu" },
  "office.pptx.sorter.hide": { en: "Hide slide", vi: "Ẩn trang chiếu" },
  "office.pptx.sorter.show": { en: "Show slide", vi: "Hiện trang chiếu" },
  "office.pptx.sorter.move_hint": { en: "Drag a slide to reorder it, or use the arrow keys on the drag handle.", vi: "Kéo một trang chiếu để đổi thứ tự, hoặc dùng phím mũi tên trên tay nắm kéo." },
  "office.pptx.sorter.drag_handle": { en: "Reorder slide {{index}}", vi: "Đổi thứ tự trang chiếu {{index}}" },
  "office.pptx.sorter.disabled_unbound": { en: "Open a presentation before using the slide sorter.", vi: "Mở bản trình bày trước khi dùng bảng sắp xếp." },
  "office.pptx.sorter.disabled_readonly": { en: "This presentation is read-only, so slides cannot change.", vi: "Bản trình bày chỉ đọc nên không thể thay đổi trang chiếu." },
  "office.pptx.sorter.disabled_pending": { en: "A slide change is still being applied.", vi: "Một thay đổi trang chiếu đang được áp dụng." },
  "office.pptx.sorter.disabled_empty": { en: "There is no slide to act on.", vi: "Không có trang chiếu để thao tác." },
  "office.pptx.sorter.disabled_last_slide": { en: "The last slide cannot be deleted.", vi: "Không thể xoá trang chiếu cuối cùng." },
  "office.pptx.sections.title": { en: "Sections", vi: "Phần" },
  "office.pptx.sections.label": { en: "Presentation sections", vi: "Các phần của bản trình bày" },
  "office.pptx.sections.none": { en: "No sections yet — the whole presentation is one group.", vi: "Chưa có phần nào — toàn bộ bản trình bày là một nhóm." },
  "office.pptx.sections.unsectioned": { en: "Unsectioned slides", vi: "Trang chiếu chưa vào phần" },
  "office.pptx.sections.range": { en: "Slides {{start}}–{{end}}", vi: "Trang chiếu {{start}}–{{end}}" },
  "office.pptx.sections.count_one": { en: "{{count}} section", vi: "{{count}} phần" },
  "office.pptx.sections.count_other": { en: "{{count}} sections", vi: "{{count}} phần" },
  "office.pptx.sections.add": { en: "Add section", vi: "Thêm phần" },
  "office.pptx.sections.add_at": { en: "Add a section starting at slide {{index}}", vi: "Thêm phần bắt đầu từ trang chiếu {{index}}" },
  "office.pptx.sections.default_name": { en: "Section {{index}}", vi: "Phần {{index}}" },
  "office.pptx.sections.rename": { en: "Rename section {{name}}", vi: "Đổi tên phần {{name}}" },
  "office.pptx.sections.rename_label": { en: "Section name", vi: "Tên phần" },
  "office.pptx.sections.rename_save": { en: "Save section name", vi: "Lưu tên phần" },
  "office.pptx.sections.rename_cancel": { en: "Cancel rename", vi: "Huỷ đổi tên" },
  "office.pptx.sections.rename_empty": { en: "A section name cannot be empty.", vi: "Tên phần không được để trống." },
  "office.pptx.sections.remove": { en: "Remove section {{name}}", vi: "Xoá phần {{name}}" },
  "office.pptx.sections.move_up": { en: "Move section {{name}} up", vi: "Chuyển phần {{name}} lên" },
  "office.pptx.sections.move_down": { en: "Move section {{name}} down", vi: "Chuyển phần {{name}} xuống" },
  "office.pptx.sections.select_group": { en: "Select slide {{index}} in section {{name}}", vi: "Chọn trang chiếu {{index}} trong phần {{name}}" },
};

/** The flat table reshaped into i18next resources (`{ en: {...}, vi: {...} }`). */
export function pptxSorterI18nResources(
  messages: Readonly<Record<string, PptxSorterMessage>> = PPTX_SORTER_MESSAGES,
): { en: Record<string, unknown>; vi: Record<string, unknown> } {
  const en: Record<string, unknown> = {};
  const vi: Record<string, unknown> = {};
  for (const [key, message] of Object.entries(messages)) {
    setNested(en, key, message.en);
    setNested(vi, key, message.vi);
  }
  return { en, vi };
}

function setNested(target: Record<string, unknown>, key: string, value: string): void {
  const segments = key.split(".");
  let cursor = target;
  for (let i = 0; i < segments.length - 1; i += 1) {
    const segment = segments[i] as string;
    const next = cursor[segment];
    if (typeof next !== "object" || next === null) cursor[segment] = {};
    cursor = cursor[segment] as Record<string, unknown>;
  }
  cursor[segments[segments.length - 1] as string] = value;
}