# DriveTokenRefreshFailuresHigh — lỗi làm mới access token Google Drive tăng cao

> **Trạng thái:** shipped · **Sev:** 3 · **Rule:** `deploy/alerts.yml` · **Dashboard:** đọc `sum(increase(drive_token_refresh_failures_total[15m]))` trên Explore · **Nền:** [`docs/runbooks/drive-connector.md`](drive-connector.md)

## Triệu chứng

- Alert `DriveTokenRefreshFailuresHigh`: tổng số lần đổi refresh token Google Drive lấy access token thất bại vượt ngưỡng trong 15 phút (`sum(increase(drive_token_refresh_failures_total[15m])) > 10`).
- Người dùng mở Picker hoặc đọc tệp Google Drive nhận thông báo kết nối chuyển sang trạng thái `needs_reconnect` ("Mất kết nối · kết nối lại") hoặc lỗi tạm thời từ phía Google OAuth (`drive_unavailable`).

## Kiểm tra

1. Xem log server gần thời điểm cảnh báo: tìm các dòng cảnh báo refresh/mark auth failed của Google Drive (`"drive mark auth failed"`, `"code"`) và kiểm tra bảng `drive_connections`:
   ```sql
   SELECT auth_failed_reason, count(*)
   FROM drive_connections
   WHERE auth_failed_at > now() - interval '15 minutes'
   GROUP BY auth_failed_reason;
   ```
2. Phân biệt hai nhóm nguyên nhân:
   - `auth_failed_reason = 'invalid_grant'` hoặc `'unauthorized_client'`: người dùng đã thu hồi quyền ứng dụng trong Google Account, đổi mật khẩu Google, hoặc quản trị viên Google Workspace thay đổi chính sách OAuth/Trusted Apps, hoặc cấu hình `GOOGLE_DRIVE_CLIENT_ID` / `GOOGLE_DRIVE_CLIENT_SECRET` trên server bị lệch.
   - `auth_failed_at IS NULL` nhưng `drive_token_refresh_failures_total` tăng: lỗi mạng/DNS/timeout hoặc 5xx tạm thời từ `https://oauth2.googleapis.com/token` (server giữ nguyên refresh token để thử lại, không đánh dấu `auth_failed_at`).
3. Kiểm tra biến môi trường `GOOGLE_DRIVE_CLIENT_ID`, `GOOGLE_DRIVE_CLIENT_SECRET`, `DRIVE_CREDENTIAL_KEY` trên các replica API và trạng thái Google Identity / Google Workspace Status Dashboard.

## Khắc phục

- Nếu do lỗi mạng/egress tạm thời tới `oauth2.googleapis.com`: khôi phục đường mạng ra ngoài; các kết nối chưa bị `invalid_grant` sẽ tự làm mới lại ở lượt gọi tiếp theo.
- Nếu hàng loạt kết nối bị `unauthorized_client` hoặc `invalid_grant` ngay sau một đợt deploy/xoay secret: kiểm tra lại `GOOGLE_DRIVE_CLIENT_ID` và `GOOGLE_DRIVE_CLIENT_SECRET` trong secret store của môi trường.
- Với các kết nối đã bị Google từ chối vĩnh viễn (`invalid_grant` do người dùng hoặc admin Google Workspace thu hồi): người dùng vào **Cài đặt › Tích hợp › Google Drive** và bấm **Kết nối lại** trên tài khoản đó (giữ nguyên ID kết nối và các tệp đã liên kết).

## Leo thang

- Nếu tỷ lệ lỗi tiếp tục tăng trên nhiều tổ chức dù cấu hình `GOOGLE_DRIVE_CLIENT_ID` / `GOOGLE_DRIVE_CLIENT_SECRET` và đường mạng bình thường: báo kỹ sư trực hạ tầng và owner connector Google Drive (UNI-2172).
