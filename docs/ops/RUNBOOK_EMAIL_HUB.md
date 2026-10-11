# Runbook — Email Hub: xác thực hộp thư và kết nối lại

> **Trạng thái:** shipped · **Cập nhật:** 2026-10-11 · **Thành phần:** `EmailHubService` trong tiến trình API (`server/internal/service/email_hub*.go`), worker sync và watcher IDLE · **Liên quan:** ADR 0022, ADR 0025, spec `2026-10-11-email-hub-oauth-custom-server-design.md`, UNI-1237

Một tài khoản Email Hub (`email_hub_accounts`) ở một trong ba trạng thái:

| Trạng thái | Điều kiện trên dòng | Ý nghĩa |
| --- | --- | --- |
| `active` | `disconnected_at IS NULL AND auth_failed_at IS NULL` | Sync, watcher, gửi chạy bình thường |
| `needs_reconnect` | `disconnected_at IS NULL AND auth_failed_at IS NOT NULL` | Máy chủ thư từ chối credential. Thư đã cache **còn nguyên** và vẫn đọc được; mọi thao tác chạm máy chủ trả `409 email_hub_reauth_required` |
| `disconnected` | `disconnected_at IS NOT NULL` | Người dùng ngắt kết nối hoặc rời tổ chức; cache đã bị dọn |

Mất xác thực **không** xoá thư nữa. Tài khoản chỉ quay lại `active` khi người dùng
kết nối lại cùng địa chỉ (cùng id, `credential_version` tăng, `auth_failed_*` bị xoá).
Không có metric hay alert riêng cho Email Hub, nên runbook này nằm ở `docs/ops/`
chứ không ở `docs/runbooks/`.

## Số cần nhìn

| Nguồn | Ý nghĩa | Ngưỡng |
| --- | --- | --- |
| `uniwork_audit_events_total{action="email_hub_account.auth_failed"}` | Số lần một tài khoản chuyển sang `needs_reconnect` | Tăng đột biến trên nhiều tổ chức cùng lúc = phía nhà cung cấp đổi chính sách, không phải người dùng đổi mật khẩu |
| `uniwork_audit_events_total{action="email_hub_account.connected"}` | Kết nối mới và kết nối lại | Phẳng trong khi `auth_failed` tăng = người dùng không thấy banner *Kết nối lại* |
| `uniwork_audit_events_total{action="email_hub_account.disconnected"}` | Ngắt kết nối (người dùng, rời tổ chức) | Chỉ để nhìn |

## Triệu chứng và cách xử lý

### Tài khoản Email Hub cần kết nối lại

Người dùng thấy badge và banner *Kết nối lại*, hoặc gặp `409 email_hub_reauth_required`.

1. Đếm theo lý do:

```sql
SELECT auth_failed_reason, provider, count(*), min(auth_failed_at), max(auth_failed_at)
FROM email_hub_accounts
WHERE auth_failed_at IS NOT NULL AND disconnected_at IS NULL
GROUP BY auth_failed_reason, provider
ORDER BY 3 DESC;
```

2. Đọc mã:

| `auth_failed_reason` | Nguồn | Nguyên nhân thường gặp | Xử lý |
| --- | --- | --- | --- |
| `imap_auth_failed` | IMAP `NO [AUTHENTICATIONFAILED]` | Người dùng đổi mật khẩu tài khoản hoặc thu hồi App Password; Google tắt App Password khi tắt 2FA | Người dùng bấm *Kết nối lại* và nhập App Password mới |
| `imap_login_refused` | 3 lần liên tiếp IMAP trả NO không kèm mã (`emailHubRefusedLoginsBeforeDisconnect`) | IMAP bị tắt trong cài đặt hộp thư; máy chủ chặn IP; mật khẩu sai với máy chủ không trả mã chuẩn | Bật IMAP trong cài đặt hộp thư rồi kết nối lại |
| `smtp_auth_failed` | SMTP 535/534 (không phải trường hợp SMTP AUTH bị tắt) | Mật khẩu SMTP khác mật khẩu IMAP, hoặc đã bị thu hồi | Kết nối lại |

   Sau GĐ3 (OAuth) sẽ có thêm lý do từ refresh token. Google để client ở chế độ *Testing*
   cho tới khi qua verification, và trong chế độ đó refresh token hết hạn sau 7 ngày, nên
   các tài khoản Gmail sẽ đồng loạt rơi về `needs_reconnect` theo chu kỳ 7 ngày.

3. Không có thao tác SQL nào "sửa" một tài khoản. Đặt `auth_failed_at = NULL` bằng tay
   chỉ làm worker dial lại bằng credential đã bị từ chối, và nhà cung cấp có thể khoá
   hộp thư vì đăng nhập sai lặp lại. Chỉ người dùng kết nối lại mới đưa tài khoản về `active`.

4. Xem lịch sử một tài khoản:

```sql
SELECT action, actor_kind, actor_id, metadata, occurred_at
FROM audit_events
WHERE action LIKE 'email_hub_account.%' AND resource_id = '<account_id>'
ORDER BY occurred_at DESC LIMIT 20;
```

### Gửi thất bại với `smtp_disabled` (Microsoft 365)

