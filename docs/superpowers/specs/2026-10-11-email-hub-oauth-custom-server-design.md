# Email Hub mở rộng: OAuth Google/Microsoft và máy chủ IMAP/SMTP tùy chỉnh

> **Trạng thái:** in-progress — spec đã duyệt (2026-10-11, quangpd). GĐ1 (UNI-1237) triển khai theo plan GĐ1, PR #220 vào `develop`. GĐ2 (máy chủ tùy chỉnh, UNI-1238) triển khai theo plan GĐ2 trên nhánh `feature/UNI-1238-email-hub-gd2-may-chu-imap-smtp-tuy-chin`, xếp chồng lên GĐ1. GĐ3 (OAuth) chưa bắt đầu.

**Module:** Email Hub (ADR 0022 — cache thư trong Postgres/S3).
**Issue:** cha UNI-1236; GĐ1 = UNI-1237, GĐ2 = UNI-1238; GĐ3 chưa có issue. Gộp vào đây UNI-1130, UNI-1132, UNI-1197, UNI-1202 vì cùng chạm `Connect` và tầng dial.

## 1. Mục tiêu

Người dùng kết nối được hộp thư mà không cần App Password, và kết nối được hộp thư
trên tên miền riêng:

1. **OAuth Google** (Gmail và Google Workspace) và **OAuth Microsoft** (Outlook.com và
   Microsoft 365) — đăng nhập ở nhà cung cấp, UniWork nhận refresh token.
2. **Máy chủ tùy chỉnh** — người dùng nhập IMAP/SMTP host, port, chế độ bảo mật và tên
   đăng nhập; TLS bắt buộc.
3. Mọi luồng hiện có (sync, IDLE, nhãn Gmail, di chuyển, tìm kiếm, gửi, hẹn giờ gửi) chạy
   như cũ trên cả ba kiểu xác thực.

**Tiêu chí thành công**

- Tài khoản Gmail/Workspace/M365/Outlook.com kết nối bằng OAuth, sync và gửi được.
- Tài khoản trên máy chủ Dovecot/cPanel kết nối bằng host do người dùng nhập; thư đã gửi
  nằm trong thư mục Sent trên máy chủ và xuất hiện đúng một lần trong luồng hội thoại.
- Host trỏ vào mạng nội bộ, loopback hay metadata bị từ chối ở thời điểm dial.
- Khi token bị thu hồi hoặc mật khẩu sai, thư đã cache **không mất**; người dùng thấy
  "Cần kết nối lại", kết nối lại giữ nguyên tài khoản và thư.

### 1.1 Hiện trạng (đối chiếu mã 2026-10-11)

- Chỉ có App Password. `emailhub.ProviderForEmail` (`server/internal/emailhub/provider.go:16-48`)
  khớp chính xác 7 tên miền (gmail, googlemail, outlook, hotmail, live, msn, yahoo); tên
  miền khác — kể cả Workspace/M365 — trả `ErrEmailHubUnsupported`.
- `Connect` (`service/email_hub.go:133`) verify IMAP rồi SMTP **trước**, sau đó mới kiểm tra
  trùng địa chỉ và trả `Invalid("this email is already connected")` → `400 invalid_request`.
- IMAP: go-imap v1.2.1, `client.DialTLS(addr, nil)` không có timeout dial
  (`imapclient/client.go:145`), xác thực bằng lệnh `LOGIN` (`:165`). Không có `AUTHENTICATE`.
- SMTP: dial TCP, STARTTLS **cơ hội** (`smtpclient/session.go:54`), PLAIN rồi LOGIN
  (`smtpclient/auth.go:16`); LOGIN được phép plaintext tới localhost (`auth.go:32`). Không
  có TLS ngầm định (465), không có XOAUTH2.
- Tên đăng nhập luôn là địa chỉ email: IMAP ở `service/email_hub_folders.go:31`, SMTP ở
  `authenticate(…, c.Email, c.Password)` (`smtpclient/send.go:38,60`). `send.go:66` là
  MAIL FROM, không phải đăng nhập.
- Mật khẩu seal AES-256-GCM (`util/secretbox`, khoá `EMAIL_HUB_CREDENTIAL_KEY`, nonce ngẫu
  nhiên) vào `email_hub_accounts.password_enc`.
- Không có bảo vệ SSRF nào trong `server/` (không có `IsPrivate`, dialer `Control`).
- `AUTHENTICATIONFAILED` (hoặc 3 lần NO trần) → `disconnectOnAuthFailure`
  (`service/email_hub_watcher.go:243`) ngắt kết nối **và xoá toàn bộ cache**; kết nối lại
  tạo account id mới. `cleanUpDisconnectedEmailHubAccount` (`email_hub.go:239`) chỉ chạy
  theo id ngay sau một lần ngắt; không có job nào quét dòng đã ngắt.
- Gửi: `sendOutboundMail` bọc lỗi SMTP bằng `fmt.Errorf("%w: %v", ErrEmailHubSendFailed, err)`
  (`email_hub.go:452`) — sentinel SMTP bị mất. Sau khi gửi, ghi một dòng Sent cục bộ với
  UID giả `now.Unix()` (`email_hub.go:455-465`); không APPEND lên máy chủ.
- Connect/Disconnect do người dùng gọi không ghi audit (UNI-1132). Không có unique index
  cho địa chỉ đang hoạt động (UNI-1202). Connect chỉ chịu limiter toàn cục (UNI-1197).
- Khuôn OAuth có sẵn: `service/calendar_connections.go` (Google + Microsoft, `x/oauth2`,
  state seal, refresh và ghi lại token). Callback được thiết kế để tin state, không gắn với
  trình duyệt; **và** route của nó nằm trong group `authed` (`router/router.go:127-151`,
  `router/calendar.go:36`) nên redirect từ nhà cung cấp — không có Bearer — nhận 401.
  Email Hub không theo tiền lệ đó (§5.1); sửa callback lịch là một issue riêng.

### 1.2 Quyết định đã chốt (2026-10-11)

| # | Quyết định | Lý do ngắn |
|---|---|---|
| Q1 | OAuth chạy **XOAUTH2 trên IMAP/SMTP**, không dùng Gmail API / Graph | Giữ nguyên mô hình sync UID/folder và cache ADR 0022 |
| Q2 | Mất xác thực → trạng thái **cần kết nối lại**, giữ cache, áp dụng cho mọi kiểu xác thực | Token bị thu hồi là chuyện thường (đổi mật khẩu, admin revoke); không được làm mất thư |
| Q3 | **OAuth client riêng** cho Email Hub, không dùng chung client đăng nhập / lịch | Scope Gmail là restricted (verification + CASA); không kéo client đăng nhập vào quy trình đó |
| Q4 | Máy chủ tùy chỉnh: host/port/bảo mật cho IMAP và SMTP, tên đăng nhập riêng, **một** mật khẩu, **TLS bắt buộc**, chặn SSRF lúc dial, APPEND vào Sent | Đủ cho cPanel/Dovecot/Zimbra; không mở đường plaintext |
| Q5 | Một spec, ba giai đoạn tuần tự, mỗi giai đoạn merge độc lập | OAuth và máy chủ riêng dùng chung nền tảng |
| Q6 | Kết nối lại cùng địa chỉ trong cùng tổ chức **dùng lại account id**, kể cả đổi App Password → OAuth; đổi máy chủ IMAP thì dùng lại id nhưng làm mới cache | Giữ thư đã sync khi máy chủ không đổi |
| Q7 | Popup như lịch; callback (ngoài group `authed`) trả HTML nhỏ `postMessage` + `close()` | Không cần trang web mới; lỗi hiện trong dialog |
| Q8 | Callback gắn trình duyệt bằng **PKCE S256 + nonce trong cookie HttpOnly** | Chống tráo tài khoản (gắn hộp thư nạn nhân vào tài khoản kẻ tấn công) |
| Q9 | Thiếu env của provider → ẩn nút provider đó; không thêm feature flag | Env đã là công tắc, như lịch |
| Q10 | Email Hub chỉ chạy trên web; desktop không xử lý deep link OAuth | Desktop chưa host Email Hub |

