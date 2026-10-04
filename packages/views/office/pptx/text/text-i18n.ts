/**
 * In-place text-editing strings (task A1ui, UNI-927).
 *
 * The overlay calls every key through `t("office.pptx.text.<key>")`; the serialized wire round
 * nests these entries under `office.pptx.text` in packages/core/i18n/locales/{en,vi}.json.
 * Key parity (en + vi, same `{{vars}}`) is proven by `text-i18n.test.ts`.
 */
export interface PptxTextI18nEntry {
  en: string;
  vi: string;
}

export const PPTX_TEXT_I18N: Readonly<Record<string, PptxTextI18nEntry>> = {
  "office.pptx.text.target_label": { en: "Double-click to edit this text", vi: "Nháy đúp để sửa văn bản này" },
  "office.pptx.text.editor_label": { en: "Edit slide text", vi: "Sửa văn bản trang chiếu" },
  "office.pptx.text.hint": { en: "Ctrl+Enter to save, Esc to cancel", vi: "Ctrl+Enter để lưu, Esc để huỷ" },
  "office.pptx.text.empty_refused": {
    en: "Text cannot be empty. Type something or press Esc to cancel.",
    vi: "Văn bản không được để trống. Hãy nhập nội dung hoặc nhấn Esc để huỷ.",
  },
};

/** Nested `{ office: { pptx: { text: {...} } } }` shape the shared locale files use. */
export function pptxTextDictionary(locale: "en" | "vi"): Record<string, unknown> {
  const text: Record<string, string> = {};
  for (const [key, value] of Object.entries(PPTX_TEXT_I18N)) text[key.replace("office.pptx.text.", "")] = value[locale];
  return { office: { pptx: { text } } };
}