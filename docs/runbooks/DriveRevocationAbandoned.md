# DriveRevocationAbandoned — thu hồi grant Google Drive bỏ cuộc sau 24 giờ

> **Trạng thái:** shipped · **Sev:** 3 · **Rule:** `deploy/alerts.yml` · **Dashboard:** đọc `sum(increase(drive_revocation_abandoned_total[15m]))` trên Explore · **Nền:** [`docs/runbooks/drive-connector.md`](drive-connector.md)

## Triệu chứng

- Alert `DriveRevocationAbandoned`: có dòng thu hồi refresh token trong `drive_grant_revocations` vượt ngưỡng thử lại 24 giờ (`drive_revocation_abandoned_total > 0`), worker đã xóa `refresh_token_enc`, đặt `resolved_at` và ghi log mức error với `code=DriveRevocationAbandoned`.
- Token trong UniWork đã bị xóa ngay lúc ngắt kết nối (`drive_connections.refresh_token_enc = ''`), nên không một luồng nào của UniWork còn gọi được Google bằng grant đó; tuy nhiên grant phía tài khoản Google của người dùng có thể vẫn còn liệt kê ứng dụng UniWork cho tới khi người dùng tự gỡ tại Google Account Security.

## Kiểm tra

1. Xem log server gần thời điểm cảnh báo: tìm `"drive grant revocation abandoned after 24h"` (`code=DriveRevocationAbandoned`, `last_error`, `attempts`).
2. Kiểm tra bảng `drive_grant_revocations`:
   ```sql
   SELECT google_sub, generation, requested_at, resolved_at, attempts, last_error
   FROM drive_grant_revocations
   WHERE resolved_at IS NOT NULL AND last_error <> ''
   ORDER BY resolved_at DESC LIMIT 20;
   ```
3. Kiểm tra đường ra mạng từ cluster tới `https://oauth2.googleapis.com/revoke` (DNS, egress firewall/NAT, trạng thái Google Workspace / Google Identity).

## Khắc phục

- Nếu lỗi mạng/DNS hoặc proxy tạm thời từ cluster tới `oauth2.googleapis.com`: khôi phục kết nối mạng ra ngoài để các lượt ngắt kết nối mới thu hồi bình thường.
- Dòng đã bỏ cuộc đã xóa `refresh_token_enc` khỏi cơ sở dữ liệu (theo nguyên tắc không giữ bí mật quá 24 giờ), nên không chạy lại tự động. Nếu người dùng liên hệ cần gỡ quyền ngay phía Google, hướng dẫn họ vào `https://myaccount.google.com/permissions` để gỡ quyền ứng dụng UniWork.

## Leo thang

- Nếu nhiều dòng liên tiếp bỏ cuộc do lỗi cấu hình mạng/egress hoặc thay đổi endpoint của Google: báo kỹ sư trực hạ tầng và owner connector Google Drive (UNI-2172).