### 1.3 Ngoài phạm vi

- Gmail API / Microsoft Graph (sync hoặc gửi). Tenant M365 tắt SMTP AUTH nhận lỗi rõ
  `smtp_disabled`, không fallback.
- Tự dò cấu hình (autoconfig/ISPDB/MX).
- Tài khoản/mật khẩu SMTP tách khỏi IMAP.
- Plaintext IMAP/SMTP; STARTTLS cơ hội.
- Danh sách cho phép / chặn host theo tổ chức.
- Xoay vòng `EMAIL_HUB_CREDENTIAL_KEY` (secretbox chưa có key id — nợ đã biết).
- Thông báo (notification) khi tài khoản cần kết nối lại — chỉ hiển thị trong Email Hub.
- Sửa callback OAuth của lịch (nằm trong group `authed`) — issue riêng.

## 2. Mô hình dữ liệu

Ba migration, prefix `999<unix-ms>` tăng dần theo thứ tự dưới đây, mỗi file có `.down.sql`.

### 2.1 Migration `999<ms>_email_hub_accounts_auth`

`ALTER TABLE email_hub_accounts` (không FK; `organization_id` đã có). Down:
`DROP COLUMN` từng cột.

| Cột | Kiểu, mặc định | Ý nghĩa |
|---|---|---|
| `auth_kind` | `TEXT NOT NULL DEFAULT 'password'` | `password` \| `oauth_google` \| `oauth_microsoft` |
| `imap_security` | `TEXT NOT NULL DEFAULT 'tls'` | `tls` (TLS ngầm định) \| `starttls` (bắt buộc) |
| `smtp_security` | `TEXT NOT NULL DEFAULT 'starttls'` | như trên |
| `username` | `TEXT NOT NULL DEFAULT ''` | rỗng = dùng `email_address` |
| `oauth_refresh_token_enc` | `TEXT NOT NULL DEFAULT ''` | seal bằng box Email Hub, base64 |
| `oauth_access_token_enc` | `TEXT NOT NULL DEFAULT ''` | như trên |
| `oauth_access_expires_at` | `TIMESTAMPTZ NULL` | |
| `auth_failed_at` | `TIMESTAMPTZ NULL` | khác NULL = cần kết nối lại |
| `auth_failed_reason` | `TEXT NOT NULL DEFAULT ''` | `imap_auth_failed`, `imap_login_refused`, `smtp_auth_failed`, `oauth_invalid_grant` |
| `credential_version` | `BIGINT NOT NULL DEFAULT 0` | tăng mỗi khi credential bị thay (kết nối lại, ngắt kết nối); refresh token và claim sync **không** đổi cột này. Mọi lệnh ghi dựa trên một snapshot credential đều so cột này (§2.3) |

Dòng OAuth có `password_enc = ''` (cột vẫn `NOT NULL`, như dòng đã ngắt kết nối).
Giá trị mặc định khớp hành vi các preset hiện tại (IMAP 993 TLS, SMTP 587 STARTTLS);
preset nào cũng quảng bá STARTTLS nên chuyển từ "cơ hội" sang "bắt buộc" không làm hỏng
tài khoản đang chạy.

`provider`: OAuth Google ghi `gmail`, OAuth Microsoft ghi `outlook`, máy chủ tùy chỉnh ghi
`custom`. Hành vi Gmail (nhãn, MOVE) đã dựa vào capability `X-GM-EXT-1`, còn thư mục lấy
từ SPECIAL-USE (`imapclient/mailboxes.go:14-43`); `custom` rơi vào nhánh `default` của
`emailhub.MailboxName` (`folders.go:39`) khi LIST thất bại.

### 2.2 Unique index cho địa chỉ đang hoạt động (UNI-1202)

1. Migration dữ liệu `999<ms>_email_hub_accounts_dedupe`. Với mỗi bộ
   `(organization_id, user_id, lower(email_address))` có hơn một dòng
   `disconnected_at IS NULL`, giữ dòng có `created_at` sớm nhất; các dòng còn lại bị ngắt
   (`disconnected_at = now()`, `password_enc = ''`) trong một CTE `dup AS (UPDATE … RETURNING id, organization_id)`.
   Không có job nào dọn cache của dòng đã ngắt, nên **cùng migration** dọn luôn theo đúng
   thứ tự của `cleanUpDisconnectedEmailHubAccount`: `email_hub_scheduled_sends` của các id
   đó có `status IN ('pending','failed')` → `cancelled`; rồi `DELETE` `email_hub_attachments`,
   `email_hub_thread_ai_summaries`, `email_hub_threads` theo `(account_id, organization_id) IN dup`.
   Body đã đẩy lên object storage để lại cho GC file hiện có (như khi dọn qua `Disconnect`).
   Số dòng trùng rất nhỏ nên không lo khoá lâu. Down: `SELECT 1;` kèm comment (không
   khôi phục được).
2. Migration riêng, một câu lệnh:
   `CREATE UNIQUE INDEX CONCURRENTLY idx_email_hub_accounts_active_address ON email_hub_accounts (organization_id, user_id, lower(email_address)) WHERE disconnected_at IS NULL;`
   Down: `DROP INDEX CONCURRENTLY IF EXISTS idx_email_hub_accounts_active_address;`

Index này cũng phục vụ `ListEmailHubAccountsByUser` và tìm dòng để kết nối lại.

### 2.3 Truy vấn sqlc mới / đổi (`server/pkg/db/queries/email_hub.sql`)

Mọi truy vấn ràng buộc `organization_id` (hoặc mang dòng `-- tenant:` hợp lệ):

- `GetActiveEmailHubAccountByAddress(organization_id, user_id, email)` — so
  `lower(email_address) = lower(sqlc.arg('email'))` (để dùng index biểu thức), dòng
  `disconnected_at IS NULL` (gồm cả dòng đang `auth_failed`). `FOR UPDATE` khi gọi trong
  transaction kết nối lại.
- `CreateEmailHubAccount` — thêm các cột §2.1.
- `UpdateEmailHubAccountCredentials` — ghi đè host/port/security/username/auth_kind/
  provider/credential, xoá `auth_failed_at`/`auth_failed_reason`,
  `credential_version = credential_version + 1`; khi `imap_host`/`imap_port` đổi thì thêm
  `sync_state = '{}'` (§3). `:one` trả dòng cũ (token cũ cho revoke, §5.5).
- `UpdateEmailHubAccountOAuthTokens(id, organization_id, credential_version, prev_expires_at, access_enc, expires_at, refresh_enc)`
  `:execrows` — chỉ ghi khi `disconnected_at IS NULL AND auth_failed_at IS NULL AND credential_version = $v AND oauth_access_expires_at IS NOT DISTINCT FROM $prev_expires_at`;
  `refresh_enc` rỗng thì giữ giá trị cũ (`COALESCE(NULLIF(...), ...)`).
- `MarkEmailHubAccountAuthFailed(id, organization_id, credential_version, reason)` `:execrows`
  — đặt `auth_failed_at`, `auth_failed_reason`, xoá `password_enc` và hai cột token, chỉ khi
  `disconnected_at IS NULL AND auth_failed_at IS NULL AND credential_version = $v`.
