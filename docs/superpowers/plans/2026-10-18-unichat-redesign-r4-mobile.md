# UniChat R4 — Giao diện mobile theo canvas — Kế hoạch triển khai

> **Trạng thái:** in-progress — UNI-1895, nhánh `feature/UNI-1895-unichat-r4-giao-dien-mobile` (xếp trên R1).

**Goal:** `apps/chat-mobile` khớp trang "Mobile" và "Tổng quan" của canvas: tường chat, bong bóng ghép lượt,
ô soạn bo tròn, sheet nhấn giữ có thanh cảm xúc, danh sách có nút workspace và chip lọc, các tab Cuộc gọi /
Danh bạ / Cài đặt, màn đăng nhập, chọn workspace, thông tin phòng, thread, cuộc gọi tối.

**Spec:** `docs/superpowers/specs/2026-10-18-unichat-redesign-design.md` §3 dòng R4; luật app ở
`apps/chat-mobile/CLAUDE.md` (ranh giới import ADR 0011, theme ba file).

## Ràng buộc

- Không đổi endpoint, cache, realtime, máy trạng thái cuộc gọi. Lọc / gom chỉ ở client, có test ở `lib/`.
- Màu chỉ qua token của theme (đã thêm: `chat-wall`, `chat-bubble-*`, `chat-chip*`, `tint-*`,
  `destructive-solid`); không mã màu cứng trong component.
- Chữ lấy từ locale đã đồng bộ (`scripts/sync-i18n.mjs`); khóa mới ghi lại, không tự sửa locale.
- Kiểm: `pnpm --filter @uniwork/chat-mobile typecheck`, `lint`, `vitest` của `lib/` đã chạm.

## Tasks

- [x] **T0 — Token chat mobile** (global.css, lib/theme.ts, tailwind.config.js).
- [x] **M1 — Hội thoại**: `conversation`, `chat-header`, `message-list`, `message-row`, `composer`.
- [x] **M2 — Thẻ & sheet**: `message-cards`, `task-card`, `message-actions`, `expression-sheet`,
  `reminder-sheet`, `image-viewer`, `components/ui/action-sheet`.
- [x] **M3 — Danh sách & các màn khác**: tab Chat (`room-row`, `room-avatar`, header + nút workspace + chip
  lọc), tab Cuộc gọi / Danh bạ / Cài đặt, đăng nhập, chọn workspace, nhắn tin mới, duyệt kênh, thông tin phòng, thread.
- [x] **M4 — Cuộc gọi**: `call-overlay`, `call-room`, `call-button`.
- [x] **M5 — Kiểm**: typecheck, lint, test, rồi PR.

## Ghi chú khi xong (2026-10-18)

- Kiểm: typecheck, lint, 59 file / 742 test vitest có ngưỡng coverage, knip, ranh giới import — xanh. Chưa chạy
  trên máy thật / simulator.
- Không làm vì thiếu dữ liệu hoặc gói: lưới chấm trên tường (không có react-native-svg), nền mờ sau menu nhấn giữ
  (không có expo-blur), Tải xuống / Chia sẻ trong trình xem ảnh, bảng emoji cho cảm xúc, huy hiệu chưa đọc trên tab,
  "Tạo nhóm" và mục ảnh / tệp đã chia sẻ trên mobile, số chưa đọc theo workspace (R3).
