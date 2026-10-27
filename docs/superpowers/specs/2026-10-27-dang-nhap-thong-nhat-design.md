# Đăng nhập thống nhất: email + mật khẩu, Google, Apple trên web, máy tính và điện thoại

> **Trạng thái:** in-progress

Quyết định: [ADR 0047](../../adr/0047-dang-nhap-thong-nhat-tren-moi-nen-tang.md). Spec này là hợp đồng giữa server,
web và mobile: tên route, hình JSON, mã lỗi, luồng, màn hình và test. Đổi hợp đồng thì sửa spec trong cùng PR. Bản 2
(2026-10-27) đã qua ba vòng phản biện độc lập (bảo mật, sản phẩm, luật repo); các mục đánh dấu ⚑ là chỗ phản biện đổi
thiết kế.

## 1. Mục tiêu

Một tài khoản UniWork, cùng bộ cách vào ở mọi nền tảng:

| | Web | iPhone | Android | Desktop (UniChat, Office) |
|---|---|---|---|---|
| Email + mật khẩu | có | màn trong app | màn trong app | qua trang web |
| Google | redirect (sửa) | SDK native | SDK native | qua trang web |
| Apple | redirect `form_post` (mới) | sheet native | trình duyệt (PKCE, gợi ý `provider=apple`) | qua trang web |
| Xác thực hai lớp | có | trong app | trong app | qua trang web |
| Đăng ký bằng email | có | trong app | trong app | qua trang web |
| Phương thức đăng nhập (Cài đặt) | có (cả khi chưa có workspace) | có | có | có (liên kết mở trình duyệt) |

Ngoài phạm vi: thông báo server-to-server của Apple, email thứ hai cố định, SSO doanh nghiệp, passkey, màn bắt buộc cập
nhật app.

## 2. Dữ liệu

Migration `999<unix-ms>_sign_in_methods.up.sql` (+ `.down.sql`), chỉ `ALTER` và một bảng mới; bảng mới không có
index ngoài khoá chính (nếu cần index thì file riêng, `CONCURRENTLY`):