- `DisconnectEmailHubAccount`, `DisconnectEmailHubAccountsForUser` — xoá thêm hai cột token,
  tăng `credential_version`, `RETURNING` refresh token cũ (cho revoke, §5.5).
- `ClaimEmailHubAccountsForSync` — thêm `AND auth_failed_at IS NULL`.

## 3. Vòng đời tài khoản

```
           connect / OAuth callback                 lỗi xác thực
 (none) ───────────────────────────► active ─────────────────────────► needs_reconnect
                                       ▲  │                                  │
                                       │  │ ngắt kết nối thủ công,           │ connect lại cùng địa chỉ
                                       │  │ rời tổ chức, xoá tài khoản       │ (cùng id)
                                       │  ▼                                  │
                                       │ disconnected (xoá cache) ◄──────────┤ ngắt kết nối thủ công
                                       └─────────────────────────────────────┘
```

**Lỗi xác thực** gồm: IMAP `NO [AUTHENTICATIONFAILED]`; 3 lần NO trần liên tiếp (giữ
ngưỡng `emailHubRefusedLoginsBeforeDisconnect`); SMTP `smtpclient.ErrAuthFailed` (535/534
trừ trường hợp SMTP AUTH bị tắt, §4.3); refresh trả `invalid_grant` hoặc
`unauthorized_client` (sau bước đọc lại ở §4.4). **Không** phải lỗi xác thực:
`ErrSMTPAuthDisabled` — không đổi trạng thái tài khoản, IMAP sync vẫn chạy, lần gửi hoặc
hẹn giờ gửi đến hạn kết thúc `failed` với lý do `smtp_disabled`.

`disconnectOnAuthFailure` đổi tên thành `markAuthFailed(ctx, acc, credentialVersion, reason)`
và, **trong một transaction**:

1. `MarkEmailHubAccountAuthFailed` với `credential_version` của snapshot mà thao tác thất
   bại đã dùng. `0` dòng (đã kết nối lại, đã ngắt, hoặc lỗi khác tới trước) → rollback:
   không audit, không outbox, không dừng watcher (watcher đang chạy thuộc credential mới).
2. Audit `email_hub_account.auth_failed`, actor `audit.System("email-hub")`, metadata `reason`.
3. Outbox `email_hub.inbox_changed` (đã có trong catalogue) để client làm mới danh sách
   tài khoản.

Sau commit: dừng watcher IDLE. **Không** gọi `cleanUpDisconnectedEmailHubAccount` —
threads, attachments, AI summaries được giữ.

Khi tài khoản ở `needs_reconnect` (kiểm tra **trước** khi dial):

- Worker sync bỏ qua (truy vấn claim ở §2.3). `runHubWatchLoop` thoát khi
  `acc.AuthFailedAt.Valid` (cạnh kiểm tra `DisconnectedAt`).
- `GET thread` **không bao giờ** trả 409: body đã cache trả như thường; body chưa cache thì
  bỏ qua dial và trả view không body. Mở thư vẫn ghi `is_read` vào DB nhưng không chạy
  `syncMarkReadOnIMAP`. Danh sách và attachment đã cache vẫn đọc được.
- Trả `409 email_hub_reauth_required`: `PATCH thread` (đọc/sao/nhãn), move, tìm IMAP, gửi,
  tải attachment chưa cache, `POST sync`, `POST watch` / inbox-watch (`SubscribeInboxWatch`
  không khởi động watcher).
- Hẹn giờ gửi đến hạn chuyển `failed` với lý do `auth_required`, không gửi trễ âm thầm.

**Lỗi tạm thời** (mạng, timeout, 5xx khi refresh, NO trần dưới ngưỡng) không đổi trạng thái;
ghi lỗi sync và thử lại như hiện nay.

**Kết nối lại**: `Connect` hoặc OAuth callback tìm `GetActiveEmailHubAccountByAddress`.

- Không có dòng → tạo mới.
- Dòng `active`, cùng `auth_kind`, cùng `imap_host`/`imap_port` → `409 email_hub_already_connected`.
  Đây là **hành vi mới**: hiện `Connect` dial trước rồi trả `400 invalid_request`; nay kiểm
  tra trước khi dial (§5.2 bước 3), cần case mới trong `handler/email_hub.go`, i18n và
  `connect-account-dialog.tsx`.
- Còn lại (dòng `needs_reconnect`, hoặc `active` nhưng khác kiểu xác thực / khác máy chủ —
  ví dụ nâng App Password → OAuth tại chỗ) → `UpdateEmailHubAccountCredentials` trên đúng id.
  - Cùng `imap_host`/`imap_port`: sync tiếp từ `sync_state` cũ (UIDVALIDITY khác → luồng sync
    hiện có tự đồng bộ lại), cache giữ nguyên.
  - Khác `imap_host` hoặc `imap_port` (ví dụ chuyển hosting): UIDVALIDITY chỉ có nghĩa trong
    một máy chủ, nên `sync_state` về rỗng và sau commit gọi
    `cleanUpDisconnectedEmailHubAccount` cho id đó (huỷ hẹn giờ gửi, xoá threads/attachments/
    summaries) trước khi sync ban đầu.
  - Sau commit: reset bộ đếm NO trần của governor cho id (`gov.loginSucceeded`), khởi động
    lại watcher, revoke token cũ nếu có (§5.5).

**Ngắt kết nối thủ công** giữ hành vi xoá cache hiện tại, xoá thêm hai cột token, tăng
`credential_version`, revoke best-effort (§5.5) và ghi audit `email_hub_account.disconnected`
với actor là người dùng (UNI-1132).

## 4. Tầng kết nối

### 4.1 `server/internal/emailhub/netguard` (mới)

- `Dial(ctx, network, addr) (net.Conn, error)` dùng `net.Dialer{Timeout: 15 * time.Second, Control: check}`.
- `check` chạy trên **IP thực tế** của từng lần thử kết nối (chống DNS rebinding):
  - IPv4 (kể cả dạng IPv4-mapped `::ffff:0:0/96`): từ chối 0/8, 10/8, 100.64/10, 127/8,
    169.254/16 (gồm 169.254.169.254), 172.16/12, 192.0.0/24, 192.0.2/24, 192.168/16,
    198.18/15, 198.51.100/24, 203.0.113/24, 224/4, 240/4, 255.255.255.255.
  - IPv6: **chỉ chấp nhận `2000::/3`**, trừ `2001::/32` (Teredo), `2001:db8::/32`,
    `2002::/16` (6to4). `64:ff9b::/96` và `64:ff9b:1::/48` (NAT64): tách IPv4 nhúng và kiểm
    theo bảng IPv4. Mọi thứ ngoài `2000::/3` (loopback, `::/96` IPv4-compatible, ULA,
    link-local, site-local `fec0::/10`, multicast, `100::/64`) bị từ chối.
- Chỉ cho phép port `993, 143, 465, 587, 25`.
- Lỗi trả `ErrHostNotAllowed`, **không** chứa host hay IP (lý do chi tiết chỉ ở log, §7).
- Áp dụng cho **mọi** tài khoản, kể cả preset. Biến guard không export, chỉ test của
  `netguard` thay; **không** có biến môi trường để tắt.

Đây là timeout dial của UNI-1130. go-imap v1 `client.New` chặn tới khi nhận greeting (và ở
chế độ `tls`, bắt tay TLS chạy bên trong nó), nên `cl.Timeout` không bao được giai đoạn đó:
`dial()` đặt `conn.SetDeadline(now + imapClientTimeout)` trên conn đưa vào `client.New`
(giống `client.DialWithDialerTLS`), xoá deadline khi đã có `cl`, rồi đặt `cl.Timeout` cho
STARTTLS và LOGIN/AUTHENTICATE. SMTP đặt deadline tương tự trên conn trước
`smtp.NewClient` (đọc greeting).

