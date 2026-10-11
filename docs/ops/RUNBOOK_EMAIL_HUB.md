# Runbook — Email Hub: xác thực hộp thư và kết nối lại

> **Trạng thái:** shipped · **Cập nhật:** 2026-10-11 · **Thành phần:** `EmailHubService` trong tiến trình API (`server/internal/service/email_hub*.go`), worker sync và watcher IDLE · **Liên quan:** ADR 0022, ADR 0025, spec `2026-10-11-email-hub-oauth-custom-server-design.md`, UNI-1237, UNI-1238

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

Trường máy chủ được kiểm tra trước mọi lần dial, nên ba mã đầu không bao giờ chạm mạng.

| Mã API | Ý nghĩa | Xử lý |
| --- | --- | --- |
| `email_hub_unsupported` (400) | Không có trường máy chủ và tên miền không thuộc danh sách nhà cung cấp có sẵn (`emailhub.ProviderForEmail`) | Chọn *Tên miền riêng* và nhập máy chủ IMAP/SMTP |
| `email_hub_invalid_server` (400) | Có trường máy chủ nhưng thiếu một trong sáu trường, hoặc một trường sai định dạng: host có scheme, cổng hay đường dẫn (`imaps://…`, `mail.example.com:993`), nhãn rỗng (`mail..example.com`), dài quá 253 ký tự; port ngoài `25, 143, 465, 587, 993`; bảo mật khác `tls`/`starttls`; tên đăng nhập quá 320 ký tự. `error.fields.field` là tên trường SDI (`imap_host`, `smtp_port`, `username`, …) | Client hiện lỗi ngay cạnh ô đó. Port gửi dạng chuỗi (`"imap_port": "993"`) không tới được bước này: `decode` trả `400 invalid_request` |
| `email_hub_host_not_allowed` (400) | Host là IP literal thuộc dải `netguard` chặn (loopback, private, link-local như `169.254.169.254`, kể cả dạng IPv4-mapped `::ffff:10.0.0.1`) | Dùng hostname hoặc IP công khai của máy chủ thư |
| `email_hub_already_connected` (409) | Địa chỉ đã có tài khoản `active` cùng kiểu xác thực, cùng host + port IMAP (đã chuẩn hoá); kiểm tra chạy trước khi dial. Chỉ đổi SMTP hoặc tên đăng nhập trên một tài khoản `active` cũng nhận mã này | Không phải lỗi. Muốn đổi riêng phần SMTP của tài khoản đang chạy thì ngắt kết nối rồi kết nối lại (cache tải lại từ đầu) |
| `email_hub_unreachable` (400) | DNS không phân giải; TCP/TLS không xong trong hạn; chứng chỉ không khớp host đã nhập (hay gặp ở cPanel dùng chứng chỉ chung của máy chủ); chọn STARTTLS cho cổng 993/465 (treo ở lời chào tới hết hạn); **hoặc** hostname phân giải ra IP bị `netguard` chặn | Cố ý gộp chung để API không thành công cụ dò mạng nội bộ. Hỏi nhà cung cấp hosting hostname ghi trên chứng chỉ (thường là `server.<hosting>`, không phải `mail.<tên miền>`) và kiểm tra cặp cổng/bảo mật |
| `email_hub_tls_required` (400) | Máy chủ không có TLS ngầm định, không quảng bá `STARTTLS`, hoặc bảo mật không khớp cổng (chọn TLS cho 143/587 thì máy chủ chào bằng văn bản thường) | Cặp thường dùng: IMAP 993 + TLS hoặc 143 + STARTTLS; SMTP 465 + TLS hoặc 587 + STARTTLS. Hộp thư không có TLS không được hỗ trợ |
| `email_hub_connect_failed` (400) | Máy chủ từ chối đăng nhập | Sai mật khẩu, hoặc máy chủ cần tên đăng nhập khác địa chỉ email (điền ô *Tên đăng nhập*) |
| `email_hub_smtp_disabled` (400) | Như mục M365 ở trên, phát hiện ngay lúc kết nối | Bật SMTP AUTH rồi kết nối lại |
| `rate_limited` (429) | Quá 10 lần kết nối / 10 phút cho mỗi người dùng (cần Redis) | Chờ vài phút |

Mọi dòng log trên đường chạm máy chủ thư chỉ ghi mã đã phân loại ở khoá `code`, kèm
`account_id` / `thread_id` / `user_id` / `provider`. Các đường đó gồm: kết nối, gửi, APPEND,
sync, watcher IDLE, tải body và attachment, tìm IMAP, chuyển thư mục, đánh dấu. Các mã gồm
`unreachable`, `host_not_allowed`, `tls_required`, `auth_failed`, `smtp_disabled`,
`connect_failed`, `timeout`, `db`.

Host, email, tên đăng nhập và phản hồi thô của máy chủ không có trong log. Lỗi kết nối, sync
và các đường khác trả lên handler được rút gọn thành `email hub mail server: <code>`. Ngoại lệ
là gửi (Send): nó trả `ErrEmailHubSendFailed` kèm văn bản lỗi SMTP thô, handler trả 502 chung và không
ghi lỗi thô đó vào log.