```sql
ALTER TABLE users ADD COLUMN google_email TEXT;
ALTER TABLE users ADD COLUMN google_linked_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN google_unlinked_sub TEXT;
ALTER TABLE users ADD COLUMN apple_email TEXT;
ALTER TABLE users ADD COLUMN apple_linked_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN apple_unlinked_sub TEXT;
ALTER TABLE users ADD COLUMN password_changed_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN credentials_revoked_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN second_factor_failures INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN second_factor_locked_until TIMESTAMPTZ;
ALTER TABLE email_verification_codes ADD COLUMN purpose TEXT NOT NULL DEFAULT 'verify_email'
  CHECK (purpose IN ('verify_email', 'step_up'));
ALTER TABLE email_verification_codes ADD COLUMN action TEXT;
UPDATE users SET google_email = email WHERE google_id IS NOT NULL AND google_email IS NULL;
UPDATE users SET apple_email = email WHERE apple_id IS NOT NULL AND apple_email IS NULL;

-- ⚑ "Tôi được mời bằng email khác": mã gửi tới một địa chỉ chưa chắc có tài khoản, nên không khoá theo user_id.
CREATE TABLE sign_in_email_claims (
  id           TEXT PRIMARY KEY,
  ticket_hash  TEXT NOT NULL,      -- sha256 của vé đang chờ
  email        TEXT NOT NULL,      -- lower + trim
  code_hash    TEXT NOT NULL,
  expires_at   TIMESTAMPTZ NOT NULL,
  attempts     INTEGER NOT NULL DEFAULT 0,
  used_at      TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

- `sign_in_email_claims` vào `tenantExemptTables` (lý do: danh tính, chưa có tổ chức, như `email_verification_codes`).
- `*_linked_at`, `password_changed_at` để NULL ở hàng cũ: SDO cho phép null, giao diện có câu không ngày.
- Query mới chỉ chạm `users` / `email_verification_codes` / `sign_in_email_claims` (đều miễn tenant) nên ⚑ **không**
  mang dòng `-- tenant:` (`TestTenantReasonsSitOnTenantQueries` từ chối dòng thừa).
- `CreateEmailVerificationCode` nhận `purpose`, `action`; `GetActive…`, `GetLatest…`, `DeleteEmailVerificationCodesForUser`
  lọc theo `purpose`.
- `LinkGoogleAccount` thêm điều kiện `google_id IS NULL OR google_id = $sub`, ghi `google_email`, `google_linked_at`,
  xoá `google_unlinked_sub`. Link Apple tương tự với các cột `apple_*`.
- Query mới: `UnlinkGoogleAccount` / `UnlinkAppleAccount` (Apple xoá cả `apple_client_id`, `apple_refresh_token_enc`;
  cả hai ghi `*_unlinked_sub = sub cũ`), `SetUserPassword` (ghi `password_changed_at`, lọc `deleted_at IS NULL`),
  `ReclaimUnverifiedUser` (mục 3.1, `WHERE id = $1 AND email_verified_at IS NULL`), `GetUserForUpdate` (`FOR UPDATE`),
  `MarkCredentialsRevoked`, `RecordSecondFactorFailure` / `ResetSecondFactorFailures`, query cho `sign_in_email_claims`.
- `AnonymizeUser` xoá luôn các cột mới. Xoá tài khoản hết hạn mọi `password_reset_tokens` của người đó;
  `UpdateUserPassword` lọc `deleted_at IS NULL` (lỗ cũ: link reset gửi trước khi xoá vẫn đặt được mật khẩu).

## 3. Server

### 3.1 Danh tính nhà cung cấp và quy tắc khớp (`service/identity_resolve.go`)

```go
type ProviderIdentity struct {
    Provider           string // "google" | "apple"
    Subject            string
    Email              string // lower + trim
    EmailVerified      bool
    EmailAuthoritative bool   // ⚑ nhà cung cấp sở hữu domain của email
    PrivateRelay       bool   // Apple Hide My Email
    Name               string // tối đa 100 ký tự
    Picture            string // Google, tối đa 512 ký tự
    AppleClientID      string // audience của token Apple (bundle id hay Services ID)
    AppleRefresh       string // refresh token Apple đã niêm phong, có thể rỗng
}
```

- ⚑ `EmailAuthoritative`: Google — `email` thuộc `gmail.com`/`googlemail.com`, hoặc claim `hd` bằng domain của email
  (Workspace). Apple — `icloud.com`/`me.com`/`mac.com`, hoặc relay (`@privaterelay.appleid.com`). Thêm `hd` vào
  `GoogleClaims`.

`resolveIdentity(ctx, q, id) (resolution, error)` — **thứ tự đánh giá cố định**:

| # | Điều kiện | Kết quả |
|---|---|---|
| 1 | Có user mang `google_id`/`apple_id` = `Subject` | `matched` |
| 2 | Email không dùng được (`!EmailVerified`, rỗng, không có `@`) | lỗi `sign_in_email_unverified` |
| 3 | Không user nào có email này | `unmatched` → vé (3.2) |
| 4 | ⚑ User có email này, `email_verified_at` trống, `EmailAuthoritative` | `reclaim` (bất kể user đó đang gắn gì) |
| 5 | User có email này, `email_verified_at` trống, không authoritative | lỗi `sign_in_account_unverified` (gợi ý quên mật khẩu, việc chứng minh hộp thư) |
| 6 | User có email này đã gắn **subject khác** của cùng nhà cung cấp | lỗi `sign_in_account_conflict` |
| 7 | `PrivateRelay` và có user mang email relay đó | lỗi `sign_in_account_conflict` |
| 8 | ⚑ `*_unlinked_sub` của user = `Subject`, hoặc email không authoritative | `link_required` → vé, màn chọn nói "đã có tài khoản, đăng nhập để liên kết" |
| 9 | User đã xác minh, email authoritative | `link` |

- `link` vào user bật MFA chỉ ghi **sau** khi bước hai qua (claim `pl`, 3.3). `matched` vào user bật MFA thì hỏi MFA
  như thường.
- ⚑ **`reclaim` không bao giờ hỏi bước hai** — yếu tố đó do người chưa chứng minh hộp thư đăng ký. Trong một giao dịch:
  `ReclaimUnverifiedUser` (xoá `password_hash`, `totp_secret`, `mfa_enabled_at`, `mfa_recovery_codes`, mọi cột
  `google_*`/`apple_*` cũ (giữ token Apple đã niêm phong để thu hồi sau commit), các cột đồng ý AI, đặt
  `email_verified_at`), rồi liên kết danh tính mới; `revokeAllUserSessions`, thu hồi MCP grant, **mọi** push
  subscription (kể cả trình duyệt), huỷ `desktop_auth_attempts`/MCP auth attempt đang mở của user, hết hạn reset token,
  xoá mã xác minh, `MarkCredentialsRevoked`; audit `auth.sign_in_method_linked {provider, via:"reclaim"}` và
  `auth.session_revoked` (`sessionRevoked(uid,"")`); mail `sign_in_method_changed` (`change: reclaimed`) xếp trong giao
  dịch. Rồi cấp phiên trực tiếp (không MFA). Người vừa lấy lại thấy thông báo một lần
  (`reclaimed: true` trong kết quả).
- ⚑ **Quên mật khẩu trên tài khoản chưa xác minh** cũng là `reclaim` theo hộp thư: `Reset` đánh dấu đã xác minh, xoá
  TOTP, mã khôi phục, danh tính nhà cung cấp, rồi cấp phiên không MFA. Cùng phần dọn với `reclaim` của nhà cung cấp
  (`reclaimMailbox`), rồi đặt mật khẩu mới; audit `auth.password_changed {via:"reset_token", reclaimed:true}` và
  `auth.session_revoked {reason:"reclaimed"}`; mail `sign_in_method_changed` (`change: reclaimed`, `method: password`);
  `SessionSDO` mang `reclaimed: true` (trường tuỳ chọn) để client báo một lần.
- ⚑ Tài khoản chưa xác minh **không** bật được MFA và không liên kết được nhà cung cấp (`403 email_unverified`): kẻ
  chiếm trước không cài được thứ gì sống sót qua `reclaim`.
- `link` theo email: audit `auth.sign_in_method_linked {via:"email_match"}`, mail `linked`.
- Tạo tài khoản (`CreateGoogleUser`, `CreateAppleUser`) chỉ từ: lệnh tạo bằng vé (3.2), `intent=sign_up` (3.2), luồng
  "email khác" (3.2), và route Apple native cũ (3.6). Email authoritative → `email_verified_at` có; không → để trống và
  gửi mã xác minh như đăng ký thường. `onboarded_at` trống.

### 3.2 Vé đăng nhập (`service/sign_in_ticket.go`)

⚑ Mọi blob đưa cho client đi qua `SecretSealer.SealFor(purpose, plain)` / `OpenFor(purpose, sealed)`: `purpose` là
additional data của AES-GCM, khoá con theo purpose dẫn bằng HKDF từ `JWT_SECRET`. Purpose: `sign_in_ticket`,
`mfa_pending_link`, `link_token`, `oauth_state:google`, `oauth_state:apple`, `apple_web_result`, `step_up`. `Seal`/`Open`
cũ giữ cho TOTP và token Apple. Một sealer dựng trong `main.go`, tiêm vào mọi service. Test: blob của purpose này không
mở được bằng purpose khác.

Vé: `{v:1, identity, kind: "unmatched"|"link_required", channel: "web"|"native", client_id, deployment_id,
key_hash, intent, iat, exp}` — TTL 15 phút.

- **Web**: chỉ trong cookie `uniwork_sign_in_ticket` (HttpOnly, `Path=/api/v1/auth`, `SameSite=Lax`,
  `Secure=Cfg.SecureCookies`, 900 s). Mọi đăng nhập thành công **không ở chế độ liên kết** và mọi lần đăng xuất xoá
  cookie này.
- **Native**: chỉ trong JSON. ⚑ `key_hash` = SHA-256 của nonce gốc mà app đã dùng cho sheet Apple/Google; mọi lệnh
  dùng vé native phải gửi lại `nonce` gốc. Vé lọt ra log không dùng được nếu không có nonce.

| Route | Auth | Vào | Ra |
|---|---|---|---|
| `GET /api/v1/auth/sign-in-ticket` | cookie vé | — | `SignInTicketSDO {provider, kind, email, name, private_relay}`; không có → `404 sign_in_ticket_missing` |
| `POST /api/v1/auth/sign-in-ticket/create` | cookie vé | `{display_name?}` | như `POST /auth/login` (cookie refresh + `{user, access_token}`); xoá vé |
| `POST /api/v1/auth/sign-in-ticket/claim-email` | cookie vé | `{email}` | `200 {status:"sent"}` (luôn 200, không lộ email có tài khoản hay không); gửi lại < 60 s → `429` |
| `POST /api/v1/auth/sign-in-ticket/claim-email/verify` | cookie vé | `{email, code, display_name?}` | như login (hoặc `{mfa_required, mfa_token}`); xoá vé |
| `DELETE /api/v1/auth/sign-in-ticket` | công khai | — | `204` |
| `POST /api/v1/auth/sign-in-ticket/link` | bearer web | `{move?: bool}` | `SignInMethodsChangeSDO`; xoá vé |
| `POST /api/v1/auth/native/sign-in-ticket/create` | — | `{ticket, nonce, display_name?, ...client}` | `NativeSignInSDO` |
| `POST /api/v1/auth/native/sign-in-ticket/claim-email` (+ `/verify`) | — | `{ticket, nonce, email[, code, display_name]}` | như web, kết quả `NativeSignInSDO` |
| `POST /api/v1/auth/native/sign-in-ticket/link` | bearer native | `{ticket, nonce, move?}` | `SignInMethodsChangeSDO` |

- `create`: chỉ với vé `kind=unmatched`; email đã có người (xuất hiện sau khi cấp vé) → `409 sign_in_account_conflict`.
  `display_name` bắt buộc khi `identity.name` rỗng.
- ⚑ `intent=sign_up` (từ `/register` web và màn đăng ký của app): `unmatched` tạo tài khoản ngay, không màn chọn.
- ⚑ **Email khác** (người được mời bằng email công việc, khác Apple/Google ID): mã 6 số gửi tới địa chỉ nhập, 15 phút,
  5 lần thử, gửi lại sau 60 s, mail `sign_in_email_claim`. Đúng mã: địa chỉ đó có tài khoản đã xác minh → liên kết danh
  tính vào đó (bật MFA thì qua bước hai với `pl`); có tài khoản chưa xác minh → `reclaim` vào đó (hộp thư đã được chứng
  minh); không có → tạo tài khoản với địa chỉ đó (`email_verified_at` có) rồi liên kết. Audit `via:"email_claim"`.
- ⚑ **`link` từ vé chỉ nhận phiên mới hơn vé**: web — thời điểm tạo phiên (`MIN(refresh_tokens.created_at)` theo
  `session_id` của access token) ≥ `ticket.iat`; native — `device_sessions.created_at` ≥ `ticket.iat` và cùng
  `client_id`/`deployment_id`. Không thì `403 proof_required` (dùng step-up token, 3.7). Kênh lệch → `400
  sign_in_ticket_channel`.
- Quy tắc liên kết như 3.7: subject đã thuộc người khác → `409 sign_in_method_taken` (hoặc `sign_in_method_movable`,
  xem dưới); người dùng đã gắn subject khác của nhà cung cấp đó → `409 sign_in_method_already_linked`. Audit
  `via:"ticket"`. Mail `linked` gửi chủ tài khoản, và tới email của nhà cung cấp khi khác và không phải relay.
- ⚑ **Chuyển danh tính từ tài khoản rỗng**: subject đang thuộc một tài khoản **chưa từng** có hàng
  `organization_members` nào (kể cả đã vô hiệu) → `409 sign_in_method_movable` kèm email đã che (`a•••@icloud.com`).
  Gửi lại với `move: true` (chỉ khi danh tính vừa được chứng minh: vé, callback liên kết, token native): trong một
  giao dịch gỡ danh tính khỏi tài khoản rỗng, ẩn danh hoá nó (`AnonymizeUser` + thu hồi phiên), liên kết vào người gọi;
  audit `via:"move"` trên cả hai; mail cả hai. Tài khoản kia không rỗng → `sign_in_method_taken` kèm email đã che, để
  người dùng biết đăng nhập vào đâu mà gỡ.

### 3.3 Thử thách MFA gắn kênh, liên kết chờ, khoá khi đoán

- `MintMFA` thêm claim `chn` (`web` | `native`), `cid`, `dep`, `pl` (blob `mfa_pending_link`, có thể rỗng). Token không
  có `chn` (phát trước khi deploy) coi là `web`.
- `POST /auth/mfa/verify` (web) từ chối `chn != web`; `POST /auth/native/mfa` từ chối `chn != native` hay `cid`/`dep`
  lệch body. Cả hai: `401 invalid_credentials`.
- Đúng mã và có `pl`: chạy lại `resolveIdentity`; còn `link` cho đúng user ấy thì ghi liên kết trong giao dịch cấp
  phiên. Không thì đăng nhập vẫn thành công và kết quả mang `link_skipped: "<mã>"` để client nói "Chưa liên kết được
  Apple — thử lại trong Cài đặt". Mã: lỗi của bộ khớp (`sign_in_email_unverified`, `sign_in_account_unverified`,
  `sign_in_account_conflict` — cả khi email đã sang tài khoản khác), `sign_in_method_taken` (danh tính đã mở tài
  khoản khác), `link_required` (chủ tài khoản vừa gỡ đúng subject này), `sign_in_failed` (không mở được `pl`). Đã
  liên kết đúng tài khoản ấy rồi (cùng thử thách gửi hai lần) thì không làm gì, không có `link_skipped`. Liên kết chạy
  trong savepoint: DB từ chối (subject vừa bị lấy) cũng không làm hỏng giao dịch mở phiên. Trên web `link_skipped` là
  trường tuỳ chọn của `SessionSDO` ở `POST /auth/mfa/verify` (đường cookie `uniwork_mfa` của Google/Apple web).
- ⚑ Đếm sai: mỗi lần sai mã MFA hay bằng chứng step-up tăng `second_factor_failures`; đến 10 thì
  `second_factor_locked_until = now + 15 phút`, gửi mail `sign_in_method_changed` (`change: second_factor_locked`), mọi
  lần thử trong lúc khoá → `429 second_factor_locked` (kèm `retry_after`). Đúng mã thì về 0. Một helper
  (`weighSecondFactor`, `service/second_factor.go`) cho MFA web, step-up và MFA native, chạy dưới khoá hàng `users`
  (`FOR UPDATE`) nên các lần đoán đồng thời xếp hàng. Lần sai thứ 10 trả luôn `429` (không phải `401`). Trong lúc khoá
  không kiểm gì: mã đúng cũng `429`, mã khôi phục không bị tiêu. Bộ đếm theo tài khoản, không theo token: thử thách mới
  cũng bị khoá. Token MFA từ kênh khác bị từ chối trước khi đọc tài khoản nên không tính là một lần đoán.

### 3.4 Web: Google (sửa), Apple (mới), kết thúc chung

Code redirect của cả hai luồng sống trong `handler/web_sign_in.go` (helper chung, `finishWebSignIn`,
`redirectLoginError`) và `handler/apple_web.go`; cả hai vào allowlist của `TestOnlyBrowserFlowsRedirect` cùng
`google.go`; câu tương ứng trong `CLAUDE.md` sửa cùng commit. Mọi URL kết quả ghép tham số bằng `url.Values` vào
`next`/`return_to` sẵn có (không nối chuỗi).

**Google**: `GET /auth/google/start?next=&intent=sign_in|sign_up|link&link_token=` — cookie state là blob
`oauth_state:google {state, nonce, verifier, next, intent, uid?, sid?, return_to?}`, `SameSite=Lax`, Path
`/api/v1/auth/google`; PKCE S256 + nonce (kiểm ở `Exchange`); `prompt=select_account` luôn.

**Apple**:

- `GET /auth/apple/start?next=&intent=&link_token=` → `302` tới
  `https://appleid.apple.com/auth/authorize?response_type=code&response_mode=form_post&client_id=<Services ID>&redirect_uri=<API_PUBLIC_URL>/api/v1/auth/apple/callback&scope=name%20email&state=…&nonce=<sha256hex(raw)>`.
  Cookie `uniwork_apple_state` (blob `oauth_state:apple`): HttpOnly, `SameSite=None; Secure` (luôn Secure), Path
  `/api/v1/auth/apple`, 10 phút.
