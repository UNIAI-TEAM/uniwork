/**
 * Comments panel strings (task A5 UI, UNI-927).
 *
 * Per-panel i18n bundle. The panel calls every key through
 * `t("office.pptx.comments.<key>")`; the UI-wire round nests these entries
 * under `office.pptx.comments` in packages/core/i18n/locales/{en,vi}.json.
 * This file never edits the shared locales (the lane's shared-file rule).
 */
import type { PptxPanelI18n } from "../notes/notes-i18n";

export const PPTX_COMMENTS_I18N: PptxPanelI18n = {
  "office.pptx.comments.title": { en: "Comments", vi: "Bình luận" },
  "office.pptx.comments.for_slide": { en: "Comments on slide {{index}}", vi: "Bình luận ở trang chiếu {{index}}" },
  "office.pptx.comments.count_one": { en: "{{count}} comment", vi: "{{count}} bình luận" },
  "office.pptx.comments.count_other": { en: "{{count}} comments", vi: "{{count}} bình luận" },
  "office.pptx.comments.empty": { en: "No comments on this slide.", vi: "Trang chiếu này chưa có bình luận." },
  "office.pptx.comments.loading": { en: "Loading comments…", vi: "Đang tải bình luận…" },
  "office.pptx.comments.unbound": { en: "Comments are not connected to this editor yet.", vi: "Bình luận chưa được kết nối với trình soạn thảo." },
  "office.pptx.comments.readonly": { en: "This presentation is read-only.", vi: "Bản trình bày này chỉ đọc." },
  "office.pptx.comments.no_slide": { en: "Select a slide to see its comments.", vi: "Chọn một trang chiếu để xem bình luận." },
  "office.pptx.comments.author_label": { en: "Author", vi: "Tác giả" },
  "office.pptx.comments.author_placeholder": { en: "Your name", vi: "Tên của bạn" },
  "office.pptx.comments.text_placeholder": { en: "Write a comment", vi: "Viết bình luận" },
  "office.pptx.comments.post": { en: "Post comment", vi: "Gửi bình luận" },
  "office.pptx.comments.delete_for": { en: "Delete comment by {{author}}", vi: "Xóa bình luận của {{author}}" },
  "office.pptx.comments.delete_unknown": { en: "Delete comment", vi: "Xóa bình luận" },
  "office.pptx.comments.reply": { en: "Reply", vi: "Trả lời" },
  "office.pptx.comments.resolve": { en: "Resolve", vi: "Đánh dấu đã xử lý" },
  "office.pptx.comments.unsupported": { en: "Replying and resolving are not supported by this presentation engine yet.", vi: "Trả lời và đánh dấu đã xử lý chưa được engine trình bày hỗ trợ." },
  "office.pptx.comments.error_title": { en: "The comment could not be applied", vi: "Không thực hiện được bình luận" },
  "office.pptx.comments.error": { en: "The presentation is unchanged. {{message}}", vi: "Bản trình bày không thay đổi. {{message}}" },
  "office.pptx.comments.close": { en: "Close comments", vi: "Đóng bình luận" },
  "office.pptx.comments.pending": { en: "Applying comment…", vi: "Đang thực hiện bình luận…" },
};

/** Flat `{ key: text }` map for one locale, the shape i18next registers. */
export function commentsI18nResources(locale: "en" | "vi"): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(PPTX_COMMENTS_I18N)) out[key] = value[locale];
  return out;
}
