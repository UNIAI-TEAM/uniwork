# Runbook — Email Hub: xác thực hộp thư và kết nối lại

> **Trạng thái:** shipped · **Cập nhật:** 2026-10-11 · **Thành phần:** `EmailHubService` trong tiến trình API (`server/internal/service/email_hub*.go`), worker sync và watcher IDLE · **Liên quan:** ADR 0022, ADR 0025, spec `2026-10-11-email-hub-oauth-custom-server-design.md`, UNI-1237, UNI-1238, UNI-1239

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

## Cấu hình OAuth (Google, Microsoft)

Người dùng kết nối Gmail/Google Workspace hoặc Outlook.com/Microsoft 365 bằng cách đăng nhập
trong popup, không cần App Password. Server giữ refresh token (seal bằng box Email Hub) và
đăng nhập IMAP/SMTP bằng XOAUTH2 vào đúng các máy chủ preset (`imap.gmail.com`,
`outlook.office365.com`), kể cả trên tên miền riêng của Workspace/M365. Email Hub có
**OAuth client riêng**. Không dùng `GOOGLE_CLIENT_ID` (đăng nhập, lịch) hay
`MICROSOFT_CALENDAR_*`, vì scope Gmail là restricted và kéo theo verification + CASA.

### Biến môi trường

| Biến | Ý nghĩa |
| --- | --- |
| `EMAIL_HUB_GOOGLE_CLIENT_ID`, `EMAIL_HUB_GOOGLE_CLIENT_SECRET` | Client OAuth Google của Email Hub. Thiếu một trong hai thì nút Google bị ẩn |
| `EMAIL_HUB_MICROSOFT_CLIENT_ID`, `EMAIL_HUB_MICROSOFT_CLIENT_SECRET` | App Entra của Email Hub. Thiếu một trong hai thì nút Microsoft bị ẩn |
| `EMAIL_HUB_MICROSOFT_TENANT` | Mặc định `common`: tài khoản công việc/trường học lẫn tài khoản cá nhân (Outlook.com). `organizations` bỏ tài khoản cá nhân; một tenant id chỉ nhận một tổ chức |
| `EMAIL_HUB_CREDENTIAL_KEY` | Có từ GĐ1. Thiếu thì **cả hai** nút bị ẩn, vì box này seal cả token lẫn state OAuth |
| `API_PUBLIC_URL` | Gốc của redirect URI: `API_PUBLIC_URL/api/v1/email-hub-connections/google/callback` và `…/microsoft/callback` |
| `FRONTEND_ORIGIN` | Trang callback chỉ `postMessage` kết quả tới origin này |

Không có feature flag: env là công tắc, và đổi env phải khởi động lại server. Kiểm tra bằng
`GET /api/v1/workspaces/{workspaceID}/email-hub/providers`, kết quả là
`{"google":true,"microsoft":true}` khi bật cả hai. Desktop không có OAuth (chỉ web).

Gỡ env của một nhà cung cấp khi còn tài khoản OAuth của nó: tài khoản **không** chuyển
`needs_reconnect` (lỗi tạm thời `oauth_not_configured`), nhưng sync và gửi dừng khi access token
hiện có hết hạn (khoảng 1 giờ). Đặt lại env và khởi động lại thì tài khoản chạy tiếp, không cần
kết nối lại.

### Google Cloud

1. Dùng một project Google Cloud riêng cho Email Hub, không dùng project của client đăng nhập.
2. *Google Auth Platform* → *Audience*: chọn loại *External*. *Data access*: thêm `openid`,
   `email` và `https://mail.google.com/`.
3. *Clients* → *Create client* → *Web application*. *Authorized redirect URI* là
   `API_PUBLIC_URL/api/v1/email-hub-connections/google/callback`, đúng từng ký tự và không
   có `/` cuối. Sai URI thì popup dừng ở trang lỗi của Google
   `Error 400: redirect_uri_mismatch`, và callback không chạy.
4. Chép client id và secret vào `EMAIL_HUB_GOOGLE_CLIENT_ID` / `EMAIL_HUB_GOOGLE_CLIENT_SECRET`.