- `POST /auth/apple/callback` (form, `http.MaxBytesReader` 64 KiB, SDI `formData`, không qua `decode`): xoá cookie state;
  `error=user_cancelled_authorize` → kết quả `apple_denied`; kiểm `state`; đổi code **có** `redirect_uri`
  (`AppleClient.ExchangeWebCode` → `id_token`, `refresh_token`); kiểm `id_token` bằng verifier web (audience = Services
  ID, nonce); tên từ trường `user` (không ký, chỉ là gợi ý). Rồi ⚑ ghi kết quả vào cookie một lần
  `uniwork_apple_result` (blob `apple_web_result`, `SameSite=None; Secure`, 2 phút) và `303` tới
  `GET /auth/apple/finish`.
- `GET /auth/apple/finish`: điều hướng top-level cùng site nên cookie Lax (`uniwork_refresh`, vé) có mặt; xoá cookie
  kết quả; chạy `finishWebSignIn`.
- Config: `APPLE_SIWA_WEB_CLIENT_ID`. Bật khi có nó **và** `AppleClient` (team, key id, khoá) dựng được. Verifier web và
  native là hai instance với hai danh sách audience (`TestWebAndNativeAppleAudiencesStayApart`). Liên kết/tạo từ web lưu
  `apple_client_id = Services ID`.

**`finishWebSignIn`** (Google callback và Apple finish):

| Kết quả | Trả |
|---|---|
| `intent=link` | `SignInMethodsService.LinkFromBrowser(uid, sid, identity, liveSessionCookie)` — kiểm lại phiên `sid` còn sống **và** cookie refresh hiện tại thuộc đúng phiên đó → `303 <return_to>` + `sign_in_method=<p>&result=linked\|<mã>` |
| phiên thường | cookie refresh → `/auth/callback?next=` (+ `reclaimed=1` khi có) |
| cần MFA | cookie `uniwork_mfa` (token có `pl` khi chờ liên kết) → `/login?mfa=1&next=` |
| `unmatched`/`link_required` | cookie vé → `/auth/continue?next=` |
| lỗi | `/login?error=<mã>&next=` (sửa: không làm rơi `next`) |

Mã lỗi trên `/login`: `google_denied`, `google_failed`, `google_unverified`, `apple_denied`, `apple_failed`,
`sign_in_conflict`, `sign_in_unverified`, `sign_in_account_unverified`, `sign_in_failed`. Mã `result` của Cài đặt:
`linked`, `denied`, `failed`, `taken`, `movable`, `already_linked`, `session_mismatch`.

**Bắt đầu liên kết từ trình duyệt** (`intent=link`): `link_token` (blob `link_token`, 5 phút,
`{uid, sid, provider, return_to, expect_user}`). `start` gọi `AuthService.LiveWebSession(ctx, rawRefreshCookie)`
(service; handler không đọc DB) và chỉ nhận khi `(user_id, session_id) = (uid, sid)`; không thì `303 <return_to>` +
`result=session_mismatch`. Callback/finish kiểm lại như bảng trên (`TestLinkStartNeedsTheSameBrowserSession` phủ cả hai
đầu).

