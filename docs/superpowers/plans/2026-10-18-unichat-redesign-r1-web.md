# UniChat R1 — Giao diện chat mới cho web và desktop — Kế hoạch triển khai

> **Trạng thái:** in-progress — UNI-1881, nhánh `feature/UNI-1881-unichat-r1-giao-dien-chat-moi-cho-web-va`.

**Goal:** Mọi màn chat trên web (desktop dùng lại web) khớp canvas thiết kế, hành vi giữ nguyên.

**Spec:** `docs/superpowers/specs/2026-10-18-unichat-redesign-design.md` (§2, §3 dòng R1, §4).

## Ràng buộc

- Chỉ sửa `packages/ui/styles/tokens.css` (T0) và file trong `packages/views/chat/`.
- Mỗi task sở hữu một nhóm file riêng; không task nào sửa file của task khác.
- Hành vi, API, store, query key, aria-label và chữ hiện có giữ nguyên trừ chỗ spec §3 R1 nêu.
- Chạy test vitest của đúng file đã sửa (`NODE_OPTIONS=--no-experimental-webstorage`), eslint trên
  file đã sửa; CI chạy phần còn lại.

## Tasks

- [x] **T0 — Token chat** (`tokens.css`): tường, bong bóng, chip, bóng đổ; hai theme; alias Tailwind.
- [ ] **T1 — Bong bóng & dòng tin**: `chat-message-row`, `chat-message-parts`, `chat-message-body`,
  `chat-reply-quote`, `chat-day-separator`, `native-chat-message-item`, `native-chat-message-panel`
  (nền tường), `chat-message-hover-actions` (6 cảm xúc nhanh), `typing-indicator`.
- [ ] **T2 — Tệp, thoại & thẻ**: `chat-file-message-row`, `chat-file-attachment`, `chat-animated-image`,
  `chat-voice-message-row`, `message-task-card`, `chat-card` (thẻ vào cột người gửi), các hàng
  poll / note / post / reminder, `voice-call-log-row`, `voice-call-summary-row`.
- [ ] **T3 — Ô soạn tin**: `chat-composer`, `chat-composer-parts`, `chat-composer-attach-menu`,
  `chat-mention-autocomplete`, `chat-expression-picker`.
- [ ] **T4 — Danh sách hội thoại**: `chat-sidebar*`, `chat-room-mark`, `chat-presence-avatar`,
  `sidebar-typing-dots`, `chat-page-empty-conversation`, `chat-page-auth-loading`,
  `chat-conversation-skeleton`.
- [ ] **T5 — Khung hội thoại**: `chat-conversation-header`, `chat-conversation-toolbar`,
  `chat-page-conversation-toolbar`, `chat-pinned-messages-bar`, `chat-message-search-bar`,
  `chat-realtime-status-banner`, `chat-notice`, `native-chat-panel-bars`, `chat-conversation-intro`.
- [ ] **T6 — Sheet cài đặt & hồ sơ**: sheet nhóm / kênh / tin riêng / phòng workspace và các
  section, `chat-settings-ui`, `chat-person-card`, `chat-member-profile`, `chat-person-shared-panel`,
  `shared-photo-gallery`, hộp đổi tên / biệt danh / chặn / rời.
- [ ] **T7 — Hộp thoại tạo & sheet phụ**: tạo DM / nhóm / kênh, mời thành viên, duyệt kênh,
  bảng tin, Bắt kịp, Theo dõi sau, bản ghi, tạo poll / note / post / nhắc hẹn, việc, xem ảnh,
  người bình chọn.
- [ ] **T8 — Cuộc gọi**: mọi `voice-call-*` và `chat-voice-call-host`, bọc `.dark`.
- [ ] **T9 — Kiểm**: typecheck + lint package `views`, test chat, rồi PR.
