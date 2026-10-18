# UniChat R3 — Tính năng chat cần server — Kế hoạch triển khai

> **Trạng thái:** in-progress — UNI-1894, nhánh `feature/UNI-1894-unichat-r3-tinh-nang-chat-can-server` (xếp trên R1; phần giao diện nối sau khi R2 xong).

**Goal:** Bốn tính năng canvas vẽ mà cần server, mỗi cái theo đúng mẫu đã có trong repo.

**Spec:** `docs/superpowers/specs/2026-10-18-unichat-redesign-design.md` §3 dòng R3. Khảo sát server
2026-10-18 (vị trí code, query, luật tenant) chép ở mô tả từng task dưới.

## Tasks

- [ ] **S1 — Đã xem trong nhóm / kênh.** `ListChatRoomMembers` trả thêm `last_read_at` (RFC3339Nano, không
  dùng `time.RFC3339` như `peer_last_read_at` vì mất phần giây lẻ); `ChatRoomMemberDTO.last_read_at`;
  `markChatRoomRead` phát một sự kiện ephemeral chỉ mang id tới những ai đang mở phòng (nhóm và kênh không mặc
  định); danh mục sự kiện đổi ở cả ba nơi. Client đếm thành viên có `last_read_at >= created_at`, khác người gửi.
- [ ] **S2 — Chưa đọc theo workspace.** `GET /api/v1/me/chat/unread-summary` →
  `{direct: {unread, mentions}, workspaces: [{workspace_id, unread, mentions}]}`; DM và nhóm đếm một lần theo
  tổ chức; phòng tắt báo chỉ tính nhắc tên; mỗi workspace đi qua `RequireMember`; tái dùng hai query danh sách
  phòng; `isoRoutes` lớp self. Client: endpoint + hook + số trên bộ chuyển workspace.
- [ ] **S3 — Ảnh nhóm.** Cột `chat_rooms.avatar_file_id`, mục đích file `chat_room_avatar`, upload/gỡ theo mẫu
  icon workspace, quyền như đổi tên (`allow_change_profile`), audit `chat.room.settings_updated`, sự kiện
  `chat.room.updated`, `avatar_url` trên `ChatRoomDTO`.
- [ ] **S4 — Nguồn cho điểm nổi bật Bắt kịp.** Prompt `chat_catchup@2` với `highlights: [{text, source_id}]`,
  `ai.CatchUp.Highlights` đọc được cả chuỗi lẫn object (tóm tắt cuộc gọi @1 vẫn chạy), API thêm
  `highlight_items: [{text, source_message_id}]` cạnh `highlights`.
- [ ] **S5 — Giao diện** (sau R2): ✓✓ đã xem và "N người đã xem" trong menu tin, ảnh nhóm trong danh sách /
  header / sheet, "Xem tin gốc" cho từng điểm nổi bật.

## Hoãn — cần quyết định của chủ sản phẩm

- Chuyển tiếp tin (có cho chuyển ra khỏi phòng riêng tư không; ghi audit riêng không).
- Bản chép tin thoại (`ai.Gateway.CloudTranscribe`): quyền dùng và tính phí.
- Xem trước liên kết: server tải URL người dùng gửi (SSRF, lộ địa chỉ IP / thời điểm cho bên thứ ba) — cần ADR.
- Dấu "đã tới máy": cần giao thức xác nhận từ thiết bị.