**Chống login CSRF** ⚑: route công khai đặt cookie hay mở phiên (`/auth/login`, `/auth/register`, `/auth/mfa/verify`,
`/auth/password/reset`, `/auth/sign-in-ticket*`) qua middleware `mw.SameSiteJSON`: từ chối `Sec-Fetch-Site: cross-site`
và Content-Type không phải `application/json` → `415`/`403 cross_site_request`. Client native không gửi
`Sec-Fetch-Site` nên không bị ảnh hưởng. `TestCredentialRoutesRefuseCrossSiteForms`.

### 3.5 Gợi ý nhà cung cấp cho PKCE

`GET /auth/desktop/start` nhận thêm `provider` ∈ {`google`, `apple`} (sai → `400 invalid_request`), nối vào
`authorization_url`. Trang `/auth/desktop/authorize` chuyển tiếp `provider` khi gửi người chưa đăng nhập sang `/login`;
`/login` có `provider` thì `location.replace` **một lần** tới `start` của nhà cung cấp và xoá `provider` khỏi URL (Back
không lặp). Đã đăng nhập thì trang đồng ý hiện "Không phải bạn? Dùng tài khoản khác". Trang đồng ý nói theo nền tảng
(`platform` ∈ ios/android → "Cho phép UniChat trên điện thoại này đăng nhập?"; desktop như cũ), `deployment`/`build`
vào "Chi tiết"; trạng thái hết hạn nói "Quay lại UniChat và thử lại". Callback custom scheme vẫn chỉ có `code`, `state`.

### 3.6 Route native

Mọi route: công khai, `Cache-Control: no-store`, ⚑ chỉ nhận `client_id` thuộc `NATIVE_SIGN_IN_CLIENTS` (mặc định
`uniwork-chat-mobile`; desktop và Office vẫn đi trang web) và `clientAllowed(client_id, deployment_id)`. Trường chung
`NativeClientSDI`: `client_id`, `deployment_id`, `device_label?`, `platform?`, `build?` (cả hai `_id` vào
`isoRefFieldExempt`).

`NativeSignInSDO`:

```json
{
  "status": "signed_in | mfa_required | identity_unmatched | link_required",
  "session": { "...": "DesktopSessionSDO, khi signed_in" },
  "reclaimed": false,
  "link_skipped": "",
  "mfa_token": "khi mfa_required",
  "ticket": "khi identity_unmatched | link_required",
  "identity": { "provider": "apple", "email": "…", "name": "…", "private_relay": true }
}
```

| Route | Vào (ngoài `NativeClientSDI`) | Kết quả |
|---|---|---|
| `POST /api/v1/auth/native/password` | `email`, `password` | `signed_in`, `mfa_required`; `401 invalid_credentials` |
| `POST /api/v1/auth/native/mfa` | `mfa_token`, `code` | `signed_in`; `401 invalid_credentials`; `429 second_factor_locked` |
| `POST /api/v1/auth/native/google` | `id_token`, `nonce`, `intent?` | mọi trạng thái; `401 provider_token_invalid` |
| `POST /api/v1/auth/native/apple` | `identity_token`, `nonce`, `authorization_code?`, `given_name?`, `family_name?`, `intent?` | mọi trạng thái; `401 provider_token_invalid` |
| `POST /api/v1/auth/native/register` | `email`, `password`, `display_name` | `signed_in` (chưa xác minh); lỗi như `POST /auth/register` |
| vé native | 3.2 | |

- Phiên qua `DesktopAuthService.issueDeviceSession` trong giao dịch với audit `auth.login_succeeded`
  (`via: password|google|apple|ticket|register|email_claim`). ⚑ Mail `new_login` gửi khi tài khoản đã có bất kỳ phiên
  hay thiết bị nào trước lần này (như `hadSessions` của Apple), không dựa vào user-agent; ghi deployment, nền tảng, IP.
- **Google native** (`auth/google.go`, dùng lại provider go-oidc đã discovery): `Verifier(SkipClientIDCheck)` + kiểm
  `aud` ∈ `GOOGLE_CLIENT_ID ∪ GOOGLE_NATIVE_CLIENT_IDS` **và** ⚑ `azp ∈ GOOGLE_NATIVE_CLIENT_IDS` (từ chối `azp` là
  client web), `iat` không quá 10 phút, ⚑ `nonce` **bắt buộc** = `sha256hex(nonce gốc)`, `email_verified`, `hd`.
  `TestWebAndNativeGoogleAudiencesStayApart`, `TestGoogleNativeNeedsANonceAndTheAppAzp`.
- ⚑ `POST /api/v1/auth/apple/native` (cũ) chạy trên `resolveIdentity` qua bộ chuyển mã cho bản app đã phát hành:
  xung đột → `409 apple_account_conflict`; email không dùng được/chưa xác minh (`sign_in_email_unverified`) → `401
  apple_token_invalid`; MFA → `403 mfa_required` (không liên kết); `unmatched` → `CreateAppleUser` như cũ (email đã xác
  minh); `link_required` và `sign_in_account_unverified` → `409 apple_account_conflict` (email đã thuộc một tài khoản,
  app cũ không có màn chọn nên không tạo được tài khoản thứ hai cùng email, đúng mã bản cũ trả cho trường hợp này);
  `reclaim` vẫn chạy (không MFA).
  `TestLegacyAppleNativeKeepsItsCodes`. Gỡ khi mọi bản mobile đang dùng gọi `/auth/native/*`; hạn xem lại
  2027-01-31 ghi trong `scripts/governance.test.mjs` (fail khi quá hạn mà route còn).

### 3.7 Step-up và phương thức đăng nhập

**Step-up token** ⚑ (`service/step_up.go`, một chỗ duy nhất kiểm bằng chứng):

- `POST /me/step-up` `{password?, code?, provider_token?: {provider, token, nonce}}` → `{step_up_token, expires_at,
  method}`. Token là blob `step_up` `{uid, sid, iat, exp: +10 phút}`, gắn với phiên hiện tại (web `session_id`, native
  device id); phiên bị thu hồi hay đăng xuất là token chết.
- Cách chứng minh được nhận (`SignInMethodsSDO.proofs`): tài khoản bật MFA → **chỉ** `totp` (TOTP hay mã khôi phục);
  không MFA → `password` (nếu có), `email_code` (mọi tài khoản), và trên app `apple`/`google` (token mới của đúng
  subject đã liên kết, `iat` ≤ 5 phút, nonce) — cho tài khoản relay không nhận được mail.
- `POST /me/step-up/email-code` `{action}` → `{status:"sent"}`: mã 6 số purpose `step_up` mang `action`
  (`set_password|change_password|link_google|link_apple|unlink_google|unlink_apple|enable_mfa|delete_account|transfer_ownership`),
  mail `step_up_code` nêu việc, thiết bị, IP và "Không chia sẻ mã"; gửi lại sau 60 s, tối đa 5 mã/ngày; mã không bao
  giờ nhận `DEV_VERIFICATION_CODE`; `/me/step-up` với `code` kiểm `action` khớp (client gửi kèm `action`).
- Sai → `403 password_incorrect` / `mfa_code_incorrect` / `step_up_code_incorrect`; thiếu hay token hết hạn → `403
  proof_required`; khoá → `429 second_factor_locked`. Không bao giờ 401 với người đã đăng nhập.
- ⚑ Lệnh dùng step-up token (body `step_up_token`): mọi lệnh phương thức đăng nhập bên dưới, **bật MFA**
  (`/me/mfa/setup`, `/me/mfa/confirm`), **xoá tài khoản** (thêm; `email_confirmation` cũ giữ cho bản app đã phát hành,
  xem lại cùng hạn 2027-01-31), **chuyển quyền sở hữu** và chuyển tổ chức khi nhận lời mời (thay `password_required`:
  chủ chỉ có Google/Apple chứng minh bằng mã email). `TestSignInMethodChangesNeedAProof` phủ tất cả.
