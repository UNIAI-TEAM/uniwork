# Trang ghi chú (Documents `page`) — thiết kế giao diện

> **Trạng thái:** in-progress (UNI-916)

Người dùng 2026-10-02: trang `kind = page` (JSON TipTap trong `documents.content`, không phải file) đang trông như
một ô textarea — khung viền xanh quanh cả vùng soạn, không có tiêu đề trong trang, không có menu chèn khối. "Nếu là
ghi chú dạng note thì vẫn nên làm đẹp hơn." Spec này chỉ đổi lớp trình bày; schema trang, API, lưu/nháp/xung đột,
realtime và quyền giữ nguyên.

Nguồn thiết kế (chỉ đọc): `unidigiwork/.agents/skills/unicom-ui-design/SKILL.md` (tinh thần Notion cho document
layout: tối giản, thoáng, hierarchy rõ) và trình soạn genoffice markdown (`genoffice/apps/markdown/src/renderer`).
Map vào primitives `packages/ui` và token ngữ nghĩa; CLAUDE.md thắng khi mâu thuẫn.

## 1. Bố cục

```
┌ BreadcrumbHeader ─────────────────────────────────────────────────────────────┐
│ ←  Tài liệu › Ghi chú họp tuần          Đã lưu · 10:42   ☆   💬 Bình luận   ⋯ │
└───────────────────────────────────────────────────────────────────────────────┘

                 ┌─ cột nội dung max-w-3xl (≈720px), gutter PAGE_GUTTER ─┐
   pt-16         │                                                        │
                 │  [😀 Thêm biểu tượng]   ← chỉ hiện khi hover/focus,     │
                 │                           ẩn nếu đã có icon            │
                 │  📝                      ← icon (emoji), bấm để đổi/xoá │
                 │                                                        │
                 │  Ghi chú họp tuần        ← tiêu đề H1 sửa tại chỗ      │
                 │  text-display font-semibold tracking-tight             │
                 │                                                        │
                 │  Cập nhật 10:42 bởi Minh · 2 bình luận  ← meta, caption │
                 │  ───────────────────────────── (không kẻ, chỉ mb-8)     │
                 │                                                        │
                 │  Nội dung prose, leading-relaxed                       │
                 │  ## Heading 2                                          │
                 │  • danh sách   ☐ việc cần làm   > trích dẫn            │
                 │                                                        │
                 │  Nhập "/" để chèn khối…   ← placeholder ở dòng trống   │
                 │                             đang có con trỏ            │
                 └────────────────────────────────────────────────────────┘
```

- Không còn khung viền/ring quanh vùng soạn. Vùng soạn là một mặt phẳng liền với trang (`bg-background`).
- Cột nội dung giữ `max-w-3xl`, căn giữa; padding trên `pt-12 md:pt-16`, dưới `pb-32` để có chỗ gõ cuối trang
  (click vào khoảng trống dưới cùng đặt con trỏ cuối tài liệu).
- Mobile (< 640px): gutter 16px, tiêu đề `text-display-sm`, không cuộn ngang; bảng cuộn ngang trong khung riêng.

## 2. Tiêu đề và biểu tượng

- Tiêu đề là `textarea` tự giãn một dòng logic (không xuống dòng), placeholder `Không có tiêu đề`. Lưu qua
  `useUpdateDocument` (PATCH title) với debounce 600ms và khi blur; breadcrumb cập nhật theo. Rỗng lưu thành
  `documents.detail.untitled` hiển thị, không gửi chuỗi rỗng nếu server từ chối.
- `Enter` ở tiêu đề → focus vào đầu nội dung; `↑`/`Backspace` ở đầu dòng nội dung đầu tiên (rỗng) → về tiêu đề.
- Trang mới tạo (`Trang mới`): focus tiêu đề và chọn toàn bộ chữ để gõ đè.
- Biểu tượng: nút ghost `Thêm biểu tượng` (icon `SmilePlus`) hiện khi hover/focus vùng tiêu đề. Bấm mở Popover lưới
  emoji nhỏ (bộ cố định ~48 emoji thường dùng, không thêm dependency picker) + `Xoá biểu tượng`. Lưu PATCH `icon`.
- Chỉ đọc (`editable = false`): tiêu đề là `h1` thường, không có nút biểu tượng.

