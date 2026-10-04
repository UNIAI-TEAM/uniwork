/**
 * In-place text-editing + text-formatting strings (UNI-927: task A1ui, extended
 * by task WIRE-TEXT).
 *
 * The A1ui overlay calls its keys through `t("office.pptx.text.<key>")`; the
 * WIRE-TEXT format panel calls its keys through a `office.pptx.text` keyPrefix
 * and the `format.` sub-prefix, so both surfaces live under the same
 * `office.pptx.text.*` subtree. The serialized wire round nests these entries
 * under `office.pptx.text` in packages/core/i18n/locales/{en,vi}.json.
 *
 * Key parity (en + vi, same `{{vars}}`) is proven by `text-i18n.test.ts`.
 * The A1ui keys are unchanged; `format.*` is additive.
 */
export interface PptxTextI18nEntry {
  en: string;
  vi: string;
}

export const PPTX_TEXT_I18N: Readonly<Record<string, PptxTextI18nEntry>> = {
  // A1ui - the in-place text editor overlay.
  "office.pptx.text.target_label": { en: "Double-click to edit this text", vi: "Nháy đúp để sửa văn bản này" },
  "office.pptx.text.editor_label": { en: "Edit slide text", vi: "Sửa văn bản trang chiếu" },
  "office.pptx.text.hint": { en: "Ctrl+Enter to save, Esc to cancel", vi: "Ctrl+Enter để lưu, Esc để huỷ" },
  "office.pptx.text.empty_refused": {
    en: "Text cannot be empty. Type something or press Esc to cancel.",
    vi: "Văn bản không được để trống. Hãy nhập nội dung hoặc nhấn Esc để huỷ.",
  },

  // WIRE-TEXT - the text-format panel chrome.
  "office.pptx.text.format.title": { en: "Text", vi: "Văn bản" },
  "office.pptx.text.format.loading": { en: "Loading the text tools...", vi: "Đang tải công cụ văn bản..." },
  "office.pptx.text.format.busy": { en: "Applying...", vi: "Đang áp dụng..." },
  "office.pptx.text.format.empty": {
    en: "Select a text box or shape to format its text",
    vi: "Chọn một hộp văn bản hoặc hình để định dạng văn bản",
  },
  "office.pptx.text.format.unbound": {
    en: "Text formatting is not connected to this editor yet.",
    vi: "Định dạng văn bản chưa được nối vào trình soạn thảo này.",
  },
  "office.pptx.text.format.readonly": { en: "This presentation is read-only.", vi: "Bản trình bày này chỉ để đọc." },
  "office.pptx.text.format.unsupported": {
    en: "This element cannot hold formatted text.",
    vi: "Đối tượng này không chứa văn bản định dạng được.",
  },
  "office.pptx.text.format.error_title": {
    en: "The text change could not be applied",
    vi: "Không thể áp dụng thay đổi văn bản",
  },
  "office.pptx.text.format.error_hint": {
    en: "The document was not changed. {{message}}",
    vi: "Tài liệu chưa bị thay đổi. {{message}}",
  },
  "office.pptx.text.format.char_label": { en: "Text style", vi: "Kiểu chữ" },
  "office.pptx.text.format.toggle.bold": { en: "Bold", vi: "Đậm" },
  "office.pptx.text.format.toggle.italic": { en: "Italic", vi: "Nghiêng" },
  "office.pptx.text.format.toggle.underline": { en: "Underline", vi: "Gạch chân" },
  "office.pptx.text.format.toggle.strike": { en: "Strikethrough", vi: "Gạch ngang" },
  "office.pptx.text.format.font_family": { en: "Font", vi: "Phông chữ" },
  "office.pptx.text.format.font_family_custom": { en: "Font family name", vi: "Tên phông chữ" },
  "office.pptx.text.format.font_size": { en: "Font size", vi: "Cỡ chữ" },
  "office.pptx.text.format.font_size_custom": { en: "Font size in points", vi: "Cỡ chữ theo điểm" },
  "office.pptx.text.format.text_color": { en: "Text color", vi: "Màu chữ" },
  "office.pptx.text.format.highlight": { en: "Highlight", vi: "Tô sáng" },
  "office.pptx.text.format.highlight_unavailable": {
    en: "Highlight is not available yet",
    vi: "Tô sáng chưa khả dụng",
  },
  "office.pptx.text.format.align_label": { en: "Alignment", vi: "Căn chỉnh" },
  "office.pptx.text.format.align.left": { en: "Align left", vi: "Căn trái" },
  "office.pptx.text.format.align.center": { en: "Align center", vi: "Căn giữa" },
  "office.pptx.text.format.align.right": { en: "Align right", vi: "Căn phải" },
  "office.pptx.text.format.align.justify": { en: "Justify", vi: "Căn đều hai bên" },
  "office.pptx.text.format.bullet_label": { en: "Bullets and numbering", vi: "Dấu đầu dòng và đánh số" },
  "office.pptx.text.format.bullet.none": { en: "None", vi: "Không" },
  "office.pptx.text.format.bullet.char": { en: "Bullets", vi: "Dấu đầu dòng" },
  "office.pptx.text.format.bullet.number": { en: "Numbering", vi: "Đánh số" },
  "office.pptx.text.format.line_spacing": { en: "Line spacing", vi: "Giãn dòng" },
  "office.pptx.text.format.line_spacing_custom": { en: "Line spacing percent", vi: "Giãn dòng theo phần trăm" },
  "office.pptx.text.format.apply": { en: "Apply", vi: "Áp dụng" },
};

/** Locales this module ships copy for. */
export type PptxTextLocale = "en" | "vi";

/**
 * Nest the flat key map into the shape the shared locale files use, so the
 * UI-wire round can merge it verbatim. Pure: no i18next instance is touched.
 * Both the A1ui keys and the WIRE-TEXT `format.*` keys land under
 * `office.pptx.text`.
 */
export function pptxTextDictionary(locale: PptxTextLocale): Record<string, unknown> {
  const text: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(PPTX_TEXT_I18N)) {
    const parts = key.replace("office.pptx.text.", "").split(".");
    let node = text;
    for (const part of parts.slice(0, -1)) {
      const existing = node[part];
      const next = existing && typeof existing === "object" ? (existing as Record<string, unknown>) : {};
      node[part] = next;
      node = next;
    }
    node[parts[parts.length - 1] as string] = entry[locale];
  }
  return { office: { pptx: { text } } };
}