- ⚑ Lệnh nhạy cảm (step-up, mọi lệnh phương thức đăng nhập, đồng ý desktop/MCP) từ chối access token web có `iat` trước
  `credentials_revoked_at` (`401 invalid_token`). Cả hai đều tính bằng giây nên chỉ từ chối token **cũ hơn hẳn**; phiên
  chính lệnh đó cấp thì qua. Middleware bearer đặt token đã kiểm (kèm `iat`) vào context, nên không thêm lượt đọc DB cho
  mọi request; helper `requireCurrentCredentials` đọc hàng `users` của chính chủ token. Token native không xét ở đây
  (thu hồi thì phiên thiết bị chết, middleware đã chặn); không có token trong context (job, test gọi thẳng service) thì
  không có gì để xét. Đồng ý desktop và MCP dùng nó từ lát 1.

**Phương thức đăng nhập** (`service/sign_in_methods.go`, bearer):

```json
{
  "password": { "set": true, "changed_at": "2026-10-12T08:00:00Z" },
  "google": { "linked": true, "email": "an@gmail.com", "linked_at": null },
  "apple": { "linked": false, "email": null, "linked_at": null, "private_relay": false },
  "account_email_is_relay": false,
  "proofs": ["password", "email_code"]
}
```

`private_relay` suy từ hậu tố `@privaterelay.appleid.com`. `SignInMethodsChangeSDO = {user, sign_in_methods}`; client
chỉ ghi `user` vào phiên khi parse đúng, không thì gọi lại `/me` (không bao giờ ghi user dự phòng).

| Route | Vào | Ra |
|---|---|---|
| `GET /me/sign-in-methods` | — | `SignInMethodsSDO` |
| `PUT /me/password` | `new_password`, `current_password?`, `step_up_token?` | `SignInMethodsChangeSDO` |
| `POST /me/sign-in-methods/google/link`, `…/apple/link` | `step_up_token`, `return_to` | `{authorization_url}` (web) |
| `POST /me/sign-in-methods/google/native` | `step_up_token`, `id_token`, `nonce`, `move?` | `SignInMethodsChangeSDO` |
| `POST /me/sign-in-methods/apple/native` | `step_up_token`, `identity_token`, `nonce`, `authorization_code?`, `move?` | `SignInMethodsChangeSDO` |
| `POST /me/sign-in-methods/google/unlink`, `…/apple/unlink` | `step_up_token` | `SignInMethodsChangeSDO` |

- `PUT /me/password`: có mật khẩu → `current_password` là bằng chứng (không cần token); chưa có → `step_up_token`.
  `validatePassword` như đăng ký. ⚑ Đổi mật khẩu **luôn** (server quyết, không có cờ client) thu hồi mọi phiên khác
  qua helper mới `revokeOtherUserSessions(ctx, q, uid, keepSessionID)` cạnh `revokeAllUserSessions` (cùng thứ tự khoá:
  device_sessions trừ family đang giữ, refresh_tokens khác `session_id`, push thiết bị, lease Office;
  `observeOfficeLeaseRevokes` sau commit), thu hồi MCP grant, `MarkCredentialsRevoked`; audit
  `auth.session_revoked {scope:"others", reason:"password_changed"}`. Đặt lần đầu không thu hồi. Audit
  `auth.password_set` / `auth.password_changed` (`via: settings`). `POST /me/sessions/revoke-others` chuyển sang helper
  này (sửa lỗi cũ: nó không đụng phiên thiết bị).
- Liên kết: như 3.2 (`taken`, `movable`, `already_linked`); xoá `*_unlinked_sub`; audit `via: settings`.
- Gỡ: khoá hàng `users` (`FOR UPDATE`), còn 0 phương thức → `409 sign_in_method_last`; ⚑ email tài khoản là relay và
  gỡ Apple → `409 sign_in_method_relay_email`. Ghi `*_unlinked_sub`; thu hồi phiên khác + MCP grant như đổi mật khẩu;
  Apple: thu hồi token Apple sau commit. Audit `auth.sign_in_method_unlinked`.
- Mail: một kind `sign_in_method_changed` (vi/en, `.html` + `.txt`), `change` ∈
  `linked|unlinked|reclaimed|moved|password_set|password_changed|second_factor_locked`, phương thức, thiết bị, IP, thời
  điểm, nút "Xem bảo mật" → `/settings?tab=security` (trang có thật, 4.5) và "Không phải bạn? Đặt lại mật khẩu" →
  `/forgot-password`. Thay `apple_linked` (bỏ kind cũ và test của nó). Xếp mail trong giao dịch của lệnh
  (`out.Enqueue(ctx, qtx, msg)`), `Kick` sau commit.
- ⚑ **Quên mật khẩu cho tài khoản không mật khẩu**: `Request` vẫn trả 200 như mọi khi nhưng gửi mail
  `password_reset` biến thể "Tài khoản này đăng nhập bằng Google/Apple" với nút đăng nhập bằng nhà cung cấp và nút "Đặt
  mật khẩu" (token reset như thường; áp dụng ghi `auth.password_set`, `via: reset_token`). Trang reset nói "Đặt mật
  khẩu" khi tài khoản chưa có. Đổi `TestPasswordResetIgnoresGoogleOnly`.

### 3.8 `/auth/providers`

`AuthProvidersSDO {google, apple, apple_web, google_native}` — `apple` giữ nghĩa cũ (Apple native iPhone; app đã phát
hành đọc nó).

### 3.9 Ngân sách thử ⚑

Ba bucket có tên trong `router.go`, mỗi cái dưới một trần theo địa chỉ:

- `sign-in-password`: `/auth/login` + `/auth/native/password`, khoá theo IP + email đã chuẩn hoá (20/phút), trần 600/phút/IP.
- `sign-in-mfa`: `/auth/mfa/verify` + `/auth/native/mfa`, khoá theo IP + `sub` của token MFA (10/phút).
- `step-up`: mọi route nhận bằng chứng (`/me/step-up*`, `PUT /me/password`, xoá tài khoản, chuyển quyền), khoá theo
  user của bearer (10/phút).
- Route mới còn lại dùng `credentialLimit`. `router/ratelimit_test.go` ghim từng route; đoạn rate limit trong
  `CLAUDE.md` cập nhật.

### 3.10 Biến môi trường (`.env.example`, danh sách xoá env của `config_test.go`)

`APPLE_SIWA_WEB_CLIENT_ID`, `GOOGLE_NATIVE_CLIENT_IDS` (iOS + Android client id, phẩy), `NATIVE_SIGN_IN_CLIENTS`. Mobile
build: `UNICHAT_GOOGLE_IOS_CLIENT_ID`, `UNICHAT_GOOGLE_WEB_CLIENT_ID`.

### 3.11 Test

Test mới (tên trong ADR): `TestProviderSignInLinksByEmailOnlyWhenBothSidesVerified`,
`TestProviderSignInTrustsOnlyAuthoritativeEmail`, `TestProviderSignInReclaimsAnUnverifiedAccount` (phủ: kẻ chiếm bật TOTP,
gắn Apple, gắn Google khác; push trình duyệt, JWT, mã desktop đã duyệt), `TestReclaimNeverAsksTheSquattersSecondFactor`,
`TestAnUnlinkedProviderIsNotRelinkedByEmail`, `TestProviderSignInWithoutAMatchIssuesATicketNotAnAccount`,
`TestSignUpIntentCreatesWithoutTheChoice`, `TestEmailClaimLinksCreatesOrReclaims`,
`TestAProviderIdentityMovesOnlyFromAnEmptyAccount`, `TestSignInTicketIsBoundToItsChannel`,
`TestTicketLinkNeedsASessionStartedAfterTheTicket`, `TestNativeTicketNeedsTheNonce`, `TestSealedBlobsDoNotCrossPurposes`,
`TestMFAChallengeIsBoundToItsChannel`, `TestLinkWaitsForTheSecondFactor`, `TestSecondFactorLocksAfterTenFailures`,
`TestSignInMethodChangesNeedAProof`, `TestMFAEnrolmentNeedsAProof`, `TestStepUpTokenDiesWithItsSession`,
`TestStepUpCodeNamesItsActionAndIgnoresTheDevCode`, `TestTheLastSignInMethodCannotBeRemoved`,
`TestARelayAccountKeepsApple`, `TestPasswordChangeRevokesEveryOtherSession`, `TestRevokeOthersEndsDeviceSessions`,
`TestLinkStartNeedsTheSameBrowserSession`, `TestAppleWebCallbackChecksStateNonceAndAudience`,
`TestWebAndNativeAppleAudiencesStayApart`, `TestWebAndNativeGoogleAudiencesStayApart`,
`TestGoogleNativeNeedsANonceAndTheAppAzp`, `TestNativeDoorsTakeOnlyNativeClients`,
`TestNativeSignInAlwaysAlertsAnAccountThatHadASession`, `TestLegacyAppleNativeKeepsItsCodes`,
`TestCredentialRoutesRefuseCrossSiteForms`, `TestForgotPasswordOnAPasswordlessAccountOffersToSetOne`,
`TestUnverifiedAccountsCannotEnrolMFAOrLink`, `TestCredentialsRevokedAtRefusesOlderWebTokens`.