## 3. Nội dung (prose)

- Typography theo token: đoạn `text-body leading-relaxed`, H1/H2/H3 trong nội dung = `text-title-lg`/`text-title`/
  `text-title-sm` font-semibold, khoảng cách khối nhất quán (`mt-6` cho heading, `my-2` cho đoạn).
- Danh sách, task list (checkbox primitive), blockquote (viền trái `border-border`, chữ `text-muted-foreground`),
  code block (`bg-muted`, font mono), hr, bảng (viền `border-border`, header `bg-muted`), ảnh bo góc `rounded-md`.
- Placeholder: chỉ hiện ở **dòng trống đang có con trỏ** (`Nhập "/" để chèn khối…`); tài liệu rỗng hoàn toàn hiện
  `Bắt đầu viết, hoặc nhập "/" để chèn khối…`.
- Focus: caret là chỉ báo; không ring quanh cả vùng. Tiêu đề và mọi nút vẫn dùng `:focus-visible` toàn cục.

## 4. Menu chèn khối `/`

- Gõ `/` ở đầu dòng hoặc sau khoảng trắng mở popup (tái dùng `suggestion-popup.tsx` của editor dùng chung, không viết
  popup thứ hai). Lọc theo chữ gõ sau `/` (vi + en, bỏ dấu). `↑↓` chọn, `Enter` chèn, `Esc` đóng và giữ ký tự `/`.
- Mục (đúng `DOCUMENT_NODE_TYPES`, không thêm node ngoài schema): Văn bản, Tiêu đề 1/2/3, Danh sách, Danh sách số,
  Việc cần làm, Trích dẫn, Khối code, Đường kẻ, Bảng (3×3), Ảnh (mở chọn file → luồng upload asset hiện có),
  Nhắc tới (`@`). Mỗi mục: icon lucide + nhãn + mô tả ngắn `text-caption`.
- Đây là extension mới cho trang (`createPageDocumentExtensions`), KHÔNG dùng `SlashCommandExtension` của chat (nó
  chèn node skill/command, không thuộc schema trang).

## 5. Định dạng

- Bubble menu hiện có (`EditorBubbleMenu`) giữ nguyên cho bold/italic/underline/strike/code/link.
- Phím tắt markdown chuẩn TipTap (`# `, `- `, `1. `, `[] `, `> `, ``` ``` ```) bật cho trang.
- Không thêm toolbar cố định (đúng tinh thần ghi chú tối giản).

## 6. Trạng thái

- Đang mở: skeleton tiêu đề (h-10 w-2/3) + 3 dòng, không nhảy layout khi editor mount.
- Lỗi/không quyền/không tìm thấy: giữ `Notice`/`CollectionPageState` hiện có, đặt trong cùng cột.
- Lưu: `DocumentSaveIndicator` trên header như hiện tại.

## 7. i18n, theme, a11y

- Mọi chuỗi qua `t()` (vi + en), theo `docs/conventions.md` (giọng tiếng Việt).
- Chỉ token ngữ nghĩa, kiểm cả light/dark (contrast AA cho placeholder và meta).
- Tiêu đề có `aria-label`; popup `/` là `listbox` với `aria-activedescendant`; nút biểu tượng có tooltip + aria-label;
  touch target ≥ 44px trên coarse pointer.

## 8. Ngoài phạm vi

Ảnh bìa (cover), xuất DOCX/PDF/Markdown, kéo thả khối (drag handle), cộng tác con trỏ, đổi schema trang.

## 9. Nghiệm thu

- Test views: tiêu đề PATCH + Enter/Backspace chuyển focus; menu `/` lọc và chèn đúng từng node, Esc giữ `/`;
  placeholder chỉ ở dòng hiện tại; chỉ đọc không có input tiêu đề/nút biểu tượng; sanitize vẫn chặn node lạ.
- Không hồi quy: suite `packages/views/documents` + `packages/views/editor`, lint (no-literal-string), typecheck,
  coverage floors, 500 dòng/file.
- Tester visual: ảnh chụp light + dark, desktop 1440 và mobile 390, trang rỗng / trang có đủ loại khối / chỉ đọc;
  đối chiếu unicom-ui-design. Người dùng duyệt giao diện cuối.
