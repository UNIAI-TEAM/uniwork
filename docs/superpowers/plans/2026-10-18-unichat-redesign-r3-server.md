# UniChat R3 — Tính năng chat cần server — Kế hoạch triển khai

> **Trạng thái:** in-progress — UNI-1894; code xong (S1–S8), gộp chung một PR với R1, R2, R4 trên nhánh `feature/UNI-1881-unichat-giao-dien-chat-moi`.

**Goal:** Bốn tính năng canvas vẽ mà cần server, mỗi cái theo đúng mẫu đã có trong repo.

**Spec:** `docs/superpowers/specs/2026-10-18-unichat-redesign-design.md` §3 dòng R3. Khảo sát server
2026-10-18 (vị trí code, query, luật tenant) chép ở mô tả từng task dưới.

## Tasks

- [x] **S1 — Đã xem trong nhóm / kênh.** `ListChatRoomMembers` trả thêm `last_read_at` (RFC3339Nano, không
  dùng `time.RFC3339` như `peer_last_read_at` vì mất phần giây lẻ); `ChatRoomMemberDTO.last_read_at`;
  `markChatRoomRead` phát một sự kiện ephemeral chỉ mang id tới những ai đang mở phòng (nhóm và kênh không mặc
  định); danh mục sự kiện đổi ở cả ba nơi. Client đếm thành viên có `last_read_at >= created_at`, khác người gửi.
- [x] **S2 — Chưa đọc theo workspace.** `GET /api/v1/me/chat/unread-summary` →
  `{direct: {unread, mentions}, workspaces: [{workspace_id, unread, mentions}]}`; DM và nhóm đếm một lần theo
  tổ chức; phòng tắt báo chỉ tính nhắc tên; mỗi workspace đi qua `RequireMember`; tái dùng hai query danh sách
  phòng; `isoRoutes` lớp self. Client: endpoint + hook + số trên bộ chuyển workspace.
- [x] **S3 — Ảnh nhóm.** Cột `chat_rooms.avatar_file_id`, mục đích file `chat_room_avatar`, upload/gỡ theo mẫu
  icon workspace, quyền như đổi tên (`allow_change_profile`), audit `chat.room.settings_updated`, sự kiện
  `chat.room.updated`, `avatar_url` trên `ChatRoomDTO`.
- [x] **S4 — Nguồn cho điểm nổi bật Bắt kịp.** Prompt `chat_catchup@2` với `highlights: [{text, source_id}]`,
  `ai.CatchUp.Highlights` đọc được cả chuỗi lẫn object (tóm tắt cuộc gọi @1 vẫn chạy), API thêm
  `highlight_items: [{text, source_message_id}]` cạnh `highlights`.
- [x] **S5 — Giao diện** (sau R2): ✓✓ đã xem và "N người đã xem" trong menu tin, ảnh nhóm trong danh sách /
  header / sheet, "Xem tin gốc" cho từng điểm nổi bật.
- [x] **S6 — Bảng thông tin: mô tả nhóm và việc từ cuộc trò chuyện** (UNI-1881, canvas `Main`). Mô tả dùng lại
  cột `chat_rooms.topic` (không migration): `PATCH .../chat/rooms/{roomID}` nhận `topic` (≤280 ký tự, rỗng là
  xoá), quyền như đổi tên, cùng audit `chat.room.settings_updated` và sự kiện `chat.room.updated`; danh sách
  phòng và phòng vừa tạo trả `topic` cho nhóm. `GET .../chat/rooms/{roomID}/linked-tasks?limit=` →
  `{tasks, total}` từ `chat_message_links`, mỗi task một lần, gắn gần nhất trước (mặc định 20, tối đa 50); cổng
  `authorizeRoomRead`, chỉ task của workspace trên URL (task gắn từ workspace khác của DM/nhóm cấp tổ chức bị
  bỏ). Client: `useChatRoomLinkedTasks`, `topic` trong `useUpdateChatRoomSettings`; làm mới khi liên kết hoặc
  task đổi.
- [x] **S7 — Cuộc gọi nhỡ và độ dài tin thoại trên danh sách** (canvas `Main`). Danh sách phòng (DM/nhóm, kênh)
  và tin mới nhất của một phòng trả `last_message_call_outcome` (chỉ nhật ký cuộc gọi) và
  `last_message_duration_ms` (chỉ tin thoại); danh sách kênh khám phá / theo dự án trả rỗng.
- [x] **S8 — Tóm tắt ảnh / tệp đã chia sẻ** (bảng thông tin). `GET .../chat/rooms/{roomID}/shared-summary` →
  số ảnh / GIF / video / tệp / liên kết / thoại và tối đa 6 ảnh mới nhất (ký URL như danh sách tin), một truy
  vấn, cổng `authorizeRoomRead`, luật đếm chép từ `sharedItemsFromMessages` và đã đối chiếu trên mọi phòng
  seed; không migration. Thay việc client lật tới 500 tin mỗi lần mở phòng; lịch sử chỉ tải khi mở tab.

## Hoãn — cần quyết định của chủ sản phẩm

- Chuyển tiếp tin (có cho chuyển ra khỏi phòng riêng tư không; ghi audit riêng không).
- Bản chép tin thoại (`ai.Gateway.CloudTranscribe`): quyền dùng và tính phí.
- Xem trước liên kết: server tải URL người dùng gửi (SSRF, lộ địa chỉ IP / thời điểm cho bên thứ ba) — cần ADR.
- Dấu "đã tới máy": cần giao thức xác nhận từ thiết bị.

## Ghi chú khi xong (2026-10-18)

- Bốn nhánh server (S1–S4) gộp vào nhánh R3; R2 gộp vào để S5 nối giao diện lên trên.
- Kiểm trên bản gộp: `TestIsolationMatrix` / `TestIsolationMCP` / `TestIsolationRealtime` /
  `TestEveryBodyIDFieldHasAReferenceCase` qua; `go test ./migrations/` (lint, tenant), `./internal/` (kiến trúc),
  `./internal/handler/router/` (OpenAPI + rate limit chạy riêng), gói service / handler / ai / outbox qua;
  `scripts/events-catalogue.test.mjs` và các test hợp đồng khác qua; vitest views `chat/ layout/` 729, core 360.
- Rate-limit test của router trượt khi nhiều worktree cùng chạy (chung Redis db 15) — chạy riêng thì qua.
- Đồng hồ Postgres trong Docker local lùi 80–160 ms mỗi ~10 giây; test đếm chưa đọc thỉnh thoảng trượt vì vậy ở máy
  local, không phải lỗi code.
- Còn lại: mobile chưa có "đã xem" trong nhóm, ảnh nhóm và số chưa đọc theo workspace; cột workspace dọc trên
  desktop (hiện là số trên bộ chuyển workspace); đếm dư "đã xem" khi hai tin cùng một giây (giờ tin chỉ có giây).