Test cũ phải sửa (giữ luật cũ dưới tên mới khi luật còn): `googleauth_test.go` (`…LinksExistingPasswordAccountByEmail`,
`…CreatesVerifiedUserWithoutPassword`, `…FallsBackToEmailLocalPartForName`, `…RejectsUnverifiedEmailAndForeignLink`);
`appleauth_test.go` (`…LinksOnlyAVerifiedAddressThatIsNotARelay`, `…SendsAnMFAAccountToTheBrowserWithoutLinking`,
`…TellsTheOwnerOfTheLinkAndOfEveryNewSession`, `…CreatesARelayAccountAndFindsItAgainBySubject`);
`handler/google_test.go` (start/callback/error); `TestAuthProvidersReportsApple`; `TestAppleLinkedRendersBothLocales`;
`TestPasswordResetIgnoresGoogleOnly`; `TestDeleteAccount*` proof; chuyển quyền `password_required`; fake
`GoogleExchanger`. Tên test `CLAUDE.md` trích dẫn đổi cùng commit.

Guard test bị chạm: allowlist `TestOnlyBrowserFlowsRedirect` (`web_sign_in.go`, `apple_web.go`); `isoRoutes` cho mọi route
mới (`isoPublic` cho route công khai, `isoSelf` cho `/me`); `isoRefFieldExempt` cho `client_id`, `deployment_id`;
`audit_coverage_test.go` (mỗi action mới một ca chạy lệnh thật); `router/ratelimit_test.go`; swagger (SDI `formData` cho
callback Apple, `status: 302/303` dạng số); `tenantExemptTables` cho `sign_in_email_claims`; mail `kinds` + render test
vi/en; `.env.example`; `no-pii-log`.

## 4. Web

### 4.1 Nút nhà cung cấp ⚑

`packages/views/auth/social-sign-in.tsx` thay `google-button.tsx`, dùng ở đăng nhập và đăng ký, đặt **trên** form như
mobile (cùng thứ bậc ở mọi nền tảng): các nút nhà cung cấp, rồi vạch "hoặc dùng email", rồi form. Một `<a>` cho mỗi
nhà cung cấp bật (Google, Apple), pill `buttonVariants({variant:'outline',size:'lg'})` + `AUTH_PILL`; Apple: sáng =
trắng viền, tối = `dark:bg-foreground dark:text-background` (trắng chữ đen, đúng HIG). Placeholder giữ chỗ cho tối đa
hai nút khi `/auth/providers` đang tải. `AppleMark` (`fill="currentColor"`) trong `packages/views/common/provider-icons.tsx`.
`paths.appleStart({next, intent})` cạnh `paths.googleStart`. Đăng ký truyền `intent=sign_up` và giữ `next`; link qua
lại giữa đăng nhập và đăng ký giữ `next`. Playwright: nút nhà cung cấp là link nên vẫn chỉ có một *button* "Đăng nhập"
trên `/login`, một "Đăng ký" trên `/register`.

### 4.2 Lỗi và `next` qua các cổng ⚑

- Một bảng mã → khoá i18n `auth.social.errors.<mã>` thay `GOOGLE_ERRORS`/`replace("google_", "")`; mã lạ bị bỏ qua.
  Alert cấp form. `AuthCallbackView` nói "Đang đăng nhập…"; tới đó mà không có phiên → `/login?error=sign_in_failed`.
  `reclaimed=1` → toast một lần "Đã lấy lại tài khoản. Mật khẩu cũ (đặt khi email chưa xác minh) đã bị xoá."
- `next` sống qua `/verify` và `/onboarding`: trang đăng ký, xác minh và onboarding đọc và chuyển tiếp `next`, rồi đi
  tới nó sau cổng. `/auth/desktop/authorize` và `/auth/continue?step=link` được đi thẳng kể cả khi còn cổng (app đã xử lý
  tài khoản chưa có workspace).

### 4.3 Màn chọn `/auth/continue`

`apps/web/app/(auth)/auth/continue/page.tsx` → `packages/views/auth/continue-view.tsx` (trong `AuthShell`), builder
`paths.authContinue({next, step})` + mục trong `consistency.test.ts`.

Trạng thái và lời:

- **Đang tải**: skeleton đúng hình khối danh tính và các lựa chọn.
- **Không có vé / hết hạn**: "Lượt đăng nhập bằng {{provider}} đã hết hạn." + nút "Thử lại" (về `/login?next=`).
- **`kind=unmatched`**: tiêu đề "Tiếp tục với {{provider}}"; khối danh tính (dấu nhà cung cấp trong ô 40 px, tên, email;
  relay: "Email ẩn của Apple" thay địa chỉ). Ba lựa chọn là hàng lớn bấm được (tiêu đề + một dòng + mũi tên):
  1. **Tôi đã có tài khoản UniWork** — "Đăng nhập một lần để liên kết {{provider}}. Lần sau chỉ cần {{provider}}." →
     `/login?link=1&next=<paths.authContinue({step:'link', next})>`.
  2. **Tôi được mời bằng email khác** — "Dùng email công việc mà tổ chức đã mời." → bước nhập email → bước nhập mã
     (đếm ngược gửi lại 60 s) → đăng nhập/tạo (3.2).
  3. **Tạo tài khoản mới** — "Dùng {{email}} để đăng nhập UniWork." (relay: "Dùng email ẩn của Apple.") → khi
     `identity.name` rỗng hiện ô "Tên hiển thị" → `POST …/create` → `resolveLoggedInDestination(next)`. Dưới lựa chọn
     này là `AuthLegalNote action="signUp"`.
  Relay: một dòng gợi ý "Tổ chức mời bạn qua email công việc? Chọn "Tôi được mời bằng email khác"."
- **`kind=link_required`**: tiêu đề "Email này đã có tài khoản UniWork"; mô tả "Đăng nhập vào {{email}} để liên kết
  {{provider}}."; một nút chính "Đăng nhập để liên kết" (→ như lựa chọn 1).
- **Đang gửi** (mọi lựa chọn): nút bận `aria-busy`, các lựa chọn khác `aria-disabled`.
- **Lỗi** `409 sign_in_account_conflict` → "Email này vừa có tài khoản. Đăng nhập để liên kết." + nút sang lựa chọn 1;
  `429` → "Thử lại sau {{seconds}} giây."; mạng/5xx → "Không kết nối được. Thử lại." có nút thử lại.
- **Đã đăng nhập sẵn** (có phiên): thay ba lựa chọn bằng "Liên kết {{provider}} với {{account}}" (→ `step=link`) và
  "Dùng tài khoản khác" (đăng xuất rồi về màn chọn).
