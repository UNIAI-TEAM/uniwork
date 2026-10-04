/**
 * Speaker-notes pane strings (task A5 UI, UNI-927).
 *
 * Per-panel i18n bundle. The pane calls every key through
 * `t("office.pptx.notes.<key>")`; the UI-wire round nests these entries under
 * `office.pptx.notes` in packages/core/i18n/locales/{en,vi}.json. This file
 * never edits the shared locales (the lane's shared-file rule).
 */
export interface PptxPanelString {
  en: string;
  vi: string;
}

export type PptxPanelI18n = Record<string, PptxPanelString>;

export const PPTX_NOTES_I18N: PptxPanelI18n = {
  "office.pptx.notes.title": { en: "Speaker notes", vi: "Ghi chú trình bày" },
  "office.pptx.notes.for_slide": { en: "Notes for slide {{index}}", vi: "Ghi chú cho trang {{index}}" },
  "office.pptx.notes.placeholder": { en: "Click to add speaker notes", vi: "Bấm để thêm ghi chú trình bày" },
  "office.pptx.notes.hint": { en: "Ctrl+Enter to save, Esc to revert", vi: "Ctrl+Enter để lưu, Esc để hoàn tác" },
  "office.pptx.notes.no_slide": { en: "Select a slide to edit its notes.", vi: "Chọn một trang để sửa ghi chú." },
  "office.pptx.notes.loading": { en: "Loading speaker notes…", vi: "Đang tải ghi chú trình bày…" },
  "office.pptx.notes.unbound": { en: "Speaker notes are not connected to this editor yet.", vi: "Ghi chú trình bày chưa được kết nối với trình soạn thảo." },
  "office.pptx.notes.readonly": { en: "This presentation is read-only.", vi: "Bản trình bày này chỉ đọc." },
  "office.pptx.notes.dirty": { en: "Unsaved notes", vi: "Ghi chú chưa lưu" },
  "office.pptx.notes.saved": { en: "Notes saved", vi: "Đã lưu ghi chú" },
  "office.pptx.notes.pending": { en: "Saving notes…", vi: "Đang lưu ghi chú…" },
  "office.pptx.notes.commit": { en: "Save notes", vi: "Lưu ghi chú" },
  "office.pptx.notes.revert": { en: "Revert", vi: "Hoàn tác" },
  "office.pptx.notes.error_title": { en: "The notes could not be saved", vi: "Không lưu được ghi chú" },
  "office.pptx.notes.error": { en: "The presentation is unchanged. {{message}}", vi: "Bản trình bày không thay đổi. {{message}}" },
  "office.pptx.notes.close": { en: "Close speaker notes", vi: "Đóng ghi chú trình bày" },
};

/** Flat `{ key: text }` map for one locale, the shape i18next registers. */
export function notesI18nResources(locale: "en" | "vi"): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(PPTX_NOTES_I18N)) out[key] = value[locale];
  return out;
}
