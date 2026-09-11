# Chat Posts (C-13.5 / UNI-511)

> **Trạng thái:** in-progress

## Mục tiêu

Tách **bài đăng thông báo** (`kind=post`) khỏi tin nhắn chat thường, theo mô hình ClickUp Posts: có tiêu đề, nội dung dài, hiển thị dạng card, xuất hiện trong bulletin kênh. Pin / reaction / thread reuse hạ tầng tin nhắn hiện có.

## Lát 1 (đang làm)

- Migration: thêm `post` vào CHECK `chat_messages.kind`
- `SendPostMessage`: title (≤200) + body (≤8000), metadata `post.{title,pin_to_top}`
- Quyền tạm: `allow_create_notes` (cùng gate với note/reminder)
- UI: menu composer “Tạo bài đăng”, dialog, card timeline, tab Bulletin “Bài đăng”

## Lát sau

- Bảng / API acknowledge (đã đọc / đã xác nhận) + nhắc người chưa đọc
- Quyền riêng `allow_create_posts`
- Soạn thảo markdown giàu hơn (phụ thuộc C-13.4)

## Ngoài phạm vi lát 1

Email blast, @channel bắt buộc, soft-delete audit riêng cho post.