**Chế độ Testing.** Trước khi Google duyệt, client ở *Testing*:

- Tối đa 100 test user, khai báo ở *Audience* → *Test users*. Người ngoài danh sách bị Google
  chặn ngay trên trang đăng nhập (`Error 403: access_denied`) nên callback không chạy. Đóng
  popup thì dialog chỉ tải lại danh sách tài khoản và không báo lỗi.
- Test user thấy màn hình "Google hasn't verified this app" và phải bấm *Continue*.
- Refresh token hết hạn sau 7 ngày. Tài khoản rơi về `needs_reconnect` với lý do
  `oauth_invalid_grant`, thư đã cache còn nguyên. Đây không phải lỗi.

Verification cho scope restricted `https://mail.google.com/` cần thẩm định bảo mật CASA, làm
lại hằng năm. Việc này kéo dài vài tuần và chạy song song với GĐ3, không chặn merge. Sau khi
chuyển *In production*, refresh token mới không còn hạn 7 ngày. Tài khoản kết nối trong lúc
còn Testing có thể phải kết nối lại một lần nữa.

### Microsoft Entra

1. *Microsoft Entra admin center* → *App registrations* → *New registration*. *Supported
   account types*: "Accounts in any organizational directory and personal Microsoft accounts".
2. *Redirect URI*: nền tảng *Web*, `API_PUBLIC_URL/api/v1/email-hub-connections/microsoft/callback`.
   Sai URI thì popup dừng ở lỗi `AADSTS50011`.
3. *Certificates & secrets* → *New client secret*. Chép **Value** (không phải *Secret ID*) vào
   `EMAIL_HUB_MICROSOFT_CLIENT_SECRET`. Secret có hạn (tối đa 24 tháng), nên đặt lịch xoay
   vòng. Khi secret hết hạn:
   - Token endpoint trả `invalid_client`. Đó là lỗi tạm thời, nên tài khoản vẫn `active` và
     không chuyển `needs_reconnect`.
   - Sync và gửi dừng khi access token hiện có hết hạn (khoảng 1 giờ), và kết nối mới trả
     `failed`.
   - Tạo secret mới, đổi env, khởi động lại. Không cần người dùng kết nối lại.
4. *API permissions* → *Add a permission* → *APIs my organization uses* → *Office 365
   Exchange Online* → *Delegated*: `IMAP.AccessAsUser.All`, `SMTP.Send`. Thêm *Microsoft
   Graph* delegated: `openid`, `email`, `offline_access`.
5. Nên thêm *Token configuration* → *Add optional claim* → *ID* → `email`. Không có claim
   `email`, server lấy `preferred_username` (UPN), và UPN có thể khác địa chỉ SMTP chính
   (xem `email_unavailable` và *SendAsDenied* ở dưới).

Tenant M365 của khách hàng có thể chặn:

- **Bắt admin consent.** Người dùng thấy "Need admin approval". Kết quả là `denied` khi
  Microsoft trả `error=access_denied`, hoặc `failed` khi trả mã khác (`consent_required`,
  `interaction_required`). Quản trị viên tenant tự kết nối một lần và tích *Consent on behalf
  of your organization*, hoặc vào *Enterprise applications* → app → *Permissions* → *Grant
  admin consent*.
- **SMTP AUTH bị tắt.** Kết quả là `smtp_disabled`, và không có dòng nào được ghi. Xử lý như
  mục *Gửi thất bại với `smtp_disabled`*.
- **IMAP bị tắt cho hộp thư.** Kết quả là `imap_not_enabled`. Xử lý bằng
  `Set-CASMailbox <user> -ImapEnabled $true`.

### Web và API phải cùng site