- Nút phụ "Hủy" → `DELETE /auth/sign-in-ticket` → `/login?next=`.
- **`step=link`** (đã đăng nhập): **không tự ghi khi mở**. Hiện "Liên kết {{provider}} ({{provider_email}}) với
  {{account_email}}?" + nút "Liên kết" và "Không liên kết". Thành công → `role=status` "Đã liên kết {{provider}}. Lần sau
  chỉ cần {{provider}}." + nút "Tiếp tục" được focus (không tự chuyển trang). Tải lại sau khi xong mà vé đã hết → coi
  như đã xong. `sign_in_method_movable` → "{{provider}} này đang dùng cho tài khoản trống {{masked}}. Chuyển sang tài
  khoản này?" + "Chuyển" (gửi `move: true`). `taken` → nêu email đã che và "Đăng nhập vào đó để gỡ liên kết". Mọi lỗi
  vẫn có "Tiếp tục".

### 4.4 Chế độ liên kết trên `/login`

`?link=1`: `Alert` thông tin trên form: "Đăng nhập vào tài khoản UniWork của bạn để liên kết {{provider}}
({{email}})." + nút "Không liên kết" (xoá vé, bỏ `link`). Nút của chính nhà cung cấp đang chờ bị ẩn (không lặp). Mọi
cách còn lại (mật khẩu, nhà cung cấp kia, MFA) giữ `next`. Bước MFA có phụ đề "Đăng nhập vào {{email}} để liên kết
{{provider}}". "Quên mật khẩu?" giữ `next`; reset thành công mà vé còn thì về `step=link`.

### 4.5 Cài đặt › Phương thức đăng nhập

`packages/views/settings/components/security-sign-in-methods.tsx`, section đầu của `SecurityTab` (cả `SettingsPage` và
`ChatSettingsPage`). ⚑ Trang `/settings` (slug đã giữ chỗ) cho mọi người: có workspace → chuyển tới
`/{org}/{ws}/settings` giữ `tab`; chưa có → trang bảo mật cấp tài khoản (`PageHeader` + `SecurityTab`), có builder
`paths.securitySettings()`.

Tiêu đề "Phương thức đăng nhập", mô tả "Những cách bạn dùng để vào UniWork trên web, máy tính và điện thoại." Ba hàng
(`SettingsListItem`, ô 32 px):

| Hàng | Meta | Huy hiệu | Hành động |
|---|---|---|---|
| Mật khẩu (`KeyRound`) | "Đổi lần cuối ngày {{date}}" / "Đã đặt" / "Đặt mật khẩu để đăng nhập bằng email" | Đã đặt / Chưa đặt | Đổi mật khẩu / Đặt mật khẩu |
| Google (`GoogleMark`) | email · "Đã liên kết ngày {{date}}" / "Đã liên kết" | Đã liên kết | Gỡ liên kết / Liên kết |
| Apple (`AppleMark`) | email hay "Email ẩn của Apple" · ngày | Đã liên kết | Gỡ liên kết / Liên kết |

- Nhà cung cấp chưa liên kết mà deployment không bật thì ẩn hàng.
- Gỡ phương thức cuối: `aria-disabled` + `SettingsRowReason` "Đây là cách đăng nhập duy nhất. Đặt mật khẩu hoặc liên kết
  cách khác trước." Gỡ Apple của tài khoản relay: "Email đăng nhập của bạn là email ẩn của Apple, nên cần giữ Apple."
- **Hộp bằng chứng** (`step-up-proof.tsx`, dùng chung cho mọi lệnh nhạy cảm, kể cả bật MFA, xoá tài khoản, chuyển
  quyền): theo `proofs` — ô mật khẩu (kèm "Quên mật khẩu?"), ô "Mã từ ứng dụng xác thực", hay "Gửi mã tới {{email}}" +
  ô mã; có "Dùng cách khác" khi có hơn một cách. Gọi `/me/step-up` trước, giữ `step_up_token` trong bộ nhớ 10 phút
  (lệnh tiếp theo trong cửa sổ đó không hỏi lại). Lỗi dưới ô, focus trả về ô.
- **Đặt/Đổi mật khẩu** (`FormDialog` md): đổi = mật khẩu hiện tại + mới, ghi chú "Các thiết bị khác sẽ đăng xuất."; đặt
  = bằng chứng + mới + "Bạn sẽ đăng nhập bằng {{email}}" (relay có nút sao chép). Thành công: ghi user, toast.
- **Liên kết** (web): bằng chứng → `POST …/link` → `window.location.assign(authorization_url)`. Quay lại với
  `?sign_in_method=&result=`: toast theo kết quả (`movable` mở hộp xác nhận chuyển), xoá tham số khỏi URL.
- **Gỡ liên kết**: `ConfirmDialog` destructive (ô `Unlink`), nói còn lại cách nào và "Các thiết bị khác sẽ đăng xuất."
- **Shell UniChat desktop** (`getDesktopBridge()` có): "Liên kết trên web" (biểu tượng mở ngoài) mở
  `${appUrl}/settings?tab=security&expect_user=<id>` bằng `bridge.openExternal`; trang web thấy trình duyệt đăng nhập
  người khác thì cảnh báo "Trình duyệt đang đăng nhập {{other}}, UniChat dùng {{me}}." Danh sách tải lại khi cửa sổ có
  focus. Đổi mật khẩu và gỡ chạy tại chỗ.
- Bỏ (không chỉ sửa lời) ngõ cụt `org.transfer.reason_no_password`, `org.transfer.no_password`,
  `invitations.switch.no_password_reason`: chuyển quyền và chuyển tổ chức dùng hộp bằng chứng. Xoá tài khoản dùng hộp
  bằng chứng. `auth.forgot.googleHint` nói cả Apple và mail "đặt mật khẩu" mới.

### 4.6 Test web

Unit: mỗi endpoint mới có ca response hỏng (trừ `createFromSignInTicket` và claim-email verify, thêm vào danh sách
"fail loudly" của `CLAUDE.md` cạnh login/register); `social-sign-in` (2 nút, placeholder, ẩn theo cờ, là `<a>`, giữ
`next`/`intent`); `continue-view` (mọi trạng thái 4.3); `login-view` (chế độ liên kết, ẩn nút đang chờ, bảng lỗi,
`provider` tự chuyển một lần); `security-sign-in-methods` (mỗi loại bằng chứng, cửa sổ step-up, phương thức cuối,
relay, shell, kết quả trên URL); `/settings` (có/không workspace); chuyển quyền/xoá tài khoản với bằng chứng.
E2E: stub `/api/v1/auth/providers` bằng `page.route` để đo tương phản và bố cục nút Apple hai chế độ màu; spec
tương phản/bố cục cho `/auth/continue`; năm spec onboarding không sửa.

## 5. Mobile (`apps/chat-mobile`)

### 5.1 Lớp dữ liệu

- Kết quả issuer: `{kind:"session", session} | {kind:"mfa", token, context} | {kind:"choice", ticket, nonce, identity,
  kind2}`; bước hai giữ trong store chỉ-bộ-nhớ `data/auth/pending-sign-in.ts` (không persist, không thành route param);
  chỉ phiên đã có mới qua `loginWith`/`adoptIssued`. Tách `session.ts` trước khi thêm (đang 483 dòng).
- `LoginMethod` thêm `password | google | ticket | register | email_claim`; mật khẩu vào issuer bằng closure, không bao
  giờ nằm trong event/effect.
- Route, mã mới vào `Route`/`SERVER_CODES`; `scripts/mobile-route-catalogue`, `server-contract.test.ts` (+
  `HANDLER_FILES`, `mobile-native-scope.mjs`, `E2E_PATHS`), `COMMAND_MODULES`.
- Google: `@react-native-google-signin/google-signin` qua `expo install` (bọc trong `data/auth/google.ts`, mock được
  trong vitest); nonce bắt buộc (SHA-256 hex của nonce gốc đưa cho SDK; chọn đường API có nonce — iOS GoogleSignIn ≥ 7.1,
  Android Credential Manager); `GoogleSignin.signOut()` trước khi liên kết và khi đăng xuất UniChat; không có Play
  Services → ẩn Google native, dùng trình duyệt. Dấu "G" là ảnh qua `expo-image`.