### 4.2 IMAP (`server/internal/emailhub/imapclient`)

`Credentials` thêm `Username`, `Security` (`tls`|`starttls`), `AccessToken`. Trong `dial()`
(điểm duy nhất mở kết nối — sync, IDLE, interactive, move, attachments đều qua đây), với
`cfg := &tls.Config{ServerName: host, MinVersion: tls.VersionTLS12, RootCAs: tlsRootCAs}`
(`tlsRootCAs` là biến package không export, `nil` ở production, chỉ test gán):

- `tls`: `netguard.Dial` → deadline → `tls.Client(conn, cfg)` → `client.New`.
- `starttls`: `netguard.Dial` → deadline → `client.New`; không có capability `STARTTLS` →
  `ErrTLSRequired`; có → `cl.StartTLS(cfg)` (`client.New` không biết tên máy chủ, nên `cfg`
  phải mang `ServerName`).
- Xác thực: `AccessToken != ""` → `cl.Execute(&commands.Authenticate{Mechanism: "XOAUTH2"}, &responses.Authenticate{Mechanism: xoauth2Client, ...})`
  để giữ `status.Code` (không dùng `client.Authenticate`, vì nó bỏ mã phản hồi). Ngược lại
  `LOGIN` như hiện nay với `Username` (rỗng → email).
- `xoauth2Client` (~15 dòng, implement `sasl.Client`): `Start` trả
  `user=<u>\x01auth=Bearer <token>\x01\x01`; `Next` trả response rỗng cho challenge lỗi
  (JSON base64 của Google/Microsoft) để server kết thúc bằng NO có tag.
- Phân loại lỗi giữ nguyên: `AUTHENTICATIONFAILED` → `ErrAuthFailed`, NO trần →
  `ErrLoginRefused`; `[ALERT]` vẫn là máy chủ bận (không đổi, `client.go:161-164`).

### 4.3 SMTP (`server/internal/emailhub/smtpclient`)

`Credentials` thêm `Username`, `Security`, `AccessToken`. `openSession`, cùng `cfg` như IMAP
(biến `tlsRootCAs` riêng của package):

- `tls` (thường 465): `netguard.Dial` → deadline → `tls.Client` → `smtp.NewClient`.
- `starttls`: `netguard.Dial` → deadline → `smtp.NewClient`; không có extension
  `STARTTLS` → `ErrTLSRequired`; có → `StartTLS(cfg)`. Bỏ nhánh "cơ hội".
- Xác thực: `AccessToken != ""` → `xoauth2Auth` (implement `smtp.Auth`; `Next` trả rỗng
  khi `more`); ngược lại PLAIN rồi LOGIN như hiện nay.
- `Username` (rỗng → email) **chỉ** thay tham số đăng nhập của `authenticate`
  (`send.go:38,60`); MAIL FROM (`send.go:66`), header From (`buildRaw`, `send.go:58`) và
  `newMessageID` vẫn dùng `email_address`.
- Bỏ ngoại lệ plaintext tới localhost trong `auth.go`.
- Phân loại: phản hồi chứa `SmtpClientAuthentication is disabled` (M365 `535 5.7.139`) →
  `ErrSMTPAuthDisabled`; mọi 535/534 khác → `ErrAuthFailed`. Không khớp riêng mã 5.7.139,
  vì M365 cũng dùng mã đó cho sai credential thật.

### 4.4 Một seam credential trong service

`func (s *EmailHubService) credentials(ctx context.Context, acc db.EmailHubAccount) (accountCreds, error)`
— `accountCreds` gói `imapclient.Credentials`, `smtpclient.Credentials` và
`CredentialVersion` — thay `accountCredentials` (`email_hub_folders.go:26`) và đoạn
`openPassword` trong `sendOutboundMail` (`email_hub.go:441-446`).

- `auth_failed_at` khác NULL → `ErrEmailHubReauthRequired`.
- `password`: mở `password_enc` như hiện nay.
- `oauth_*`: access token còn hạn hơn 2 phút → dùng. Ngược lại:
  1. Lấy mutex theo account id (`sync.Map` của `*sync.Mutex` — chặn refresh trùng trong một
     process; cửa sổ hai pod xem §10).
  2. **Đọc lại dòng** bằng `GetEmailHubAccount` (không dùng snapshot); token đã được làm mới
     → dùng luôn.
  3. `TokenSource(ctx, &oauth2.Token{RefreshToken: ...}).Token()`.
  4. Seal, ghi `UpdateEmailHubAccountOAuthTokens` với `credential_version` và
     `prev_expires_at` của lần đọc ở bước 2 (lưu refresh token mới nếu Microsoft xoay vòng).
     `0` dòng → pod khác đã làm mới hoặc credential đã đổi / tài khoản đã ngắt: bỏ token vừa
     nhận (Google: revoke best-effort), không log nó, đọc lại dòng; còn active và có token
     mới → dùng, ngược lại `ErrEmailHubReauthRequired`.
  5. `*oauth2.RetrieveError` với `ErrorCode` `invalid_grant`/`unauthorized_client` → đọc
     lại dòng; refresh token hoặc `oauth_access_expires_at` đã khác lần đọc ở bước 2 → dùng
     token mới, **không** đánh hỏng; không đổi → `markAuthFailed(credential_version, oauth_invalid_grant)`
     và trả `ErrEmailHubReauthRequired`. Lỗi khác → lỗi tạm thời.
- Refresh chạy **trước** khi lấy slot IMAP của governor để không giữ slot khi chờ mạng.

**Phân loại lỗi xác thực ở mọi đường**, ngay tại chỗ nhận lỗi từ `imapclient`/`smtpclient`,
**trước** mọi lần bọc bằng `%v`: full `syncAccount` (`email_hub_sync.go:143`), body, tìm
kiếm IMAP, backfill, attachments, move, gửi, hẹn giờ gửi. Riêng gửi: ngay sau
`smtpclient.Send` trong `sendOutboundMail` — `ErrAuthFailed` → `markAuthFailed(smtp_auth_failed)`
rồi trả `ErrEmailHubReauthRequired` **không bọc**; `ErrSMTPAuthDisabled` → trả
`ErrEmailHubSMTPDisabled` không bọc. `deliverScheduledSend` dùng `errors.Is` để chọn lý do
`auth_required` / `smtp_disabled`; handler map `ErrEmailHubReauthRequired` → 409
`email_hub_reauth_required`, `ErrEmailHubSMTPDisabled` → 400 `email_hub_smtp_disabled`.
Mọi lần gọi `markAuthFailed` truyền `CredentialVersion` của snapshot thao tác đó đã dùng.

**Seam cho test service:** `EmailHubService` thêm trường
`testHookVerify func(ctx context.Context, imap imapclient.Credentials, smtp smtpclient.Credentials) error`
(cùng kiểu `testHookScheduledSend`, `email_hub.go:49-51`; chỉ test đặt). `nil` → gọi
`imapclient.VerifyLogin` rồi `smtpclient.VerifyLogin`.

### 4.5 APPEND vào Sent và hợp nhất dòng Sent cục bộ