Khi log có `host_not_allowed` mà API trả `email_hub_unreachable`, hostname đã phân giải ra IP
bị chặn. Khi IP literal bị chặn, API trả thẳng `email_hub_host_not_allowed`.

Cần biết máy chủ của một tài khoản thì đọc dòng của nó. Không dán kết quả ra kênh chung:

```sql
SELECT provider, imap_host, imap_port, imap_security, smtp_host, smtp_port, smtp_security
FROM email_hub_accounts WHERE id = '<account_id>';
```

### Kết nối lại đổi máy chủ

Kết nối lại một tài khoản `needs_reconnect` giữ nguyên id. Host được so sánh sau khi chuẩn hoá
(chữ thường, bỏ dấu chấm cuối, punycode), nên `MAIL.Example.COM.` và `mail.example.com` là
cùng một máy chủ.

Chỉ khi host hoặc port IMAP thật sự đổi, `sync_state` mới về rỗng, ngay trong transaction kết
nối. Sau commit, server làm các bước sau:

1. Dừng watcher IDLE. Client đăng ký lại sau khi tải lại danh sách tài khoản.
2. Quên bản đồ thư mục đã cache.
3. Xoá threads, attachments, tóm tắt AI và huỷ hẹn giờ gửi của tài khoản.
4. Sync lại từ đầu.

Công việc đọc tài khoản trước lần kết nối lại (một lượt sync, IDLE hay tìm IMAP còn chạy) bị
chặn trên node này theo `credential_version`, nên không ghi được thread, không prune được, và
lệnh ghi `sync_state` có điều kiện `credential_version` nên cũng không ghi được.

Đổi riêng SMTP hoặc tên đăng nhập thì giữ nguyên cache. Nếu bước dọn cache lỗi, kết nối vẫn
thành công: có một dòng Warn `email hub server change cleanup failed` kèm `account_id` và
`code`, và lần sync sau ghi đè dữ liệu cũ.

Xem các lần kết nối lại có đổi máy chủ:

```sql
SELECT occurred_at,
       metadata::jsonb->>'provider'       AS provider,
       metadata::jsonb->>'reconnected'    AS reconnected,
       metadata::jsonb->>'server_changed' AS server_changed
FROM audit_events
WHERE action = 'email_hub_account.connected' AND resource_id = '<account_id>'
ORDER BY occurred_at DESC LIMIT 10;
```

### Thư đã gửi thiếu trong Sent trên máy chủ (APPEND)

Áp dụng cho `provider = 'custom'` có máy chủ IMAP không phải Gmail hay Microsoft
(`emailhub.ServerSavesSent`). Sau khi SMTP gửi xong, server `APPEND` đúng bản MIME đã gửi (cờ
`\Seen`) vào thư mục SPECIAL-USE `\Sent`, không có thì vào `SENT`. Hẹn giờ gửi đi cùng đường
này.

Tài khoản `custom` trỏ vào `imap.gmail.com` hoặc `outlook.office365.com` (Workspace/M365 trên
tên miền riêng) không APPEND, vì máy chủ tự lưu thư đã gửi.

- Thành công: máy chủ có UIDPLUS thì dòng Sent cục bộ nhận ngay UID thật. Không có UIDPLUS
  thì dòng giữ UID tạm, và lần sync Sent kế tiếp hợp nhất theo `Message-ID`. Cả hai trường
  hợp, Sent hiện đúng một bản.
- Thất bại: chỉ ghi log `email hub sent copy append failed` kèm `account_id` và `code`. Lần
  gửi vẫn thành công (201) và không thử lại. Thư tới người nhận nhưng không có bản trong Sent
  trên máy chủ, và dòng Sent cục bộ (UID tạm) biến mất ở lần làm mới Sent kế tiếp.
  - `auth_failed` đi qua luồng *cần kết nối lại* như mọi lỗi xác thực khác.
  - Lý do khác thường là hộp thư đầy quota, hoặc không tìm thấy thư mục Sent. Thư mục lấy
    theo SPECIAL-USE (RFC 6154) trước; khóa nào máy chủ không khai báo thì lấy thư mục đầu
    tiên trong danh sách LIST có tên cuối cấp (tách theo dấu phân cách của máy chủ), không
    phân biệt hoa thường, là một tên quen thuộc: Sent / Sent Items / Sent Messages / Sent
    Mail (Sent), Trash / Deleted Items / Deleted Messages (Trash), Junk / Spam / Junk E-mail /
    Junk Email (Spam), Drafts, Archive. Nên `Sent`, `INBOX.Sent`, `Sent Items` được nhận dạng
    dù không có SPECIAL-USE. Chỉ khi không có thư mục nào khớp thì tên dự phòng là đúng chữ
    `SENT` (cũng vậy với `TRASH`, `SPAM`, `ARCHIVE`, `DRAFTS`), và Dovecot phân biệt hoa
    thường nên APPEND, sync Sent và chuyển thư vào Thùng rác/Spam/Lưu trữ cùng lỗi (ví dụ
    thư mục tên `Đã gửi`). Cách xử lý: bật SPECIAL-USE trên máy chủ, hoặc tạo thư mục tên
    đúng `SENT`. Nếu là quota thì giải phóng dung lượng trong webmail.

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
