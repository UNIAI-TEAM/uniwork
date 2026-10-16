# UniChat — Tab Cuộc gọi (lịch sử), Danh bạ, Cài đặt (lát M2b)

> **Trạng thái:** in-progress — Đề xuất, chờ duyệt. Lát M2b của epic UNI-1826; issue UNI-1833.

**Ngày:** 2026-10-16 · **Spec cha:** `2026-10-16-chat-native-apps-design.md` §3.3, §6 M2 · **Quyết định:** bốn tab từ bản đầu (chủ sở hữu, 2026-10-16); tab Cuộc gọi hiện lịch sử trước, gọi được ở M3

## 1. Mục tiêu
Ba tab còn lại đủ dùng: xem lịch sử cuộc gọi của mình, tìm người để nhắn, quản lý tài khoản/thiết bị/thông báo/giao diện/ngôn ngữ.

## 2. Tab Cuộc gọi
Hiện trạng: log cuộc gọi là tin `kind` call-log trong phòng (sự kiện `chat.voice.call.completed`, hàng `voice-call-log-row.tsx` trên web); **chưa có tuyến đọc xuyên phòng**. Thiết kế: thêm `GET /api/v1/workspaces/{workspaceID}/chat/call-logs?cursor&limit` trả call-log của các phòng người gọi là thành viên đang hoạt động (phòng, call_id, người gọi, bắt đầu/kết thúc, thời lượng, người tham gia, loại), mới nhất trước, phân trang con trỏ. Service trong `chat_voice*.go` qua `RequireMember`; sqlc ràng `workspace_id = $n`; SDO có `description`/`example`; `TestIsolationMatrix` phủ vì path có tenant; không bảng, không event mới. Mobile: hàng = avatar/tên phòng hoặc người, chiều gọi, thời lượng, giờ; bấm → mở phòng tại tin call-log; nút gọi lại xuất hiện ở M3. Web có thể dùng cùng tuyến sau (không ngữ nghĩa thứ hai).

## 3. Tab Danh bạ
Nguồn: thành viên workspace hiện tại (API thành viên hiện có) + hiện diện (cùng nguồn web: store presence từ heartbeat/sự kiện) + biệt danh (`listChatNicknames`) + trạng thái chặn (`getChatBlockStatus`). Nhóm theo chữ cái, tìm theo tên/email, bấm → `resolveDMRoom` → hội thoại. Người đã rời (deactivated) không hiện, như web.

## 4. Tab Cài đặt
Hồ sơ (`GET /me`, chỉ xem); **Thiết bị** (`GET /auth/desktop/devices`, thiết bị này được đánh dấu, thu hồi thiết bị khác qua `DELETE …/{deviceSessionID}`); **Thông báo**: bật/tắt push cho thiết bị này (đăng ký/hủy), giải thích rule "không push khi đang hoạt động nơi khác"; **Giao diện**: sáng/tối/hệ thống; **Ngôn ngữ**: vi/en áp dụng ngay; **Workspace**: chuyển workspace trong tổ chức; **Đăng xuất** (`POST /auth/desktop/logout`, xóa SecureStore, hủy push); phiên bản/bản build; liên kết Điều khoản/Riêng tư (web).

## 5. Tiêu chí hoàn thành và test
- Tuyến call-logs: test handler phân trang + quyền (không thành viên → 403/404), `TestEveryQueryNamesItsTenant`, `docs/api-sdi-sdo.md`; mobile hiện đúng các cuộc gọi web hiện trong phòng của người dùng.
- Danh bạ: số người và hiện diện khớp web; người bị chặn theo cùng luật.
- Cài đặt: thu hồi thiết bị khác → thiết bị đó rơi phiên ≤ 1 phút (socket `CloseSessionEnded` hoặc refresh thất bại); tắt push → subscription thu hồi phía server; đổi ngôn ngữ/giao diện áp dụng không khởi động lại.
- Trợ năng, sáng/tối, vi/en như M2a. Lệnh: `pnpm --filter @uniwork/chat-mobile test`; `make test-go` (gói `service`, `handler`).

## 6. Rủi ro
Tuyến đọc mới là thay đổi server duy nhất của lát; giữ nhỏ và chỉ đọc.

## 7. Để builder quyết
Hình dạng SDO call-log; có gộp cuộc gọi nhỡ/đã nhận bằng biểu tượng hay nhóm; nơi đặt "Thiết bị" (Cài đặt hay Hồ sơ).