- Sau khi SMTP gửi thành công và `provider = 'custom'`: mở session IMAP qua governor, tìm
  thư mục SPECIAL-USE `\Sent` (fallback `emailhub.MailboxName("custom", Sent)`), `APPEND`
  bản MIME đã gửi với cờ `\Seen`. Lỗi APPEND chỉ ghi log (account id, mã lỗi) — không làm
  lần gửi thất bại, không thử lại. Nếu máy chủ có UIDPLUS, `APPENDUID` cập nhật ngay
  `imap_uid` của dòng cục bộ. Gmail và M365 tự lưu thư đã gửi nên không APPEND.
- APPEND là bắt buộc với `custom`: không có bản trên máy chủ thì dòng cục bộ (UID giả) bị
  `pruneReconciledFolderCache` xoá ở lần làm mới đầu tiên.
- **Hợp nhất (mọi provider):** khi sync thư mục Sent gặp thư có `message_id` trùng một dòng
  Sent khác `imap_uid` của cùng account, cập nhật `imap_uid` của dòng cục bộ sang UID thật
  (giữ id, body cache, tóm tắt AI) thay vì chèn dòng mới. Gmail/M365 hiện cũng bị hiện hai
  bản vì tự lưu Sent; thay đổi này sửa luôn.

## 5. API và luồng OAuth

### 5.1 Route

SDI/SDO mới trong `dto/sdi/email_hub.go` và `dto/sdo/email_hub.go` có `description`/`example`.

| Method, path | Auth | SDI / SDO |
|---|---|---|
| `GET /api/v1/workspaces/{workspaceID}/email-hub/providers` | có | SDO `EmailHubProvidersSDO{google, microsoft bool}` |
| `POST /api/v1/workspaces/{workspaceID}/email-hub/accounts` | có | SDI mở rộng (§5.2); SDO `EmailHubAccountSDO` |
| `POST /api/v1/workspaces/{workspaceID}/email-hub/oauth/{provider}/start` | có | SDI `{login_hint?}`; SDO `{authorization_url}` |
| `GET /api/v1/email-hub-connections/{provider}/callback` | không | HTML (§5.4) |

Ba route đầu đăng ký trong `registerEmailHub` (group `authed`). **Callback đăng ký ngoài
group `authed`**: thêm `registerEmailHubCallback(v1 api, h Routes, credentialLimit func(http.Handler) http.Handler)`
trong `router/email_hub.go`, gọi từ `root.Route("/api/v1")` cạnh `registerAuth(v1, h, credentialLimit)`
(`router/router.go`), với `v1.With(credentialLimit).Get("/email-hub-connections/{provider}/callback", h.CompleteEmailHubOAuth, apiOp{...})`,
giống `/auth/google/callback` (`router/auth.go:83`). Test gọi callback qua router đầy đủ,
không có `Authorization`, và khẳng định không phải 401.

`EmailHubAccountSDO` thêm `auth_kind`, `needs_reconnect` (bool từ `auth_failed_at`),
`auth_failed_reason`, `imap_host`, `imap_port`, `imap_security`, `smtp_host`, `smtp_port`,
`smtp_security`, `username` (để mở lại form khi kết nối lại; không bao giờ trả mật khẩu
hay token).

`{provider}` ∈ `google`|`microsoft`; đã có case `pathParamSDI` của lịch
(`router/openapi.go:132,142`) — sửa mô tả cho trung tính.

**Isolation:** ba route đầu nằm dưới `/workspaces/{workspaceID}` nên `TestIsolationMatrix`
bao phủ khi đăng ký. `providers` không chỉ đọc env: handler gọi
`EmailHubService.Providers(ctx, userID, workspaceID)`, hàm này `workspace.RequireMember`
trước rồi mới trả cờ §5.6 (không gate thì owner B và người ẩn danh nhận 200, matrix fail).
`start` thêm vào `isoRoutes` với `skipControl: "no OAuth client is configured in tests; the owner gets 404"`.
Callback phân loại `isoPublic` với `reasonProvider` (tiền lệ `isolation_routes_test.go:197`).
Không có trường body nào kết thúc bằng `_id`.

**Rate limit (UNI-1197):** `RateLimitPerRoute` theo `bearerUser` cho `POST accounts` và
`POST oauth/{provider}/start`: 10 lần / 10 phút / người dùng. Callback nằm dưới
`credentialLimit`.

### 5.2 Kết nối bằng mật khẩu / máy chủ tùy chỉnh