- `webcredentials:${APP_LINK_HOST}` trong `associatedDomains`; AASA thêm `webcredentials.apps`, assetlinks thêm
  `get_login_creds` (`apps/web/platform/well-known.ts` + test) để AutoFill gợi ý mật khẩu đã lưu cho web.

### 5.2 Màn hình

- **Đăng nhập** (`app/(auth)/login.tsx` chỉ ghép, thành phần ở `components/auth/`): dấu UniChat, "Đăng nhập UniChat",
  một dòng phụ; iPhone: nút Apple hệ thống (đen/trắng theo chế độ, cao 48, bo tròn) rồi Google; Android: Google rồi
  Apple (pill trắng/đen có dấu Apple → PKCE `provider=apple`); vạch "hoặc dùng email"; ô Email
  (`textContentType="username"`, `autoComplete="email"`), ô Mật khẩu (hiện/ẩn, `textContentType="password"`),
  "Quên mật khẩu?" (mở `/forgot-password` trong trình duyệt), nút "Đăng nhập"; chân trang "Chưa có tài khoản? Tạo tài
  khoản" và nút chữ "Đăng nhập bằng trình duyệt". Bàn phím không che ô. Lỗi một dòng có biểu tượng, `role=alert`,
  `useAnnounce`. Đang bận: spinner có nhãn, nút khác mờ và bỏ qua chạm.
- **Hai lớp** (`mfa.tsx`): ô 6 số (`oneTimeCode`), tự gửi khi đủ, "Dùng mã khôi phục"; phụ đề "Đăng nhập vào {{email}}"
  (và "để liên kết {{provider}}" khi có); `429 second_factor_locked` → đếm ngược.
- **Màn chọn** (`continue.tsx`): như 4.3, thứ tự lựa chọn trên app: "Tôi được mời bằng email khác" và "Tôi đã có tài
  khoản" trước, "Tạo tài khoản mới" sau (app không tạo được tổ chức). Vé + nonce chỉ trong bộ nhớ; app bị tắt giữa
  chừng thì lần mở sau nói "Lượt đăng nhập bằng Apple đã hết. Thử lại."
- **Đăng ký** (`register.tsx`): tên, email, mật khẩu (`newPassword`) + Apple/Google với `intent=sign_up` → đăng nhập →
  **xác minh email** (trong `(app)`): ô 6 số, gửi lại có đếm ngược, "Sai email? Đăng xuất", link Cài đặt (xoá tài
  khoản). Chưa xác minh thì không vào danh sách workspace.
- **Chọn workspace khi rỗng**: liệt kê `GET /me/invitations` (tổ chức, workspace, người mời) + "Tham gia" →
  `POST /invitations/{token}/accept`; lời mời cấp tổ chức không kèm workspace → "Đã vào {{org}}. Quản trị viên sẽ thêm
  bạn vào workspace."; `409 organization_switch_required` → mở `/invitations` (không phải `/invite/…`, tránh universal
  link quay về app) trong trình duyệt. Không lời mời: "Chưa có lời mời nào gửi tới {{email}}." + "Tạo tổ chức trên
  web". Deep link `/invite/{token}` giữ qua đăng nhập và mở màn xem trước (không tự nhận).
- **Phương thức đăng nhập** (`components/settings/sign-in-methods-section.tsx`, tab Cài đặt workspace và `/account`):
  cùng ba hàng, cùng luật; bằng chứng bằng sheet (mật khẩu / mã TOTP / mã email / Apple-Google lại); bằng chứng kiểm
  **trước** khi mở sheet nhà cung cấp. Liên kết Google: SDK → `google/native`; Apple trên iPhone: sheet →
  `apple/native`; Apple trên Android: mở `/settings?tab=security` trong trình duyệt. Đặt/đổi mật khẩu:
  `app/(app)/password.tsx`. Tải lại khi app về foreground.
- Xoá tài khoản và chuyển quyền trên app dùng step-up (bỏ `mobile.account.transfer_password_needed`).

### 5.3 Cổng và tài liệu mobile

Chuỗi qua `t()`; dùng chung lời web qua `PATHS` của `sync-i18n.mjs` (`auth.social`, `auth.continue`, `auth.apple`,
`settings.security.signInMethods`, `settings.security.stepUp`), chuỗi riêng app trong `scripts/i18n-sign-in.mjs`.
Maestro `sign-in.yaml`, `smoke-launch.yaml`, `a11y-large-text-dark.yaml` viết lại theo ô native (testID), và
`upgrade-before.yaml` vẫn chạy được với bản cũ. Version app tăng; privacy manifest, `store/listing.md`,
`android-permissions.json`, ngân sách bundle/khởi động. `apps/chat-mobile/CLAUDE.md` dòng đăng nhập;
`docs/engineering/unichat-mobile-masvs.md` hàng MASVS-AUTH: RFC 8252 nói về app bên thứ ba lấy thông tin đăng nhập của
dịch vụ khác; app first-party nhập mật khẩu của chính dịch vụ, bù bằng TLS pinning, mật khẩu chỉ trong bộ nhớ, không vào
log/Sentry, bucket thử theo email, khoá bước hai.

## 6. Tài liệu đi kèm

- `CLAUDE.md`: đoạn Sign in with Apple (Backend HTTP Rules) viết lại theo 0047 với tên test mới; câu redirect thêm
  `web_sign_in.go`, `apple_web.go`; đoạn rate limit thêm ba bucket; API Compatibility thêm hai route "fail loudly".
- `docs/adr/README.md` (0047), dòng Trạng thái của 0041.
- `docs/conventions.md` §2: "phương thức đăng nhập" / sign-in method; "liên kết" / "gỡ liên kết" (link/unlink account —
  khác "gắn"); "Đặt mật khẩu" / "Đổi mật khẩu"; "xác thực hai lớp"; "Ẩn địa chỉ email" (Hide My Email); "bằng chứng"
  không lộ ra giao diện (giao diện nói "xác nhận là bạn"); Apple vào danh sách thương hiệu.
- Chính sách quyền riêng tư + `store/listing.md` + test: Apple trên web, máy tính, Android; Google SDK trên app.
- Owner action (ADR 0047): Services ID, OAuth client iOS/Android, **đăng ký domain gửi mail với "Sign in with Apple for
  Email Communication" + SPF/DKIM** (không có thì mã step-up không tới được tài khoản relay).

## 7. Thứ tự giao

Một nhánh, commit theo lát, mỗi lát để server chạy được:

1. Dữ liệu + sqlc; sealer theo purpose; `resolveIdentity` với `reclaim`; Google web đi qua nó (PKCE, nonce, `next`);
   cổng `requireVerifiedEmail` cho MFA/liên kết; quên mật khẩu chưa xác minh = reclaim; helper thu hồi; khoá bước hai.
   Lát này còn tạo ngay khi `unmatched` (như cũ) để không có trang 404; `link_required` chưa có vé nên Google web từ
   chối (`/login?error=sign_in_conflict`, không liên kết). Lát 1b thêm token MFA gắn kênh và liên kết chờ `pl` cho
   Google web (3.3), khoá bước hai, cổng `credentials_revoked_at` cho đồng ý desktop/MCP, `revokeOtherUserSessions`.
2. Vé + màn chọn server (create, claim-email, link, move, `intent=sign_up`), `pl` cho vé và "email khác", chống login
   CSRF, `/auth/providers`, gợi ý PKCE. Từ lát này `unmatched` ra vé — **cùng PR** với trang `/auth/continue` của web.
3. Step-up + phương thức đăng nhập + mật khẩu + quên mật khẩu không mật khẩu + xoá tài khoản/chuyển quyền dùng step-up +
   mail + ngân sách thử.
4. Apple web.
5. Route native + Google ID token + bộ chuyển mã route Apple cũ.
6. Web (4.x). 7. Mobile (5.x).