- **Cookie nonce.** Nonce chống tráo tài khoản nằm trong cookie `uniwork_email_oauth`
  (`HttpOnly`, `SameSite=Lax`, `Path=/api/v1/email-hub-connections/`, `Max-Age=600`).
  - API đặt cookie này trong phản hồi của
    `POST /api/v1/workspaces/{workspaceID}/email-hub/oauth/{provider}/start`, là một fetch có
    credential từ web.
  - Trình duyệt chặn cookie bên thứ ba (Safari, Firefox ETP, Chrome khi chặn third-party
    cookie) bỏ cookie đặt từ một fetch khác site.
  - Vì vậy web và API phải chung tên miền đăng ký, ví dụ `app.example.com` và
    `api.example.com`. `localhost:3000` và `localhost:8080` cũng dùng được.
  - Khác site thì **mọi** callback trả `state_invalid`.
- **Origin của tin nhắn.** Web chỉ nhận tin nhắn của popup từ origin của
  `NEXT_PUBLIC_API_URL`, trong khi trang callback chạy ở `API_PUBLIC_URL`.
  - Hai origin này phải giống nhau, và `FRONTEND_ORIGIN` phải đúng origin người dùng mở web.
  - Lệch một trong hai thì tin nhắn bị bỏ. Dialog chỉ biết popup đã đóng và tải lại danh
    sách tài khoản.
  - Kết nối thành công vẫn hiện tài khoản mới. Kết nối thất bại không báo lỗi gì, nên người
    dùng tưởng chưa có chuyện gì xảy ra.
- **CSP của trang callback.** Trang callback gửi
  `Content-Security-Policy: default-src 'none'; script-src 'sha256-…'; frame-ancestors 'none'; base-uri 'none'`
  và `Cache-Control: no-store`. Proxy chèn thêm CSP riêng cho `/api/v1/email-hub-connections/`
  có thể chặn script, khiến popup đứng ở trang trắng. Để nguyên header của API trên đường này.

### Hai pod cùng làm mới token

Access token còn hạn dưới 2 phút thì được làm mới, dưới một mutex theo account id trong
process. Bước làm mới chạy thế này:

1. Đọc lại dòng.
2. Gọi token endpoint.
3. Ghi `UpdateEmailHubAccountOAuthTokens`, có điều kiện theo `credential_version` và
   `oauth_access_expires_at` đã đọc ở bước 1.

Trong cửa sổ rolling update (ADR 0025, maxSurge 1), hai pod có thể cùng làm mới một tài
khoản:

- Chỉ một lệnh ghi thành công. Pod thua đọc lại dòng và dùng token của pod thắng.
- Pod thua **không** revoke token vừa nhận, vì revoke một token Google thu hồi cả grant, tức
  cả token của pod thắng.
- `invalid_grant` chỉ đánh hỏng tài khoản khi refresh token, `credential_version` và
  `oauth_access_expires_at` của dòng chưa đổi kể từ lần đọc. Microsoft xoay vòng refresh token,
  nên lần pod khác vừa xoay không làm tài khoản rơi về `needs_reconnect`.
- Làm mới token không tăng `credential_version`.
- Không cần làm gì khi deploy. Một đợt `oauth_invalid_grant` ngay sau deploy là nguyên nhân
  khác, không phải hai pod tranh nhau.

## Triệu chứng và cách xử lý

### Tài khoản Email Hub cần kết nối lại

Người dùng thấy badge và banner *Kết nối lại*, hoặc gặp `409 email_hub_reauth_required`.

1. Đếm theo lý do:

```sql
SELECT auth_kind, auth_failed_reason, provider, count(*), min(auth_failed_at), max(auth_failed_at)
FROM email_hub_accounts
WHERE auth_failed_at IS NOT NULL AND disconnected_at IS NULL
GROUP BY auth_kind, auth_failed_reason, provider
ORDER BY 4 DESC;
```

2. Đọc mã:

| `auth_failed_reason` | Nguồn | Nguyên nhân thường gặp | Xử lý |
| --- | --- | --- | --- |
| `imap_auth_failed` | IMAP `NO [AUTHENTICATIONFAILED]` | Người dùng đổi mật khẩu tài khoản hoặc thu hồi App Password; Google tắt App Password khi tắt 2FA. Với tài khoản OAuth (`auth_kind` `oauth_*`): access token vừa làm mới vẫn bị IMAP từ chối, thường do IMAP bị tắt cho hộp thư sau khi đã kết nối (M365: `Set-CASMailbox <user> -ImapEnabled $false`) | Người dùng bấm *Kết nối lại*: App Password thì nhập mật khẩu mới, OAuth thì đăng nhập lại trong popup. Refresh token Google của dòng được thu hồi (mục *Thu hồi token OAuth*) |
| `imap_login_refused` | 3 lần liên tiếp IMAP trả NO không kèm mã (`emailHubRefusedLoginsBeforeDisconnect`) | IMAP bị tắt trong cài đặt hộp thư; máy chủ chặn IP; mật khẩu sai với máy chủ không trả mã chuẩn | Bật IMAP trong cài đặt hộp thư rồi kết nối lại |
| `smtp_auth_failed` | SMTP 535/534 (không phải trường hợp SMTP AUTH bị tắt) | Mật khẩu SMTP khác mật khẩu IMAP, hoặc đã bị thu hồi | Kết nối lại |
| `oauth_invalid_grant` | Token endpoint trả `invalid_grant` hoặc `unauthorized_client` khi làm mới access token, và dòng **chưa** bị pod khác làm mới hay kết nối lại kể từ lúc đọc | Google client còn ở chế độ *Testing*: refresh token hết hạn sau 7 ngày (mục *Google Cloud*). Người dùng gỡ quyền ứng dụng ở tài khoản Google/Microsoft. Người dùng đổi mật khẩu Google: Google thu hồi token có scope Gmail. Quản trị viên Workspace/Entra thu hồi phiên. Refresh token Microsoft không được dùng quá 90 ngày | Người dùng bấm *Kết nối lại*, popup mở sẵn đúng tài khoản (`login_hint`). Grant đã chết nên server không revoke |

   Tài khoản Gmail trong chế độ *Testing* rơi về `needs_reconnect` theo đợt, 7 ngày sau lần kết
   nối. Nhìn theo ngày để phân biệt đợt này với một sự cố phía nhà cung cấp:

```sql
SELECT date_trunc('day', auth_failed_at) AS day, count(*)
FROM email_hub_accounts
WHERE auth_kind = 'oauth_google' AND auth_failed_reason = 'oauth_invalid_grant'
  AND disconnected_at IS NULL
GROUP BY 1 ORDER BY 1 DESC LIMIT 14;
```

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

### Kết nối Google / Microsoft thất bại (mã callback)

Luồng kết nối:

1. Dialog mở popup và gọi `POST …/email-hub/oauth/{provider}/start`. Lệnh này có hạn mức
   riêng 10 lần / 10 phút mỗi người (Google và Microsoft dùng chung), tách khỏi hạn mức của
   `POST …/email-hub/accounts`; quá hạn mức thì trả `429 rate_limited`.
2. Người dùng đăng nhập ở Google/Microsoft.
3. Nhà cung cấp chuyển về `GET /api/v1/email-hub-connections/{provider}/callback`. Route này
   nằm ngoài nhóm cần đăng nhập, dưới `credentialLimit` (60 lần/phút/IP).
4. Callback trả một trang HTML nhỏ. Trang `postMessage`
   `{type: "uniwork:email-hub-oauth", ok, code}` về `FRONTEND_ORIGIN` rồi tự đóng.
5. Dialog hiện kết quả theo `code`.

Popup bị trình duyệt chặn thì dialog báo lỗi ngay, không gọi start. Trang callback không chứa
email hay văn bản lỗi thô.