Tenant M365 tắt SMTP AUTH (`SmtpClientAuthentication is disabled`, mã `535 5.7.139`).
Đây **không** phải lỗi xác thực: tài khoản vẫn `active`, IMAP vẫn sync, credential
được giữ. Lần gửi trả `400 email_hub_smtp_disabled`; hẹn giờ gửi đến hạn kết thúc `failed`:

```sql
SELECT last_error, count(*), max(send_at)
FROM email_hub_scheduled_sends
WHERE status = 'failed' AND last_error IN ('smtp_disabled', 'auth_required')
GROUP BY last_error;
```

Xử lý: quản trị viên M365 bật *Authenticated SMTP* cho hộp thư đó (Microsoft 365 admin
center → Users → Mail → *Manage email apps*) hoặc cho cả tenant
(`Set-TransportConfig -SmtpClientAuthenticationDisabled $false`). Không cần kết nối lại.
`auth_required` là hẹn giờ gửi đến hạn khi tài khoản đang `needs_reconnect`; thư không
được gửi trễ âm thầm, nên người dùng phải gửi lại sau khi kết nối lại.

### Kết nối thất bại

| Mã API | Ý nghĩa | Xử lý |
| --- | --- | --- |
| `email_hub_already_connected` (409) | Địa chỉ đã có tài khoản `active` cùng kiểu xác thực, cùng máy chủ; kiểm tra chạy trước khi dial | Không phải lỗi; người dùng đã kết nối rồi |
| `email_hub_unreachable` (400) | DNS không phân giải, TCP/TLS không xong trong hạn, **hoặc** host phân giải ra IP bị `netguard` chặn | Cố ý gộp chung để API không thành công cụ dò mạng nội bộ |
| `email_hub_tls_required` (400) | Máy chủ không có TLS ngầm định, hoặc không quảng bá `STARTTLS` | Hộp thư không có TLS sẽ không được hỗ trợ |
| `email_hub_smtp_disabled` (400) | Như mục M365 ở trên, phát hiện ngay lúc kết nối | Bật SMTP AUTH rồi kết nối lại |

Route kết nối giới hạn 10 lần / 10 phút cho mỗi người dùng (cần Redis). Bị `429` thì chờ.
Log chỉ ghi mã đã phân loại (`host_not_allowed`, `tls_required`, `unreachable`,
`auth_failed`, `smtp_disabled`) kèm `account_id` / `user_id` / `provider`. Host, email và
phản hồi thô của IMAP/SMTP không bao giờ vào log, nên đừng đi tìm chúng ở đó.

### Migration dedupe và unique index

`999*_email_hub_accounts_dedupe` ngắt các dòng trùng `(organization_id, user_id,
lower(email_address))` còn active, giữ dòng tạo sớm nhất, huỷ hẹn giờ gửi `pending`/`failed`
và xoá threads, attachments, AI summaries của dòng bị ngắt. Không đảo ngược được (down là
`SELECT 1`). Body trên object storage để GC file dọn như thường.

Migration sau đó build `idx_email_hub_accounts_active_address` bằng `CREATE UNIQUE INDEX
CONCURRENTLY`. Nếu build thất bại (thường do pod cũ trong cửa sổ rolling update đã tạo
thêm một dòng trùng sau khi dedupe chạy), PostgreSQL để lại một index `INVALID`. Đừng
giả định `schema_migrations` chưa ghi version đó: container chạy `migrate up && server` mỗi
lần khởi động, nên lần restart kế tiếp gặp `CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS`,
thấy đã có index cùng tên (dù `INVALID`), bỏ qua với một NOTICE và **ghi version là đã
chạy**. Server lên bình thường nhưng bảng không có ràng buộc unique nào còn hiệu lực:

```sql
SELECT c.relname, i.indisvalid
FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
WHERE c.relname = 'idx_email_hub_accounts_active_address';

SELECT organization_id, user_id, lower(email_address), count(*)
FROM email_hub_accounts WHERE disconnected_at IS NULL
GROUP BY 1, 2, 3 HAVING count(*) > 1;
```

Khắc phục (làm đủ cả năm bước, kể cả khi version chưa được ghi):

1. Chạy lại file dedupe bằng tay. File này idempotent: nhóm nào chỉ còn một dòng active thì
   không bị đụng tới. Query đếm trùng ở trên phải trả về rỗng.
   `psql "$DATABASE_URL" -f server/migrations/9991791700000002_email_hub_accounts_dedupe.up.sql`
2. `DROP INDEX CONCURRENTLY IF EXISTS idx_email_hub_accounts_active_address;`
3. Xoá version đã ghi để migrate build lại index (không có dòng nào thì lệnh không làm gì):
   `DELETE FROM schema_migrations WHERE version = '9991791700000003_email_hub_accounts_active_address_uidx';`
4. Chạy lại migrate (`bin/migrate up`, hoặc `cd server && go run ./cmd/migrate up`).
5. Chạy lại query `indisvalid` ở trên: phải có đúng một dòng với `indisvalid = true`. Không có
   dòng nào, hoặc `false`, thì bảng chưa có ràng buộc; quay lại bước 1.