`ConnectEmailHubAccountSDI`:
`email_address` (bắt buộc), `app_password` (8–128, đổi mô tả thành "mật khẩu hoặc mật khẩu
ứng dụng"), và tuỳ chọn `imap_host`, `imap_port`, `imap_security`, `smtp_host`,
`smtp_port`, `smtp_security`, `username` (≤ 320).

- Không có `imap_host` → preset theo domain như hiện nay; domain lạ →
  `400 email_hub_unsupported` (giữ `TestEmailHubConnectValidation`).
- Có `imap_host` → phải có đủ sáu trường máy chủ (`username` tuỳ chọn). Host: hostname
  hợp lệ hoặc IP literal, ≤ 253 ký tự, không có scheme/path. Port ∈ tập ở §4.1. Security ∈
  `tls`|`starttls`. `provider = 'custom'`.

**Thứ tự trong `Connect`** (giữ isolation và tránh dial vô ích):

1. `workspace.RequireMember` (403/404 trước mọi thứ khác).
2. Validate trường. IP literal thuộc dải cấm (§4.1) → `email_hub_host_not_allowed` ngay
   tại đây.
3. `GetActiveEmailHubAccountByAddress` → quyết định tạo mới / kết nối lại / 409 (§3).
4. Verify IMAP rồi SMTP qua netguard (`testHookVerify` trong test).
5. Transaction: đọc lại dòng `FOR UPDATE` (nếu kết nối lại), seal, insert hoặc
   `UpdateEmailHubAccountCredentials`, audit `email_hub_account.connected` (metadata
   `auth_kind`, `provider`, `reconnected`, `server_changed`). Hai request đồng thời đều qua
   bước 3 → index §2.2 làm insert thứ hai lỗi unique → `409 email_hub_already_connected`.
6. Sau commit: dọn cache nếu đổi máy chủ (§3), revoke token cũ (§5.5), sync ban đầu, khởi
   động watcher.

Mã lỗi ổn định cho client:

| Mã | HTTP | Khi nào |
|---|---|---|
| `email_hub_unsupported` | 400 | domain lạ, không có host (giữ nguyên) |
| `email_hub_invalid_server` | 400 | trường máy chủ thiếu/sai định dạng |
| `email_hub_host_not_allowed` | 400 | IP literal thuộc dải cấm (bước 2) |
| `email_hub_unreachable` | 400 | DNS/kết nối/timeout/chứng chỉ, **và** hostname mà netguard chặn lúc dial — cố ý gộp để không thành oracle dò tên DNS nội bộ |
| `email_hub_tls_required` | 400 | máy chủ không hỗ trợ chế độ TLS đã chọn |
| `email_hub_connect_failed` | 400 | sai mật khẩu (giữ nguyên) |
| `email_hub_smtp_disabled` | 400 | M365 tắt SMTP AUTH |
| `email_hub_already_connected` | 409 | §3 (mới) |
| `email_hub_reauth_required` | 409 | §3 (mới) |

### 5.3 OAuth start

1. `RequireMember`; provider phải được bật (§5.6) → không thì `404`.
2. Sinh `verifier := oauth2.GenerateVerifier()` và `nonce` 32 byte ngẫu nhiên.
3. State = seal (box Email Hub) của JSON
   `{user_id, organization_id, workspace_id, provider, nonce, verifier, exp}` với `exp = now + 10 phút`.
4. Đặt cookie `uniwork_email_oauth = nonce`: `HttpOnly`, `SameSite=Lax`,
   `Path=/api/v1/email-hub-connections/`, `Max-Age=600`, `Secure` theo
   `config.SecureCookies`. Fetch của client đã dùng `credentials: "include"`
   (`packages/core/api/http.ts:198`) nên cookie được lưu; redirect từ nhà cung cấp về
   callback là điều hướng top-level GET nên `SameSite=Lax` vẫn gửi cookie.
5. Trả `AuthCodeURL(state, oauth2.AccessTypeOffline, oauth2.S256ChallengeOption(verifier), prompt, login_hint)`
   — `prompt=consent` (Google) / `prompt=select_account` (Microsoft).

### 5.4 OAuth callback

1. Mở state; hỏng hoặc hết hạn → `state_invalid`.
2. Cookie `uniwork_email_oauth` phải bằng `state.nonce` (so sánh constant-time) → không thì
   `state_invalid`. Xoá cookie ở mọi nhánh.
3. `error=access_denied` → `denied`.
4. `Exchange(code, oauth2.VerifierOption(state.verifier))`.
5. Lấy địa chỉ từ `id_token` trong phản hồi token (không gọi thêm API):
   Google — claim `email` với `email_verified = true`; Microsoft — `email`, nếu trống thì
   `preferred_username`. Chữ ký `id_token` không cần kiểm tra lại vì nó đến trực tiếp từ
   token endpoint qua TLS (OIDC Core §3.1.3.7). Thiếu email → `email_unavailable`. Claim
   email của Microsoft không được tin một mình: bước 7 đăng nhập IMAP bằng XOAUTH2 với
   `user=<địa chỉ>` và chính token đó — Exchange/Gmail từ chối nếu địa chỉ không thuộc chủ
   token, nên địa chỉ được ghi là địa chỉ máy chủ đã chấp nhận.
6. `RequireMember` lại với user/workspace trong state (thành viên có thể đã bị vô hiệu hoá).
7. Verify IMAP bằng token vừa cấp: NO khi AUTHENTICATE (`ErrAuthFailed` hoặc
   `ErrLoginRefused`) → `imap_not_enabled` (token mới tinh, nên bị từ chối nghĩa là giao thức
   bị tắt cho hộp thư — M365 trả NO trần). Rồi verify SMTP: `ErrSMTPAuthDisabled` →
   `smtp_disabled`, lỗi khác → `failed`. Bước nào lỗi thì không ghi dòng nào.
8. Bước 3, 5, 6 của `Connect` với `auth_kind = oauth_<provider>`, preset của provider.
   Phản hồi token không có refresh token → `consent_required` (đã đặt `prompt=consent` và
   `access_type=offline` nên hiếm). Không giữ refresh token cũ: dòng `needs_reconnect` đã
   bị xoá token, dòng active cùng kiểu nhận 409, dòng khác kiểu không có token dùng được
   cho nhà cung cấp mới.

Phản hồi luôn là trang HTML với header `Cache-Control: no-store` và
`Content-Security-Policy: default-src 'none'; script-src 'sha256-<hash>'`. Script là **hằng
số**; `FRONTEND_ORIGIN` và kết quả nằm trong khối dữ liệu không thực thi, nên hash tính một
lần lúc khởi động và giống nhau cho mọi `code`:

```html
<script type="application/json" id="r">{"origin":"<FRONTEND_ORIGIN>","ok":true,"code":"connected"}</script>
<script>
  const r = JSON.parse(document.getElementById("r").textContent);
  window.opener?.postMessage({ type: "uniwork:email-hub-oauth", ok: r.ok, code: r.code }, r.origin);
  window.close();
</script>
```

Khối JSON được encode an toàn cho HTML (`<` → `<`). `code` ∈ `connected`, `denied`,
`state_invalid`, `email_unavailable`, `imap_not_enabled`, `smtp_disabled`,
`already_connected`, `consent_required`, `failed`. Không có văn bản thô, không có email.

### 5.5 Thu hồi token

Revoke best-effort sau commit (timeout 5 giây, lỗi chỉ ghi log) ở **mọi** nơi refresh token
rời khỏi dòng: ngắt kết nối thủ công; `DisconnectEmailHubAccountsForUser` (rời tổ chức, xoá
tài khoản — gom vào `cleanUpEmailHubAccountsAfterCommit`); `UpdateEmailHubAccountCredentials`
khi token cũ khác token mới; và token vừa nhận nhưng không ghi được (§4.4 bước 4). Token cũ
lấy từ `RETURNING` / `:one` của chính câu lệnh xoá nó.

- Google: `POST https://oauth2.googleapis.com/revoke` với refresh token.
- Microsoft: không có endpoint thu hồi refresh token cho ứng dụng — chỉ xoá phía mình.

### 5.6 Cấu hình

Biến môi trường mới (thêm vào `.env.example`, đọc trong `server/internal/config/config.go`):

| Biến | Ghi chú |
|---|---|
| `EMAIL_HUB_GOOGLE_CLIENT_ID`, `EMAIL_HUB_GOOGLE_CLIENT_SECRET` | Cả hai có → Google bật |
| `EMAIL_HUB_MICROSOFT_CLIENT_ID`, `EMAIL_HUB_MICROSOFT_CLIENT_SECRET` | Cả hai có → Microsoft bật |
| `EMAIL_HUB_MICROSOFT_TENANT` | Mặc định `common` |

Redirect: `config.EmailHubRedirectURL(provider)` =
`API_PUBLIC_URL/api/v1/email-hub-connections/{provider}/callback`. OAuth chỉ bật khi
`EMAIL_HUB_CREDENTIAL_KEY` cũng có (box Email Hub seal cả token và state).

Scope:

- Google: `openid email https://mail.google.com/`.
- Microsoft: `openid email offline_access https://outlook.office.com/IMAP.AccessAsUser.All https://outlook.office.com/SMTP.Send`.

## 6. Client

### 6.1 `packages/core`

- `packages/core/types/email-hub.ts` — `EmailHubAccountSchema` thêm trường lenient:
  `auth_kind: z.string().default("password")`, `needs_reconnect: z.boolean().default(false)`,
  `auth_failed_reason`, các trường máy chủ (`.optional()`). Type xuất ra thu hẹp `auth_kind`;
  mọi `switch` có `default`.
- `packages/core/api/endpoints/email-hub.ts` — `getEmailHubProviders(wsId)`,
  `startEmailHubOAuth(wsId, provider, loginHint?)`; `connectEmailHubAccount` nhận thêm
  trường máy chủ. Mỗi hàm qua `parseWithFallback` và có case malformed-response trong
  `email-hub.test.ts` (kể cả `connectEmailHubAccount`, hiện chưa có).
- `packages/core/email-hub/hooks.ts` — `useEmailHubProviders(wsId)` (key
  `emailHubKeys.providers(wsId)`), `useStartEmailHubOAuth(wsId)`.
- `packages/core/email-hub/hooks-sync.ts` — `useEmailHubLiveSync` nhận `enabled=false` khi
  tài khoản đang chọn `needs_reconnect` (không heartbeat, không poll); 409
  `email_hub_reauth_required` invalidate `emailHubKeys.accounts(wsId)` một lần thay vì `catch {}`.

### 6.2 `packages/views`

- `packages/views/integrations/use-oauth-popup.ts` (mới) — tách từ
  `calendar-connections-dialog.tsx:68-96`: mở `about:blank` đồng bộ (tránh popup blocker),
  `await` URL, gán `location`; nghe `message`, chỉ nhận khi `event.origin` bằng origin API
  từ runtime config và `data.type` khớp; fallback theo dõi `popup.closed`. Lịch chuyển sang
  dùng helper này (knip: hai nơi dùng).
- `connect-account-dialog.tsx` — hai bước:
  - **Chọn cách kết nối:** *Google*, *Microsoft* (chỉ khi `useEmailHubProviders` bật),
    *Tên miền riêng (IMAP/SMTP)*; link phụ *Dùng mật khẩu ứng dụng* giữ form hiện tại
    (preset) và hướng dẫn `connect-app-password-guide-dialog.tsx`.
  - **Kết quả OAuth:** `code` → thông báo bằng `t()`; `connected` → đóng dialog, invalidate.
  - `connectError` thêm case cho mọi mã ở bảng §5.2 (`email_hub_already_connected` gắn vào
    trường email).
- `connect-custom-server-form.tsx` (mới) — email, tên đăng nhập (placeholder = email), mật
  khẩu, IMAP host/port/bảo mật, SMTP host/port/bảo mật. Chọn bảo mật tự điền port
  (TLS 993/465, STARTTLS 143/587) nếu port chưa bị sửa tay. Lỗi server map vào trường
  (`aria-invalid` + `aria-describedby`). Primitive từ `packages/ui`.
- `email-hub-account-menu.tsx` — badge cảnh báo trên tài khoản `needs_reconnect`, mục
  *Kết nối lại*. `use-email-hub-account-panel.ts` thêm `onReconnect(accountId)`: theo
  `auth_kind` — OAuth → popup với `login_hint`; mật khẩu/máy chủ → mở form đã điền sẵn
  (trừ mật khẩu).
- `email-hub-view-list-panel.tsx` — tài khoản đang chọn `needs_reconnect` → banner `Alert`
  (`packages/ui/components/ui/alert.tsx`, icon `CircleAlert`, copy qua `t()`) trên đầu danh
  sách với nút *Kết nối lại*; danh sách cache vẫn hiển thị bên dưới. Danh sách trống thì
  `EmailHubEmptyState` hiện có vẫn hiện dưới banner. Không dùng `CollectionPageState` cho
  trạng thái này.
- Settings → Integrations — bỏ mục planned `mail_oauth`, cập nhật
  `settings.integrations.email_hub.meta`.

### 6.3 i18n

Key mới trong cả `en.json` và `vi.json` dưới `email_hub.connect.*`
(`method_google`, `method_microsoft`, `method_custom`, `method_app_password`,
`custom.*` cho nhãn trường, `security_tls`, `security_starttls`, `errors.*` cho mọi mã ở
bảng §5.2 và mọi `code` ở §5.4) và `email_hub.reconnect.*` (banner, badge, menu). Theo
glossary và voice guide trong `docs/conventions.md`. Viết lại copy đang giả định App
Password (`email_hub.connect.*` hiện tại).

## 7. Audit, sự kiện, bảo mật, log

- Action mới trong `server/internal/audit/actions.go`: `email_hub_account.connected`,
  `email_hub_account.auth_failed`. `email_hub_account.disconnected` giờ có thêm actor người
  dùng. Mỗi lệnh có dòng trong `server/internal/service/audit_coverage_test.go`.
- Không thêm topic outbox; dùng `email_hub.inbox_changed` sẵn có (ids only).
- Log: không log email (`scripts/no-pii-log.test.mjs` bắt key `email`). Lỗi kết nối được
  log bằng mã đã phân loại (`host_not_allowed`, `tls_required`, `unreachable`, `auth_failed`,
  `smtp_disabled`) cùng `account_id`/`user_id`/`provider`; **không** log `err` thô từ tầng
  dial/DNS hay phản hồi IMAP/SMTP (chứa host người dùng nhập, có thể lặp lại tên đăng
  nhập). Test no-pii-log không kiểm điều này — reviewer giữ bằng tay, có một test Go ở §8.
- Client secret không bao giờ tới trình duyệt; token không bao giờ ra khỏi server.
- Cookie nonce + PKCE chặn tráo tài khoản; state seal chặn giả mạo; `exp` 10 phút chặn
  phát lại; `credential_version` chặn ghi đè từ snapshot cũ.

## 8. Kiểm thử

Viết test thất bại trước rồi mới viết mã.

**Go — tầng kết nối**

- `netguard`: bảng IP cho từng dải ở §4.1 (IPv4, IPv4-mapped, `::/96`, NAT64 cả hai prefix,
  6to4, Teredo, `fec0::/10`, `2000::/3` công khai được phép), port ngoài tập, hostname phân
  giải ra IP cấm, `ErrHostNotAllowed` không chứa IP/host.
- `imapclient`: mở rộng fake IMAP (`fake_server_test.go`) với chế độ TLS (`tls.Listen`,
  chứng chỉ tự ký cho 127.0.0.1) và lệnh `STARTTLS` (OK rồi `tls.Server`, quảng bá qua
  `caps`); bỏ `dialIMAP = client.Dial`, test gán `tlsRootCAs` và guard; chuyển các test
  session/sync hiện có sang chế độ TLS. Case: `starttls` thiếu capability →
  `ErrTLSRequired`; XOAUTH2 thành công; XOAUTH2 `NO [AUTHENTICATIONFAILED]` →
  `ErrAuthFailed`; NO trần → `ErrLoginRefused`; `Username` khác email; server nhận TCP
  nhưng không gửi greeting → lỗi trong `imapClientTimeout`.
- `smtpclient`: fake SMTP mới (EHLO, STARTTLS, TLS ngầm định, AUTH PLAIN/LOGIN/XOAUTH2, 535
  theo kịch bản). Case: TLS ngầm định; `starttls` thiếu extension → `ErrTLSRequired`;
  XOAUTH2; `535 5.7.139 … SmtpClientAuthentication is disabled` → `ErrSMTPAuthDisabled`;
  535 thường → `ErrAuthFailed`; `Username` dùng cho AUTH, MAIL FROM vẫn là email; không có
  greeting → timeout. Test hiện dial `127.0.0.1:1` giữ nguyên.

**Go — service** (DB test, token server `httptest`, `testHookVerify`)

- Refresh khi gần hết hạn, ghi token mới; Microsoft xoay vòng refresh token được lưu; hai
  goroutine cùng refresh → một lần gọi token endpoint; hai instance service cùng DB cùng
  refresh → đúng một bên ghi, tài khoản không bao giờ vào `auth_failed`.
- `invalid_grant` → `auth_failed_at` đặt, credential xoá, **threads còn nguyên**, audit
  `auth_failed`; `invalid_grant` khi dòng đã có token mới kể từ lúc đọc → không đánh hỏng.
- Race: ngắt kết nối khi refresh đang chờ (token server chặn trên channel) → sau khi trả về,
  `oauth_refresh_token_enc = ''` và `disconnected_at` vẫn đặt; kết nối lại rồi
  `markAuthFailed` với version cũ → credential mới còn, không có audit `auth_failed`, watcher
  vẫn chạy; `invalid_grant` từ token cũ sau khi kết nối lại OAuth → tài khoản vẫn active.
- `needs_reconnect`: không được claim sync; `SubscribeInboxWatch` trả 409 và không khởi động
  watcher; watcher đang chạy thoát khi `auth_failed_at` đặt; `GetThread` trả body đã cache
  với 200 và không dial; hẹn giờ gửi đến hạn → `failed/auth_required`.
- Gửi: SMTP 535 → `needs_reconnect` + 409; hẹn giờ gửi → `failed/auth_required`;
  `ErrSMTPAuthDisabled` → `auth_failed_at` vẫn NULL, credential giữ, lần gửi `smtp_disabled`.
- Kết nối lại cùng địa chỉ → cùng id, `auth_failed_at` xoá, bộ đếm NO trần reset; App
  Password → OAuth tại chỗ; đổi `imap_host` → cùng id, cache bị dọn, `sync_state` rỗng.
- `Connect` thứ tự: non-member nhận 403/404 trước validate; trùng địa chỉ → 409 trước dial
  (`testHookVerify` không được gọi); hai `Connect` đồng thời → một thành công, một 409;
  host không phân giải được → `email_hub_unreachable` và hostname không có trong log.
- `Providers`: non-member nhận 403/404.
- APPEND/hợp nhất: gửi rồi sync Sent → hội thoại có đúng một bản.
- Migration dedupe: hai dòng active trùng → còn một, dòng kia ngắt, cache của nó bị xoá,
  hẹn giờ gửi bị huỷ.
- Callback: qua router không có `Authorization` → không phải 401; nonce cookie sai/thiếu,
  state hết hạn, state của user khác, `access_denied`, thiếu `email_verified`, không có
  refresh token → `consent_required`, IMAP NO → `imap_not_enabled`, SMTP disabled →
  `smtp_disabled`; mọi `code` cho cùng một hash script, header không có `unsafe-inline`.
- Revoke: token server ghi nhận revoke khi ngắt kết nối, rời tổ chức, kết nối lại OAuth →
  mật khẩu.
- `audit_coverage_test.go`, `isolation_routes_test.go`, `TestEveryQueryNamesItsTenant`,
  migration lint, `.env.example` test.

**TypeScript**

- Endpoint: malformed-response cho `getEmailHubProviders`, `startEmailHubOAuth`,
  `connectEmailHubAccount`; schema tài khoản với `auth_kind` lạ → không ném.
- `use-oauth-popup`: message sai origin hoặc sai `type` bị bỏ qua; popup đóng không có
  message → refetch.
- `useEmailHubLiveSync`: tài khoản `needs_reconnect` → không gọi subscribe/sync.
- Dialog: bước chọn ẩn provider tắt; form máy chủ riêng validate và tự điền port; lỗi
  server gắn vào trường.
- Menu tài khoản: badge và *Kết nối lại*; banner `Alert` trên danh sách.

**E2E:** không thêm — CI không có mail server hay OAuth provider thật. Thay bằng checklist
thủ công (§10).

Coverage chỉ tăng: nâng `server/coverage.floor` và ngưỡng vitest nếu đạt cao hơn.

## 9. Giai đoạn

Mỗi giai đoạn là một sub-issue, một nhánh `feature/UNI-nnn-…`, một PR; merge theo thứ tự.

| GĐ | Nội dung | Ra mắt người dùng |
|---|---|---|
| **GĐ1 — Nền tảng** | Ba migration §2 (cột, dedupe kèm dọn cache, unique index); truy vấn §2.3; `netguard` + deadline greeting; chế độ TLS IMAP/SMTP + `tlsRootCAs` + fake TLS/SMTP; `ErrSMTPAuthDisabled`; seam `credentials` (chưa có OAuth) + `testHookVerify`; `needs_reconnect` đầy đủ (§3, gồm watcher, `GetThread`, 409, hẹn giờ gửi); phân loại lỗi xác thực ở mọi đường; `Connect` kiểm tra trùng trước dial + 409; audit connect/disconnect/auth_failed; rate limit connect; log theo mã; hợp nhất dòng Sent theo `message_id`; SDO + `EmailHubAccountSchema` thêm `needs_reconnect`, `auth_kind`, `auth_failed_reason`; `hooks-sync.ts`; UI badge + banner + *Kết nối lại* cho App Password; `docs/ops/RUNBOOK_EMAIL_HUB.md` | Mất xác thực không còn xoá thư; thư đã gửi không còn hiện hai lần |
| **GĐ2 — Máy chủ tùy chỉnh** | SDI mở rộng, validate, mã lỗi §5.2, kết nối lại đổi máy chủ (dọn cache), APPEND vào Sent; SDO + schema thêm trường máy chủ và `username`; `connectEmailHubAccount` nhận trường máy chủ + case malformed; `connect-custom-server-form.tsx`; bước chọn (chỉ *Tên miền riêng* và *Mật khẩu ứng dụng*); *Kết nối lại* tài khoản `custom` mở form điền sẵn | Kết nối tên miền riêng |
| **GĐ3 — OAuth** | XOAUTH2 IMAP/SMTP; refresh + mutex + ghi có điều kiện; config/env; `providers`, start, callback (ngoài `authed`), revoke ở mọi đường; `use-oauth-popup` (lịch chuyển sang); nút Google/Microsoft; *Kết nối lại* OAuth (`onReconnect` chọn popup theo `auth_kind`, kèm `login_hint`) | Gmail/Workspace/M365 không cần App Password |

## 10. Vận hành và rủi ro

- **Google verification + CASA** cho scope `https://mail.google.com/` mất vài tuần, đi song
  song với GĐ3, không chặn merge. Trước khi được duyệt, client ở chế độ *Testing*: tối đa
  100 người dùng thử, refresh token hết hạn sau 7 ngày (sẽ rơi vào `needs_reconnect`).
- **M365:** tenant tắt SMTP AUTH → `smtp_disabled` (cả lúc kết nối và lúc gửi, không đánh
  hỏng tài khoản); tenant yêu cầu admin consent → `denied` kèm hướng dẫn trong copy.
- **Microsoft app registration:** loại tài khoản "Accounts in any organizational directory
  and personal Microsoft accounts", redirect URI web, quyền delegated của Office 365
  Exchange Online `IMAP.AccessAsUser.All`, `SMTP.Send`.
- **Một replica (ADR 0025):** mutex trong process chặn refresh trùng trong một pod; cửa sổ
  rolling update (ADR 0025 › Hệ quả: maxSurge 1) vẫn có hai pod chạy worker Email Hub, nên
  ghi token là chuyển trạng thái có điều kiện theo `credential_version` +
  `oauth_access_expires_at` đã đọc, và `invalid_grant` chỉ đánh hỏng khi dòng chưa bị pod
  khác cập nhật (§4.4). Cơ chế này vẫn đúng khi bỏ ràng buộc một replica; không sửa
  ADR 0025 (đã accepted) — worker mới không thêm, nên không cần thêm hàng vào bảng của nó.
- **Runbook:** `docs/ops/RUNBOOK_EMAIL_HUB.md` (cùng kiểu `RUNBOOK_OUTBOX.md`, có dòng
  `> **Trạng thái:**`), mục "Tài khoản Email Hub cần kết nối lại": truy vấn đếm
  `email_hub_accounts` theo `auth_failed_reason` WHERE `auth_failed_at IS NOT NULL`, ý nghĩa
  từng mã, cách xử lý (Google Testing mode hết hạn 7 ngày; M365
  `SmtpClientAuthenticationDisabled`; người dùng kết nối lại). Không đặt ở `docs/runbooks/`
  — thư mục đó chỉ dành cho runbook gắn alert (`scripts/alerts-runbooks.test.mjs`), và đợt
  này không thêm metric hay alert.
- **Checklist thủ công trước khi đóng GĐ3:** Gmail cá nhân, Google Workspace, Outlook.com,
  M365 (SMTP AUTH bật và tắt), một máy chủ cPanel/Dovecot qua 993+465 và 143+587; thu hồi
  quyền ở Google/Microsoft → tài khoản về `needs_reconnect`, thư còn; kết nối lại → cùng
  luồng thư; gửi từ tài khoản cPanel → thư nằm trong Sent trên máy chủ và hiện một lần.