| `code` | Ý nghĩa | Xử lý |
| --- | --- | --- |
| `connected` | Đã kết nối mới, hoặc kết nối lại trên cùng account id. Một tài khoản App Password cùng địa chỉ chuyển sang OAuth và giữ id | Không |
| `denied` | Người dùng bấm *Hủy* ở trang nhà cung cấp, hoặc tenant M365 bắt admin consent (`error=access_denied`) | Thử lại; admin consent xem mục *Microsoft Entra* |
| `state_invalid` | Không có dòng nào được ghi. Các trường hợp: state hỏng hoặc quá 10 phút; provider trong state khác provider trên đường dẫn; cookie `uniwork_email_oauth` thiếu hoặc không khớp. Cookie thiếu khi popup chạy ở trình duyệt hay profile khác, trình duyệt chặn cookie, hoặc web và API khác site | Thử lại trong 10 phút trên cùng trình duyệt. Nếu **mọi** người đều gặp, kiểm tra mục *Web và API phải cùng site* |
| `email_unavailable` | `id_token` không cho địa chỉ dùng được. Google: claim `email` trống hoặc `email_verified=false`. Microsoft: cả `email` lẫn `preferred_username` trống | Google: dùng tài khoản có email đã xác minh. Microsoft: thêm optional claim `email` cho app |
| `imap_not_enabled` | Token mới nhưng IMAP từ chối `AUTHENTICATE XOAUTH2`, tức IMAP bị tắt cho hộp thư (M365 trả NO trần) | M365: `Set-CASMailbox <user> -ImapEnabled $true`. Workspace: quản trị viên bật IMAP cho người dùng |
| `smtp_disabled` | IMAP được, nhưng SMTP AUTH bị tắt cho hộp thư hoặc tenant | Như mục *Gửi thất bại với `smtp_disabled`*, rồi kết nối lại |
| `already_connected` | Địa chỉ đã có tài khoản `active` cùng `auth_kind` trong tổ chức. Không dòng nào đổi | Không phải lỗi |
| `consent_required` | Phản hồi token không có refresh token (hiếm, vì đã gửi `prompt=consent` và `access_type=offline`) | Người dùng gỡ quyền của app ở tài khoản Google rồi kết nối lại |
| `failed` | Mọi trường hợp còn lại, gồm: đổi code thất bại (code dùng lại, client secret sai hoặc hết hạn), `error=` khác `access_denied`, người dùng đã bị vô hiệu hoá hoặc rời workspace sau khi bấm nút, SMTP lỗi khác `smtp_disabled`, lỗi DB | Xem log `email hub oauth callback failed` theo `user_id` và `provider`; trường `reason` cho biết bước hỏng (`exchange_invalid_grant`, `exchange_invalid_client`, `membership`, `provider_error`, …) |

Mỗi kết quả khác `connected` có dòng log `email hub oauth callback failed` kèm `user_id`,
`provider`, `code` và `reason`. Log không bao giờ chứa email, token, `code` của nhà cung cấp,
state, nonce hay mô tả lỗi của nhà cung cấp.

Người dùng có thể chọn một tài khoản Google/Microsoft khác `login_hint` khi kết nối lại.
Callback kết nối, hoặc trả `already_connected` cho, đúng địa chỉ mà `id_token` và lần đăng
nhập XOAUTH2 chứng minh. Tài khoản cần kết nối lại ban đầu vẫn ở `needs_reconnect`.

Microsoft với UPN khác địa chỉ SMTP chính: IMAP XOAUTH2 có thể chấp nhận UPN, nên kết nối
thành công. Nhưng lệnh gửi bị Exchange từ chối (`SendAsDenied`), và API trả 502 chung. Xử lý
là thêm optional claim `email` cho app, rồi ngắt kết nối và kết nối lại. Địa chỉ đã lưu không
tự đổi.

Xem các lần kết nối OAuth của một tài khoản:

```sql
SELECT occurred_at,
       metadata::jsonb->>'auth_kind'      AS auth_kind,
       metadata::jsonb->>'provider'       AS provider,
       metadata::jsonb->>'reconnected'    AS reconnected,
       metadata::jsonb->>'server_changed' AS server_changed
FROM audit_events
WHERE action = 'email_hub_account.connected' AND resource_id = '<account_id>'
ORDER BY occurred_at DESC LIMIT 10;
```

### Thu hồi token OAuth

Chỉ Google có revoke: `POST https://oauth2.googleapis.com/revoke`. Microsoft không có endpoint
thu hồi refresh token cho ứng dụng, nên server chỉ xoá token phía mình. Người dùng gỡ quyền ở
trang tài khoản Microsoft nếu muốn.

