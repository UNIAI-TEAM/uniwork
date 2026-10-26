# drive-connector — vận hành connector Google Drive (UNI-2172)

> **Trạng thái:** shipped · **Sev:** 3 · **Rule:** [`DriveTokenRefreshFailuresHigh.md`](DriveTokenRefreshFailuresHigh.md), [`DriveRevocationAbandoned.md`](DriveRevocationAbandoned.md) · **File:** `server/internal/service/drive_connections.go`, `server/internal/service/drive_oauth_refresh.go`, `server/internal/service/drive_oauth_revoke.go`

Connector Google Drive (UNI-2172) dùng OAuth client riêng (`GOOGLE_DRIVE_CLIENT_ID`, `GOOGLE_DRIVE_CLIENT_SECRET`), khóa mã hóa riêng (`DRIVE_CREDENTIAL_KEY`) và cờ `drive_connector`.

## Triệu chứng

- Nút "Kết nối Google Drive" không hiện trên web/desktop (`GET /api/v1/config` trả `drive.available: false`), hoặc `POST /api/v1/workspaces/{workspaceID}/drive-connections/google/start` trả `503 drive_unavailable` / `404 feature_disabled`.
- Người dùng nhận kết quả popup `blocked_by_workspace_admin`, `scope_not_granted`, `account_mismatch`, `retry_connect`, hoặc kết nối chuyển sang `needs_reconnect` (`auth_failed_reason = invalid_grant`).
- Cảnh báo `DriveTokenRefreshFailuresHigh` bắn khi số lần đổi refresh token thất bại tăng cao, hoặc `DriveRevocationAbandoned` bắn do worker không gọi được `https://oauth2.googleapis.com/revoke` trong 24 giờ.

## Kiểm tra

1. Biến môi trường trên server: `GOOGLE_DRIVE_CLIENT_ID`, `GOOGLE_DRIVE_CLIENT_SECRET`, `GOOGLE_DRIVE_PICKER_API_KEY`, `GOOGLE_DRIVE_APP_ID`, `DRIVE_CREDENTIAL_KEY` (32 byte base64, khác hoàn toàn `EMAIL_HUB_CREDENTIAL_KEY` và `CALENDAR_CREDENTIAL_KEY`). Trên môi trường dev/E2E không gọi Google thật có thể đặt `DRIVE_FAKE_PROVIDER=1` (server từ chối khởi động nếu bật khi `APP_ENV=production`).
2. Cờ `drive_connector` trong `/admin/flags` (mặc định `false`; bật theo tổ chức hoặc toàn cục khi triển khai).
3. Chỉ số Prometheus:
   - `drive_token_refresh_failures_total`: số lần đổi refresh token lấy access token thất bại (xem [`DriveTokenRefreshFailuresHigh.md`](DriveTokenRefreshFailuresHigh.md)).
   - `drive_revocation_abandoned_total`: số dòng thu hồi grant bỏ cuộc sau 24 giờ thử lại (xem [`DriveRevocationAbandoned.md`](DriveRevocationAbandoned.md)).
4. Trạng thái hàng đợi thu hồi grant:
   ```sql
   SELECT count(*) FILTER (WHERE resolved_at IS NULL AND refresh_token_enc IS NOT NULL) AS open_revocations,
          count(*) FILTER (WHERE resolved_at IS NOT NULL AND last_error <> '') AS abandoned_revocations
   FROM drive_grant_revocations;
   ```

## Khắc phục

1. Nếu `drive.available = false`: kiểm tra log khởi động server (`"google drive connector disabled"`), bổ sung đủ `GOOGLE_DRIVE_CLIENT_ID`, `GOOGLE_DRIVE_CLIENT_SECRET`, `DRIVE_CREDENTIAL_KEY` và bật cờ `drive_connector`.
2. Nếu người dùng gặp `blocked_by_workspace_admin`: quản trị viên Google Workspace của khách hàng cần đưa Client ID của UniWork Drive vào danh sách ứng dụng tin cậy (Trusted Apps) trong Google Admin Console.
3. Nếu cần tắt khẩn cấp toàn bộ tính năng Google Drive cho một tổ chức hoặc toàn hệ thống: tắt cờ `drive_connector` tại `/admin/flags`; mọi route `/drive-connections*`, `/drive-files*`, `/drive-task-proposals*` sẽ trả `404 feature_disabled` ngay lập tức.

## Leo thang

- Sự cố xác thực OIDC/OAuth diện rộng hoặc nghi ngờ lộ `DRIVE_CREDENTIAL_KEY`: xoay `DRIVE_CREDENTIAL_KEY` + `GOOGLE_DRIVE_CLIENT_SECRET`, tắt cờ `drive_connector` và báo ngay cho owner bảo mật + nhóm Work Management.