Server revoke refresh token mà chính câu lệnh vừa xoá khỏi dòng, sau khi commit, ở các đường:

- ngắt kết nối thủ công;
- rời tổ chức và xoá tài khoản UniWork (`cleanUpEmailHubAccountsAfterCommit`);
- kết nối lại đổi kiểu đăng nhập khỏi oauth_google (sang App Password hoặc máy chủ tùy chỉnh).
  Kết nối lại oauth_google → oauth_google không revoke: cùng tài khoản Google, cùng grant,
  revoke sẽ giết token vừa lưu;
- tài khoản chuyển `needs_reconnect` với lý do khác `oauth_invalid_grant`.

Không revoke khi `oauth_invalid_grant` (grant đã chết), khi thua cuộc đua làm mới token (mục
*Hai pod cùng làm mới token*), và khi thành viên bị vô hiệu hoá (dòng và token được giữ, F-03).

Revoke là best-effort:

- Hạn 5 giây, không thử lại.
- Lỗi, hết hạn, hay Google trả 400 đều không làm lệnh thất bại hoặc rollback.
- Lỗi chỉ để lại một dòng Warn `email hub revoke failed` kèm `account_id` và `code`
  (`unsealable`, `request`, `timeout`, `unreachable`, `status_<n>`); bỏ qua có chủ đích là dòng
  `email hub revoke skipped` (`not_configured`, `grant_shared`, `lookup_failed`).
- Khi revoke thất bại, grant còn hiệu lực ở Google tới khi người dùng gỡ quyền của app trong
  tài khoản Google. Server không còn giữ token nào.

Nếu một dòng khác còn sống (bất kỳ tổ chức nào) dùng cùng địa chỉ với
`auth_kind = 'oauth_google'` và còn refresh token, server bỏ qua revoke (`grant_shared`). Lý do:
grant Google là của cặp (người dùng Google, client), nên revoke ở một tổ chức sẽ làm hộp thư ở
tổ chức kia rơi về `needs_reconnect`.

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

## Checklist thủ công trước khi đóng GĐ3

Chạy trên môi trường có env OAuth thật. Không tự động hoá được: Google/Microsoft không chạy
trong CI.

- [ ] Gmail cá nhân: kết nối bằng Google, sync Hộp thư đến, gửi một thư.
- [ ] Google Workspace trên tên miền riêng: như trên.
- [ ] Outlook.com: kết nối bằng Microsoft, sync, gửi.
- [ ] M365 có SMTP AUTH bật: kết nối, gửi.
- [ ] M365 có SMTP AUTH tắt: kết nối trả `smtp_disabled`, không có dòng nào được ghi.
- [ ] Một kết nối thất bại (ví dụ M365 SMTP AUTH tắt) hiện đúng câu lỗi trong dialog, và kết nối
      thành công tự đóng dialog: chứng minh postMessage tới được cửa sổ mở. Nếu không, popup bị
      COOP cắt opener; ghi lại để chuyển sang kênh khác (ví dụ BroadcastChannel trên trang
      callback cùng origin web).
- [ ] Máy chủ cPanel/Dovecot qua 993 + 465 và qua 143 + 587.
- [ ] Gửi từ tài khoản cPanel: thư nằm trong Sent trên máy chủ và hiện đúng một lần.
- [ ] Gỡ quyền ứng dụng ở Google rồi ở Microsoft: tài khoản về `needs_reconnect`
      (`oauth_invalid_grant`), thư đã cache còn.
- [ ] Kết nối lại qua *Kết nối lại*: popup gợi ý đúng địa chỉ, cùng account id, cùng luồng thư.
- [ ] Kết nối lại nhưng chọn một tài khoản khác trong popup: tài khoản cũ vẫn `needs_reconnect`.
- [ ] Ngắt kết nối một tài khoản Google: quyền của app biến mất khỏi trang quyền của tài khoản Google.
- [ ] Popup bị chặn: dialog báo lỗi, không treo ở trạng thái đang chờ.
- [ ] Đóng popup giữa chừng: dialog không báo lỗi và tải lại danh sách tài khoản.
