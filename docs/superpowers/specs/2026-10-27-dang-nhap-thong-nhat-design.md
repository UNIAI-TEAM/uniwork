# Đăng nhập thống nhất: email + mật khẩu, Google, Apple trên web, máy tính và điện thoại

> **Trạng thái:** in-progress — server (§3), web (§4) và mobile (§5) đã có trên nhánh `feature/auth-unified-sign-in`
> (PR UNI-2263), có unit test. Còn: việc của chủ sản phẩm (§6: Services ID Apple, OAuth client Google iOS/Android và
> biến build, biến well-known, domain gửi mail cho email ẩn của Apple), bản build native đầu tiên trong CI (module Google,
> `android-smoke`, `android-e2e`, `ios-release`, flow Maestro), e2e Playwright trên CI. Chỉ ghi shipped sau khi PR merge.

Quyết định: [ADR 0049](../../adr/0049-dang-nhap-thong-nhat-tren-moi-nen-tang.md). Spec này là hợp đồng giữa server,
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
  Lát 2 thêm `idx_sign_in_email_claims_ticket (ticket_hash, created_at DESC)` trong file riêng, `CONCURRENTLY` (cổng
  gửi lại và kiểm mã đều đọc theo vé); `GetActiveSignInEmailClaim` khoá hàng (`FOR UPDATE`) để các lần đoán đồng thời
  xếp hàng. `CreateGoogleUser`/`CreateAppleUser` nhận địa chỉ nhà cung cấp (`google_email`/`apple_email`) riêng với
  địa chỉ tài khoản: tài khoản tạo qua "email khác" mang địa chỉ công việc, liên kết giữ địa chỉ nhà cung cấp.
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
  (`reclaimed: true` trong kết quả). Phiên của lượt `reclaim` (web, app, link reset, "email khác") không kèm mail
  `new_login`: mail `reclaimed` đã báo chủ, và phiên của người đăng ký trước vừa bị thu hồi làm trình duyệt của chủ
  trông như thiết bị mới.
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
  cookie này. Chế độ liên kết được nói ra như sau: `POST /auth/login`, `/auth/mfa/verify`, `/auth/password/reset`
  nhận `keep_sign_in_ticket: true` (trang `/login?link=1` gửi); đăng nhập nhà cung cấp giữ vé khi `next` là
  `/auth/continue?step=link…`; `/auth/register` luôn xoá; bước có thử thách MFA chưa xoá (chưa có phiên).
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

- Vé thiếu, hết hạn, hỏng hay niêm phong cho purpose khác → `404 sign_in_ticket_missing` ở mọi route vé (web xoá
  cookie); vé native gửi thiếu hay sai `nonce`, `client_id`, `deployment_id`, hoặc vé của kênh kia →
  `400 sign_in_ticket_channel`. Lõi của các lệnh (`createQ`, `claimQ`, `attachIdentity`, binding native và kiểm
  `key_hash`) đã có từ lát 2; route native (lát 5) chỉ thêm handler và phiên thiết bị.
- `create`: chỉ với vé `kind=unmatched` (vé `link_required` → `409 sign_in_account_conflict`); email đã có người
  (xuất hiện sau khi cấp vé) → `409 sign_in_account_conflict`. `display_name` bắt buộc khi `identity.name` rỗng (tối đa
  100 ký tự). Danh tính đã mở một tài khoản (cùng vé đã tạo ở tab khác) thì đăng nhập vào đó — đó là tính idempotent.
  Audit `auth.login_succeeded {via:"ticket", provider, account: created|subject}` trong giao dịch.
- ⚑ `intent=sign_up` (từ `/register` web và màn đăng ký của app): `unmatched` tạo tài khoản ngay, không màn chọn.
- ⚑ **Email khác** (người được mời bằng email công việc, khác Apple/Google ID): mã 6 số gửi tới địa chỉ nhập, 15 phút,
  5 lần thử, gửi lại sau 60 s, mail `sign_in_email_claim`. Đúng mã: địa chỉ đó có tài khoản đã xác minh → liên kết danh
  tính vào đó (bật MFA thì qua bước hai với `pl`); có tài khoản chưa xác minh → `reclaim` vào đó (hộp thư đã được chứng
  minh); không có → tạo tài khoản với địa chỉ đó (`email_verified_at` có) rồi liên kết. Audit `via:"email_claim"`.
  Mã không bao giờ nhận `DEV_VERIFICATION_CODE` (nó chứng minh hộp thư của người khác và mở một tài khoản). Gửi lại
  sớm → `429 rate_limited` kèm `retry_after` (giới hạn theo vé, mọi địa chỉ, để một vé không rải mã); sai mã →
  `400 invalid_code`; năm lần sai thì mã chết; địa chỉ không hợp lệ → `400 invalid_request`. ⚑ (phản biện lát 5) Vé
  không tốn gì (mỗi lượt nhà cung cấp cấp một, token Google native dùng lại được trong 10 phút), nên còn một ngân sách
  **theo địa chỉ**, dù vé nào xin, dưới khoá advisory của địa chỉ: tối đa 5 mã mỗi 24 giờ, và khi các mã của địa chỉ
  trong 24 giờ đã chịu 10 lần đoán sai thì không gửi thêm và không kiểm mã nào nữa (cả mã đúng) → `429 rate_limited`
  kèm `retry_after` (tới khi mã cũ nhất ra khỏi cửa sổ). Index `idx_sign_in_email_claims_email (email, created_at
  DESC)` trong file riêng, `CONCURRENTLY`; dọn hàng giữ một ngày. Không đếm vào khoá bước hai của tài khoản (người lạ
  sẽ khoá được bước hai của chủ) và không thêm bucket router theo email (ngân sách ở service không cần Redis). Lúc xác nhận mà danh tính
  đã mở một tài khoản: cùng địa chỉ → đăng nhập vào đó; khác → `409 sign_in_method_taken`. Tài khoản của địa chỉ đã
  gắn subject khác của nhà cung cấp → `409 sign_in_method_already_linked`. Tạo mới lấy tên `display_name`, không có thì
  tên nhà cung cấp, không có nữa thì phần trước @: không hỏi tên trước khi mã đúng, để không lộ địa chỉ có tài khoản
  hay không. `pl` của nhánh MFA mang `via: email_claim`: sau bước hai chỉ kiểm subject chưa thuộc ai và tài khoản chưa
  gắn subject khác (địa chỉ nhà cung cấp không phải của tài khoản nên không khớp lại theo email). Mail `linked` gửi
  chủ tài khoản và email nhà cung cấp khi khác và không phải relay.
- ⚑ **`link` từ vé chỉ nhận phiên mới hơn vé**: web — thời điểm tạo phiên (`MIN(refresh_tokens.created_at)` theo
  `session_id` của access token) ≥ `ticket.iat`; native — `device_sessions.signed_in_at` ≥ `ticket.iat` và cùng
  `client_id`/`deployment_id`. ⚑ (phản biện lát 5) Không dùng `created_at` của hàng thiết bị: đồng ý desktop/PKCE
  biến bất kỳ token trình duyệt nào còn sống thành một hàng thiết bị mới. `signed_in_at` là lúc người sau phiên chứng
  minh thông tin đăng nhập: đăng nhập của chính app (`NativeSignInService.open`, route Apple cũ), hay lúc phiên trình
  duyệt đã duyệt lượt đồng ý bắt đầu (`desktop_auth_attempts.approver_signed_in_at`, ghi lúc duyệt, chuyển sang hàng
  thiết bị lúc đổi mã). Hàng cũ để NULL: không bao giờ tính là mới hơn vé. `TestAppTicketLinkNeedsASignInNotAConsent`. Không thì `403 proof_required` (dùng step-up token, 3.7). Kênh lệch → `400
  sign_in_ticket_channel`. Phiên của bearer không còn sống (đã đăng xuất, thiết bị bị thu hồi) → `401 invalid_token`;
  token web cũ hơn `credentials_revoked_at` cũng vậy (3.7); tài khoản chưa xác minh email → `403 email_unverified`;
  đã liên kết đúng subject này → thành công, không ghi gì.
- Quy tắc liên kết như 3.7: subject đã thuộc người khác → `409 sign_in_method_taken` (hoặc `sign_in_method_movable`,
  xem dưới); người dùng đã gắn subject khác của nhà cung cấp đó → `409 sign_in_method_already_linked`. Audit
  `via:"ticket"`. Mail `linked` gửi chủ tài khoản, và tới email của nhà cung cấp khi khác và không phải relay.
- ⚑ **Chuyển danh tính từ tài khoản rỗng**: subject đang thuộc một tài khoản **chưa từng** có hàng
  `organization_members` nào (kể cả đã vô hiệu) → `409 sign_in_method_movable` kèm email đã che (`a•••@icloud.com`).
  Gửi lại với `move: true` (chỉ khi danh tính vừa được chứng minh: vé, callback liên kết, token native): trong một
  giao dịch gỡ danh tính khỏi tài khoản rỗng, ẩn danh hoá nó (`AnonymizeUser` + thu hồi phiên), liên kết vào người gọi;
  audit `via:"move"` trên cả hai; mail cả hai. Tài khoản kia không rỗng → `sign_in_method_taken` kèm email đã che, để
  người dùng biết đăng nhập vào đâu mà gỡ. Cụ thể (lát 2): "rỗng" = không hàng `organization_members` nào **và** không
  hàng audit `organization_member` (`member.joined`/`member.left`) nào, vì rời tổ chức xoá hàng thành viên còn audit
  thì không; kiểm dưới `LockUserMembership` của tài khoản rỗng. Chuyển = xoá như xoá tài khoản (ẩn danh hoá, thu hồi
  phiên, thiết bị, push, MCP grant, lượt đồng ý desktop/MCP đang mở, link reset, mã email; nhả ảnh đại diện); audit
  trên tài khoản rỗng `auth.sign_in_method_unlinked {provider, via:"move", moved_to}` (action có từ lát này),
  `auth.session_revoked {reason:"moved"}` (+ `session.revoked`), `user.deleted {reason:"moved"}`; trên người gọi
  `auth.sign_in_method_linked {via:"move", moved_from}`. Chuyển Apple thì token Apple đi theo danh tính; chuyển Google
  thì token Apple của tài khoản rỗng (nếu có) được trả lại Apple sau commit. Mail `moved` tới địa chỉ cũ của tài khoản
  rỗng (chiều đi) và người gọi (chiều đến); địa chỉ nhà cung cấp chỉ khi khác cả hai và không phải relay.
- `DELETE` ("Hủy") trả lại Apple token vé mang (nếu có), như route Apple cũ trả token của một lần đăng nhập không thành;
  trừ khi Apple ID đó đã mở một tài khoản (cùng vé đã tạo ở tab khác), tài khoản ấy giữ token.
- `SignInMethodsSDO.proofs` tính sẵn từ lát 2 (`totp` khi bật MFA; không thì `password` nếu có, `email_code`, và trên
  app `apple`/`google` đã liên kết); step-up dùng nó ở lát 3.

### 3.3 Thử thách MFA gắn kênh, liên kết chờ, khoá khi đoán

- `MintMFA` thêm claim `chn` (`web` | `native`), `cid`, `dep`, `pl` (blob `mfa_pending_link`, có thể rỗng). Token không
  có `chn` (phát trước khi deploy) coi là `web`.
- `POST /auth/mfa/verify` (web) từ chối `chn != web`; `POST /auth/native/mfa` từ chối `chn != native` hay `cid`/`dep`
  lệch body. Cả hai: `401 invalid_credentials`.
- ⚑ (phản biện lát 5) Thử thách chết cùng bước đầu đã mua nó: token có `iat` trước `credentials_revoked_at` (cùng giây
  thì qua: link reset trên tài khoản bật MFA trả thử thách ngay trong giây của dấu, và thử thách vẫn đòi yếu tố) hay
  tài khoản không còn bật MFA (thu hồi đã xoá, hay chủ vừa tắt) → `401 invalid_credentials`, không bao giờ là phiên
  không cần mã; người dùng đăng nhập lại.
  Thử thách người chiếm trước giữ lúc thu hồi không mở được tài khoản đã lấy lại.
  `TestAChallengeDiesWithTheFirstFactorItFollowed`, `TestReclaimNeverAsksTheSquattersSecondFactor`.
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
`oauth_state:google {state, nonce, verifier, next, intent, uid?, sid?, proof_exp?, return_to?}`, `SameSite=Lax`, Path
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
- Lát 4 (server): `AppleAuthService` có hai cửa (`service/apple_web.go` cho web, `SetWeb`); dựng khi có
  `APPLE_SIWA_AUDIENCES` **hoặc** Services ID, verifier native để nil khi chỉ có web (`POST /auth/apple/native` → `503
  apple_auth_unavailable`). `/auth/providers`: `apple` = cửa native, `apple_web` = cửa web. Config từ chối khởi động
  khi Services ID nằm trong `APPLE_SIWA_AUDIENCES` (token của cửa này mở được cửa kia). Chưa cấu hình: `start` và `POST
  /me/sign-in-methods/apple/link` → `503 apple_not_configured`. Google và Apple web dùng chung một lõi đăng nhập
  (`AuthService.webProviderSignIn`, `service/web_provider_sign_in.go`); audit `auth.login_succeeded {via:"provider"}`
  thêm `provider`. Callback: mọi lỗi → `apple_failed` (kể cả body quá 64 KiB, thiếu code), riêng
  `user_cancelled_authorize` → `apple_denied`; với `intent=link` → `return_to` + `result=denied|failed`. Callback 303
  tới `/api/v1/auth/apple/finish` (đường tương đối, cùng host). Cookie kết quả chỉ xoá khi finish đọc, không có bảng
  nên không chặn được dùng lại trong 2 phút; nó HttpOnly, `Secure`, chỉ gửi tới `/api/v1/auth/apple`. Token Apple
  (consent) của lượt web: tài khoản mở được giữ nó (`apple_client_id = Services ID`); `matched` không MFA giữ token mới
  hơn (như route cũ), `matched` còn nợ MFA không ghi gì (giữ token cũ); `link` vào tài khoản MFA mang token trong `pl`;
  vé mang nó; lượt bị từ chối (đăng nhập hay liên kết từ Cài đặt) trả lại Apple trừ khi Apple ID đã mở một tài khoản
  (`giveBack`, dùng chung với "Hủy" của vé); token của identity token không qua kiểm thì bỏ, không thu hồi (không biết
  của ai). Tài khoản tạo từ web (`intent=sign_up`) xác minh email chỉ khi email thuộc Apple (iCloud/relay), như Google.
  OpenAPI ghi response 302/303 cho các route redirect.

**`finishWebSignIn`** (Google callback và Apple finish):

| Kết quả | Trả |
|---|---|
| `intent=link` | `SignInMethodsService.LinkFromBrowser(uid, sid, identity, liveSessionCookie)` — kiểm lại phiên `sid` còn sống **và** cookie refresh hiện tại thuộc đúng phiên đó → `303 <return_to>` + `sign_in_method=<p>&result=linked\|<mã>` |
| phiên thường | cookie refresh → `/auth/callback?next=` (+ `reclaimed=1` khi có) |
| cần MFA | cookie `uniwork_mfa` (token có `pl` khi chờ liên kết) → `/login?mfa=1&next=` |
| `unmatched`/`link_required` | cookie vé → `/auth/continue?next=`; ⚑ chế độ liên kết (`next` là bước liên kết, `keepsSignInTicket`) mà cookie còn một vé sống: vé đang chờ giữ nguyên (không `Set-Cookie`), vé mới bỏ (`Discard`: đồng ý Apple trả lại Apple) → `/login?error=<google\|apple>_no_account&next=` (`keepWaitingTicket`) |
| lỗi | `/login?error=<mã>&next=` (sửa: không làm rơi `next`) |

Mã lỗi trên `/login`: `google_denied`, `google_failed`, `google_unverified`, `apple_denied`, `apple_failed`,
`sign_in_conflict`, `sign_in_unverified`, `sign_in_account_unverified`, `sign_in_failed`, `google_no_account`,
`apple_no_account` (chỉ ở chế độ liên kết, xem bảng; bảng mã của web là `LOGIN_REDIRECT_ERRORS`). Chỉ cookie vé của
chính trình duyệt và danh tính mà trình duyệt đó vừa chứng minh ở nhà cung cấp (state, PKCE, nonce gắn cookie của nó)
đi vào nhánh này, nên trang khác không đẩy được danh tính của mình vào để thay hay xoá vé đang chờ; nhánh chỉ bỏ vé
mới. `TestLinkModeKeepsTheWaitingTicketWhenTheOtherWayMatchesNothing`,
`TestLinkModeKeepsTheWaitingTicketWhenAppleMatchesNothing`. Mã `result` của Cài đặt:
`linked`, `denied`, `failed`, `taken`, `movable`, `already_linked`, `session_mismatch`.

**Bắt đầu liên kết từ trình duyệt** (`intent=link`): `link_token` (blob `link_token`, 5 phút,
`{uid, sid, provider, return_to, expect_user, proof_exp}`; `proof_exp` là hạn của token step-up đã cho bắt đầu, cookie
state của Google và luồng Apple mang nó qua vòng nhà cung cấp, xem 3.7). `start` gọi `AuthService.LiveWebSession(ctx, rawRefreshCookie)`
(service; handler không đọc DB) và chỉ nhận khi `(user_id, session_id) = (uid, sid)`; không thì `303 <return_to>` +
`result=session_mismatch`. Callback/finish kiểm lại như bảng trên (`TestLinkStartNeedsTheSameBrowserSession` phủ cả hai
đầu).

**Chống login CSRF** ⚑: route công khai đặt cookie hay mở phiên (`/auth/login`, `/auth/register`, `/auth/mfa/verify`,
`/auth/password/reset`, `/auth/sign-in-ticket*`) qua middleware `mw.SameSiteJSON`: từ chối `Sec-Fetch-Site: cross-site`
và Content-Type không phải `application/json` → `415`/`403 cross_site_request`. Client native không gửi
`Sec-Fetch-Site` nên không bị ảnh hưởng. `TestCredentialRoutesRefuseCrossSiteForms`. Lát 2: `Sec-Fetch-Site:
cross-site` → `403 cross_site_request`; body (POST/PUT/PATCH) không phải `application/json`, kể cả thiếu Content-Type
→ `415 unsupported_media_type`; GET/DELETE chỉ xét dòng đầu. Middleware chạy trước ngân sách credential, nên form một
trang khác đẩy tới không tiêu ngân sách của địa chỉ. Áp cả cho `POST /auth/sign-in-ticket/link` (bearer, tiêu cookie
vé).

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
`isoRefFieldExempt`), ⚑ `locale?` (`vi` | `en`: ngôn ngữ app đang dùng, đọc lúc gọi từng cửa; app không có cookie
`uniwork-locale`, nên đây là ngôn ngữ của tài khoản cửa tạo và của mail cửa gửi — mã đăng ký, mã gửi tới email khác;
thiếu hay giá trị khác thì theo cookie rồi tiếng Anh như web, `TestNativeDoorsMailInTheAppsLanguage`).

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
  2027-01-31 cùng các bằng chứng cũ (3.7), giữ bằng `TestLegacyProofDoorsAreReviewed` (Go, hằng
  `legacyProofReviewBy`; fail khi quá hạn cho tới khi gỡ hay dời hạn có lý do) thay cho `scripts/governance.test.mjs`.
- Lát 5 (server): `service/native_sign_in.go` (cửa) và `service/native_sign_in_ticket.go` (vé), `NativeSignInService`.
  Cửa không đúng client → `400 invalid_request` (như route Apple cũ); client native phải vừa nằm trong
  `NATIVE_SIGN_IN_CLIENTS` vừa là client desktop đã cấu hình, và route Apple cũ cũng chỉ nhận danh sách này (bản app
  đã phát hành gửi `uniwork-chat-mobile`). Mọi cửa native (cả vé) qua `mw.SameSiteJSON` như cửa web: app gửi JSON,
  không có `Sec-Fetch-Site`; form trang khác không tiêu ngân sách. `NativeClientSDI` nhúng vào mọi SDI native, kể cả
  `claim-email` và `link` (vé native kiểm client/deployment). `NativeSignInSDO`: `reclaimed`, `link_skipped` luôn có;
  `session`, `mfa_token`, `ticket`, `identity` chỉ khi có. Đóng: không có service → `503 native_sign_in_unavailable`;
  Google chưa cấu hình (`GOOGLE_NATIVE_CLIENT_IDS`) → `503 google_not_configured`; Apple native chưa cấu hình →
  `503 apple_auth_unavailable`. Audit `auth.login_succeeded` mọi phiên native mang `channel: native`; bước hai native
  ghi `via: mfa` (cùng `mfa: true`) vì token thử thách không nhớ bước đầu đi cửa nào; `login_failed` native cũng mang
  `channel`. Bước hai web và native dùng chung một lõi (`AuthService.secondStep`: khoá hàng, `weighSecondFactor`,
  `finishPendingLink`). Mail `new_login`: tài khoản có bất kỳ `refresh_tokens` nào trước lần này (hàng không bao giờ
  bị xoá) thì báo, trừ lượt `reclaim` (đã gửi `reclaimed`); tài khoản vừa tạo không báo. Thiết bị trong mọi mail của
  cửa native là "nhãn (nền tảng[, deployment khi không phải default])" thay user-agent HTTP. Google native:
  `auth.DiscoverGoogle` chạy discovery một lần cho cả web và app; verifier native thêm `iat` không quá 1 phút ở tương
  lai; code flow web giờ từ chối `azp` khác client web (token app không mở cửa web); config từ chối khởi động khi
  `GOOGLE_CLIENT_ID` nằm trong `GOOGLE_NATIVE_CLIENT_IDS`. Token nhà cung cấp sai ở cửa công khai → `401
  provider_token_invalid`; ở lệnh của người đã đăng nhập (`/me/sign-in-methods/*/native`, step-up) → `403`.
  `/me/sign-in-methods/{google,apple}/native` kiểm theo thứ tự: bearer của app (trình duyệt → `400
  invalid_request`), email đã xác minh (`403 email_unverified`), step-up (`401`/`403 proof_required`), rồi token
  (`403 provider_token_invalid`); `move`, `taken`, `already_linked` là của `attachIdentity`; audit `via: settings`.
  Liên kết vé native (`/auth/native/sign-in-ticket/link`) nhận thêm `step_up_token` như vé web. Step-up nhận token
  Google của app khi verifier native được cấu hình (`AuthService.SetGoogleNative`, thay hook `SetGoogleProofVerifier`
  của lát 3). Chưa có `DELETE` vé native: token Apple trong một vé app bỏ dở không được trả lại Apple.

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
  chính lệnh đó cấp thì qua. (Phản biện lát 5) Token **cùng giây** với dấu có thể là phiên lệnh đó cấp hay một phiên lệnh
  đó vừa kết thúc, nên phải còn phiên sống (`bearerAfterMark`). Cổng email đã xác minh (`requireVerifiedEmail`: hoàn tất
  onboarding, lập tổ chức, mời, xem và nhận lời mời) xét token web của chính người gọi theo cùng luật: thu hồi xác minh
  địa chỉ, nên token sót lại của kẻ chiếm trước không mở được thứ chỉ địa chỉ đã xác minh mới mở. Middleware bearer đặt token đã kiểm (kèm `iat`) vào context, nên không thêm lượt đọc DB cho
  mọi request; helper `requireCurrentCredentials` đọc hàng `users` của chính chủ token. Token native không xét ở đây
  (thu hồi thì phiên thiết bị chết, middleware đã chặn); không có token trong context (job, test gọi thẳng service) thì
  không có gì để xét. Đồng ý desktop và MCP dùng nó từ lát 1.
- ⚑ (phản biện lát 5) Link reset trên tài khoản đã xác minh cũng đánh dấu `credentials_revoked_at` (trước khi đặt mật
  khẩu, nên phiên reset cấp mang dấu) và huỷ lượt đồng ý desktop/MCP đang mở (kể cả đã duyệt mà chưa đổi mã), đếm vào
  audit `auth.session_revoked {reason:"password_reset", desktop_attempts_cancelled, mcp_attempts_cancelled}`. Đồng ý
  desktop/MCP còn đòi phiên của bearer còn sống (`requireLiveBearer`): access token của phiên đã đăng xuất, bị "đăng
  xuất phiên khác", đổi mật khẩu, reset hay thu hồi không đổi được phút cuối thành phiên thiết bị hay grant.
  `TestAResetLinkEndsWhatTheOldPasswordLetIn`.
- Lát 3 (server): `step_up.go` là chỗ duy nhất kiểm bằng chứng của người đã đăng nhập, gồm cả bằng chứng cũ app đã
  phát hành gửi. Token là blob `step_up` `{uid, sid, web, method, iat, exp}`; không tiêu khi dùng (một token dùng cho
  mọi lệnh trong 10 phút). ⚑ (phản biện lát 5) Trừ token mua bằng mã email: blob mang thêm `action` của mã và chỉ dùng
  cho lệnh của việc đó (`set_password`/`change_password` cho `PUT /me/password`, `link_<p>` cho liên kết từ Cài đặt,
  app hay vé, `unlink_<p>`, `enable_mfa`, `delete_account`, `transfer_ownership` cho chuyển quyền và chuyển tổ chức);
  lệnh khác → `403 proof_required`, vì mail đã nói mã chỉ cho phép việc đó. Mật khẩu, TOTP và token nhà cung cấp vẫn
  mua token dùng cho mọi lệnh. `TestStepUpCodeNamesItsActionAndIgnoresTheDevCode`. Bằng chứng sai đếm vào `second_factor_failures` như MFA (`weighProof`); provider token sai
  (chữ ký, nonce, subject khác, `iat` quá 5 phút) → `403 provider_token_invalid` (mã spec chưa nêu). `proof_required`
  mang `fields.proofs`. Bằng chứng provider chỉ có trong `proofs` khi server kiểm được: Apple từ khi `SetApple`, Google
  khi lát 5 gọi `SetGoogleProofVerifier`. Mã email: purpose `step_up` + `action`, 10 phút, 5 lần thử, `429
  rate_limited` + `retry_after` khi gửi lại < 60 s hay quá 5 mã/24 h; dọn mã hết hạn giữ hàng `step_up` một ngày cho
  cổng 5 mã; tài khoản bật MFA không xin được mã (`proof_required`, proofs `[totp]`). Lệnh dùng token kiểm theo thứ
  tự: `credentials_revoked_at` (401), phiên của bearer còn sống (401), rồi token (403). Bật MFA: kiểm email đã xác
  minh và MFA chưa bật trước, rồi mới đòi token. Tắt MFA cũng qua khoá bước hai.
- Lát 3: `PUT /me/password` nhận `step_up_token` thay `current_password` cả khi đã có mật khẩu. `PUT /me/password`,
  liên kết và gỡ dùng `SignInMethodsService` (`service/sign_in_method_commands.go`; `sign_in_methods.go` giữ phần
  dùng chung và lệnh liên kết từ vé). Gỡ một nhà cung cấp chưa liên kết → 200 trạng thái hiện tại, không ghi gì.
  Liên kết từ Cài đặt bằng bearer của app → `400 invalid_request`. Kết quả `taken`/`movable` kèm `masked_email`;
  `movable` để lại cookie vé (`link_required`) để Cài đặt xác nhận chuyển bằng `POST /auth/sign-in-ticket/link
  {move:true}` mà không đi Google lần nữa; route vé nhận `step_up_token` thay cho phiên mới hơn vé. ⚑ Vé `movable` niêm
  thêm tài khoản và phiên trình duyệt đã bắt đầu liên kết (`link_uid`, `link_sid`, `issueMoveTicket`): phiên đó đã mua
  step-up `link_<p>` để bắt đầu, và start lẫn callback của nhà cung cấp đều giữ trình duyệt đúng phiên đó, nên chính
  phiên ấy xác nhận chuyển không cần bằng chứng lần hai (token step-up chỉ ở bộ nhớ nên mất sau vòng qua nhà cung cấp).
  Chỉ tới hạn của chính token step-up đó (tối đa 10 phút từ lúc cấp, `link_token.proof_exp` → vé `link_proof_exp`),
  không lâu hơn bằng chứng đã cho, dù vé còn sống tới 15 phút. Quá hạn đó, phiên khác, vé không niêm phiên hay không
  niêm hạn thì như mọi lệnh vé (`403 proof_required`, Cài đặt hỏi bằng chứng rồi gửi lại); vé hết hạn →
  `sign_in_ticket_missing`. `TestASettingsMoveIsProvedByTheSessionThatStartedTheLink`.
  `POST /me/sign-in-methods/apple/link` để lát 4 (cần Apple web); `/me/sign-in-methods/{google,apple}/native` để
  lát 5. Đổi mật khẩu và gỡ: audit `auth.session_revoked {scope:"others", reason:"password_changed" |
  "sign_in_method_unlinked", count, device_sessions, mcp_grants_revoked}`.
- Lát 3, bằng chứng cũ (xem lại 2027-01-31, `TestLegacyProofDoorsAreReviewed`): `POST /me/delete` không có token thì
  đọc đúng một bằng chứng như trước (mật khẩu nếu có, không thì mã MFA, không thì gõ lại email), mật khẩu và mã qua
  khoá bước hai; chuyển quyền và chuyển tổ chức còn nhận `password` vì app đã phát hành gửi nó trong luồng xoá tài
  khoản. Không có gì → `403 proof_required` (thay `password_required`).

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

- `PUT /me/password`: có mật khẩu và **không** bật MFA → `current_password` là bằng chứng (không cần token, nhưng phiên
  của bearer phải còn sống: `401 invalid_token`); chưa có mật khẩu, hay ⚑ (phản biện lát 5) bật MFA → `step_up_token`
  (bật MFA thì `proof_required` với proofs `[totp]`: "bật hai lớp thì chỉ yếu tố đó", ADR 0049 §5).
- ⚑ (phản biện lát 5) Mọi lệnh phương thức đăng nhập (`PUT /me/password`, liên kết từ Cài đặt/app/vé, gỡ, bật MFA) xét
  lại bearer **dưới khoá hàng `users`** (`requireBearerUnderLock`: dấu `credentials_revoked_at`, phiên còn sống;
  liên kết từ trình duyệt xét lại cookie refresh): thu hồi, đổi mật khẩu, reset và gỡ khoá hàng đó trước khi thu hồi,
  nên lệnh đã qua cổng trong lúc chúng đang chạy không ghi được vào tài khoản sau đó. Lệnh vé và gỡ chạy cả cổng sau
  khoá; đặt mật khẩu bằng mật khẩu hiện tại còn đòi hash đã chứng minh vẫn là hash đang lưu.
  `TestSignInMethodCommandsJudgeTheBearerUnderTheLock`.
- ⚑ (phản biện lát 5) Phiên mới không sinh vào tài khoản đang bị thu hồi: mở phiên (web `openSession`, app
  `NativeSignInService.open`, route Apple cũ) giữ hàng `users` `FOR SHARE` tới khi commit (`GetUserForShare`) và từ
  chối (`401 invalid_credentials`) khi tài khoản đã xoá hay `credentials_revoked_at` đổi từ lúc bước đầu đọc hàng
  (mật khẩu đúng nhưng thu hồi/đổi mật khẩu vừa commit). `POST /auth/refresh` thành một giao dịch: giữ hàng, đọc lại
  token dưới khoá (thu hồi vừa commit thì token đã chết), rồi xoay. Thu hồi khoá `FOR UPDATE` trước khi thu hồi, nên
  hoặc nó chờ phiên mới rồi thu hồi luôn, hoặc phiên mới thấy nó. `TestSessionsOpenedDuringARevocationDoNotOutliveIt`.
- ⚑ (phản biện lát 5) Dấu `credentials_revoked_at` lấy **đồng hồ của server** (giây của `time.Now()`, đồng hồ đóng `iat`
  của mọi token), không lấy `now()` của Postgres (không đổi sang `clock_timestamp()` như phản biện gợi ý): hai đồng hồ
  lệch nhau (Postgres trong Docker chạy trước vài chục ms) thì dấu đặt sát lúc đổi giây mang giây sau, và phiên chính
  lệnh đó giữ lại, refresh ngay sau, bị coi là cũ hơn dấu. Không phiên nào khác sinh được giữa dấu và commit nữa (khoá
  hàng ở trên). `TestTheCredentialMarkIsTheServersSecond`.
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
- Lát 3: ba bucket ở `router/sign_in_budgets.go`, mỗi cái dưới trần 600/phút/địa chỉ (`*-ip`). Email đọc từ body
  (tối đa 8 KiB, trả lại nguyên body cho handler), chuẩn hoá như login rồi băm; token MFA kiểm chữ ký, từ body hay
  cookie `uniwork_mfa`; không đọc được thì khoá theo địa chỉ. `/auth/login` và `/auth/mfa/verify` ra khỏi limiter
  chung 300/phút/địa chỉ (như refresh native), không thì trần 600 không bao giờ tới. Lát 5 gắn `budgets.password` /
  `budgets.mfa` vào `/auth/native/password`, `/auth/native/mfa` và thêm hai đường đó vào danh sách bỏ qua.

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

> **Trạng thái:** in-progress — phần web (4.1–4.6) đã có trên nhánh `feature/auth-unified-sign-in`, có unit test;
> e2e của 4.6 đã xanh trên bản build production ở máy, trừ các ca thêm sau vòng phản biện (no-shift 375 px của
> `/auth/continue`, "Về trang đăng nhập" khi hết hạn), chưa chạy. Chỉ ghi shipped sau khi PR merge.

### 4.1 Nút nhà cung cấp ⚑

`packages/views/auth/social-sign-in.tsx` thay `google-button.tsx`, dùng ở đăng nhập và đăng ký, đặt **trên** form như
mobile (cùng thứ bậc ở mọi nền tảng): các nút nhà cung cấp, rồi vạch "hoặc dùng email", rồi form. Một `<a>` cho mỗi
nhà cung cấp bật, Google trước Apple (thứ tự của Android; nhãn nhóm "Đăng nhập bằng Google hoặc Apple" giữ nguyên khi chỉ
còn một nút), pill `buttonVariants({variant:'outline',size:'lg'})` + `AUTH_PILL`; Apple: sáng = trắng viền, tối =
`dark:bg-foreground dark:text-background` (trắng chữ đen, đúng HIG). Placeholder vô hình giữ đúng chỗ của tối đa hai nút
và vạch khi `/auth/providers` đang tải (không nhấp nháy skeleton; form không dịch khi nút tới). `AppleMark`
(`fill="currentColor"`) trong `packages/views/common/provider-icons.tsx`.
`paths.appleStart({next, intent})` cạnh `paths.googleStart`. Đăng ký truyền `intent=sign_up` và giữ `next`; link qua
lại giữa đăng nhập và đăng ký giữ `next`. Playwright: nút nhà cung cấp là link nên vẫn chỉ có một *button* "Đăng nhập"
trên `/login`, một "Đăng ký" trên `/register`. Ô đầu của form chỉ nhận focus khi nó là cách vào duy nhất (không nhà cung
cấp nào bật, `useFocusWhenFormIsTheOnlyWay`); có Google hay Apple ở trên thì trang bắt đầu từ đầu, để bàn phím và trình
đọc màn hình gặp các nút đó trước.

Trong shell UniChat desktop, `/login` là màn chào (`apps/web/platform/unichat-login-gate.tsx`) với cùng thứ bậc: "Tiếp
tục với Google", "Tiếp tục với Apple" (cờ `google`, `apple_web`; cùng mặt pill qua `ProviderPillFace` và
`providerPillClass`), vạch "hoặc", rồi "Tiếp tục với email": cạnh nhà cung cấp nó cũng là pill viền (ba cách vào nặng
như nhau, Apple không bao giờ trông yếu hơn một lựa chọn khác, đúng HIG); khi đứng một mình nó là nút chính. Đây là *nút* gọi
`bridge.session.login({provider})`, không phải link: shell chạy PKCE trong trình duyệt hệ thống với `provider` (3.5), nên
trình duyệt đi thẳng tới nhà cung cấp; email mở trang đăng nhập UniWork. Kênh `session:login` chỉ nhận không gì hoặc đúng
`{provider: "google"|"apple"}`; shell đã cài trước đó bỏ qua tham số và mở trang đăng nhập. Bấm lại cùng cách khi trình
duyệt còn mở thì mở lại đúng trang đó; cách khác là lượt mới, tab cũ gọi về bị bỏ. Đang chờ: bước 1 nêu nhà cung cấp
("Trình duyệt đã mở trang đăng nhập Apple"), focus về "Mở lại trình duyệt"; "Hủy" trả focus về nút đã bấm. Cửa sổ thấp hơn
760px bỏ danh sách tính năng và thu nhỏ biểu tượng để mọi cách vào nằm trong màn hình (cửa sổ tối thiểu 600px, cả trang là
vùng kéo cửa sổ).

### 4.2 Lỗi và `next` qua các cổng ⚑

- Một bảng mã → khoá i18n `auth.social.errors.<mã>` thay `GOOGLE_ERRORS`/`replace("google_", "")`; mã lạ bị bỏ qua.
  Alert cấp form, trên các nút nhà cung cấp: người dùng tự hủy ở nhà cung cấp (`google_denied`, `apple_denied`) là
  `Alert` muted `role=status` có biểu tượng `Info` (không có thì dải xám rộng bằng ô nhập trông như một ô chỉ đọc), mã khác là
  `destructiveSoft` `role=alert`. `AuthCallbackView` nói "Đang đăng nhập…"; tới
  đó mà không có phiên → `/login?error=sign_in_failed`.
  `reclaimed=1` → toast một lần "Đã lấy lại tài khoản. Mật khẩu cũ, đặt khi email chưa được xác minh, đã bị xóa."
- `next` sống qua `/verify` và `/onboarding`: trang đăng ký, xác minh và onboarding đọc và chuyển tiếp `next`, rồi đi
  tới nó sau cổng. `/auth/desktop/authorize` và `/auth/continue?step=link` được đi thẳng kể cả khi còn cổng (app đã xử lý
  tài khoản chưa có workspace). Tài khoản chưa onboard có lời mời đang chờ: `next` thắng `/invitations`
  (`resolveLoggedInDestination`). Callback không có phiên về `paths.login({error: 'sign_in_failed', next})`. `/invitations` và `/get-started` đưa người
  chưa đăng nhập tới `/login?next=` chính trang đó (điện thoại mở chúng trong trình duyệt thường chưa có phiên web).
- **Gợi ý nhà cung cấp của app (3.5)**: `/auth/desktop/authorize` gửi người chưa đăng nhập tới `paths.login({next,
  provider})`; `next` không mang `provider`, nên đăng nhập xong không lặp lại. `/login?provider=` gỡ tham số khỏi URL
  trước (history replace) rồi `location.replace` **một lần** tới `start` khi cờ (`google`, `apple_web`) bật; màn chờ là
  "Đang đăng nhập…" của `AuthCallbackView`, cùng mặt phẳng trước và sau nhà cung cấp. Mã nằm ở
  `apps/web/platform/auth/provider-handoff.tsx` (`providerHint`, `useDropProviderHint`, `ProviderHandoff`), vì
  `packages/views` không được chạm `location`.
- **Trang đồng ý** (`/auth/desktop/authorize`): không có eyebrow; tiêu đề nêu nền tảng và hàng thiết bị có biểu tượng
  `Monitor`/`Smartphone`. Nút nêu app nó cho vào, "Cho phép {{app}}", trên mọi nền tảng. Bấm cho phép thì trang mở callback của app ngay (`location.assign`, cú bấm còn là cử chỉ mà
  custom scheme cần): app desktop chỉ nhận mã qua deep link và sheet của điện thoại chỉ đóng khi gặp nó, nên không có
  bước "quay lại" nào người phải tự làm. Mỗi kết quả là cuối của lượt đó và có tiêu đề theo điều đã xảy ra: "Đã cho
  phép {{app}}" ("Nếu {{app}} chưa mở, bấm "Mở {{app}}"."; tải lại mà không còn callback thì "Quay lại {{app}} để tiếp
  tục."), "Đã hủy đăng nhập", "Yêu cầu đã hết hạn" ("Quay lại {{app}} và thử lại."), "Chưa hoàn tất được đăng nhập"
  (kèm "Thử lại", kết quả duy nhất có nút này). Trang giữ lượt đọc gần nhất, nên thử lại mà gặp 410 vẫn nêu đúng app và
  nền tảng; lượt chưa từng đọc được thì nói trung tính ("Quay lại ứng dụng và thử lại."), không đoán sản phẩm hay thiết
  bị. "Bạn có thể đóng tab này." chỉ cho lượt desktop; sheet đăng nhập của điện thoại không có tab, nên đã hủy và hết hạn
  nói "Đóng trang này để về {{app}}.". Đã cho phép có thêm "Mở {{app}}" khi có callback. Không có "Quay lại" hay "Đóng"
  (chúng đưa người đã đăng nhập về `/login`). Lúc tải, khung xương dùng chính chữ mà trang nhiều khả năng sẽ có (tiêu
  đề của điện thoại khi con trỏ thô, nhãn các dòng, tên và email của tài khoản đang đăng nhập) và giữ 44px cho "Chi tiết"
  và "Dùng tài khoản khác", nên thẻ không nhảy khi lượt tới. Bước 3 của cổng UniChat: "UniChat mở lại và vào thẳng
  cuộc trò chuyện". "Không phải bạn?" rồi link "Dùng tài khoản khác" (spinner + "Đang đăng xuất…" khi đang chạy) đăng xuất, rồi
  trang đưa trình duyệt tới `/login` vẫn mang gợi ý nhà cung cấp của app.

### 4.3 Màn chọn `/auth/continue`

`apps/web/app/(auth)/auth/continue/page.tsx` → `packages/views/auth/continue-view.tsx` (trong `AuthShell`), builder
`paths.authContinue({next, step})` + mục trong `consistency.test.ts`.

Trạng thái và lời:

- **Đang tải**: skeleton đúng hình khối danh tính, các lựa chọn và dòng điều khoản dưới chúng, ở mọi độ rộng: tiêu đề,
  dòng mô tả và chữ của từng hàng là chữ khả năng cao sẽ hiện, vẽ thành "xương" (`SkeletonText`, chữ trong suốt trên nền
  muted, xuống dòng đúng chỗ chữ thật), dòng điều khoản là dòng thật (`inert` khi đang tải), "Hủy" giữ ô 44 px trên con trỏ
  thô. Trên điện thoại thẻ không nhảy khi vé tới.
- **Không có vé / hết hạn**: mở trang mà không có vé → "Lượt đăng nhập này đã hết hạn hoặc đã xong. Bắt đầu lại từ trang
  đăng nhập." + nút "Về trang đăng nhập" (`/login?next=`). Vé mất giữa một lệnh → "Lượt đăng nhập bằng {{provider}} đã
  hết hạn." + "Tiếp tục với {{provider}}" (bắt đầu lại nhà cung cấp đó, giữ `next`) và link "Về trang đăng nhập"; màn
  này thay màn người dùng đang thao tác nên tiêu đề nhận focus (`announce`). Quay lại bằng Back từ trang nhà cung cấp
  (bfcache) thì đọc lại vé thay vì đứng ở "Đang đăng nhập…".
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
- **Đang gửi** (mọi lựa chọn): nút bận `aria-busy`, các lựa chọn khác `aria-disabled`; "Tạo tài khoản mới" thay dòng của
  nó bằng "Đang tạo tài khoản…" và nói điều đó qua một `role=status`.
- **Lỗi** `409 sign_in_account_conflict` → màn thành bố cục `link_required` ("Email này đã có tài khoản UniWork", một nút
  "Đăng nhập để liên kết"; tiêu đề mới nhận focus), không còn hàng "Tạo tài khoản mới" chỉ gặp lại cùng câu trả lời; `429` → câu của bảng lỗi + "Thử lại sau {{count}} giây/phút/giờ." (`retryPhrase`; mã gửi qua email mà
  hết lượt thì "Đã tạm dừng mã xác nhận cho địa chỉ này.", ngân sách của route thì "Bạn đã thử nhiều lần liền."); nút
  gửi lại đang chờ thì mờ và giữ (`AUTH_PILL_HELD`), quá một phút thì đọc "Gửi lại mã" và thông báo phía trên đếm phút/giờ;
  mạng/5xx → "Không kết nối được. Kiểm tra mạng rồi thử lại." có nút thử lại.
- **Đã đăng nhập sẵn** (có phiên): thay ba lựa chọn bằng "Liên kết {{provider}} với {{account}}" (→ `step=link`) và
  "Dùng tài khoản khác" (đăng xuất rồi về màn chọn). Đăng xuất xoá vé (3.2), nên "Dùng tài khoản khác" đăng xuất rồi đi
  lại `start` của chính nhà cung cấp đó (giữ `next`): nhà cung cấp hỏi lại một lần và màn chọn quay về, chưa đăng nhập,
  với vé mới. Phiên đã có từ trước vé, nên `step=link` từ đây gặp `403 proof_required` (3.2) và cần hộp bằng chứng.
- Nút phụ "Hủy" → `DELETE /auth/sign-in-ticket` → `/login?next=` (đã đăng nhập thì đi thẳng tới `next`).
- Sau khi lệnh đã mở phiên (vé đã tiêu), màn hình là "Đang đăng nhập…" của callback cho tới khi trang chuyển, không bao
  giờ loé "hết hạn". Đọc vé lỗi (mạng/5xx) → "Chưa tải được lượt đăng nhập" + câu của bảng lỗi + "Thử lại".
- **`step=link`** (đã đăng nhập): **không tự ghi khi mở**. Hiện "Liên kết {{provider}} ({{provider_email}}) với
  {{account_email}}?" + nút "Liên kết" và "Không liên kết". Dòng dưới tiêu đề là `role=status`: câu hỏi khi "Liên kết"
  còn trả lời được; trong bước chuyển (tiêu đề của nhóm đã hỏi) là "Bạn đang đăng nhập bằng {{accountEmail}}."; sau lỗi cuối
  là "Chưa liên kết {{provider}} với {{accountEmail}}.". Lỗi làm mất nút vừa bấm (lỗi cuối, phiên kết thúc) đưa focus tới
  nút còn lại ("Tiếp tục", hay "Đăng nhập để liên kết"). Thành công → `role=status` "Đã liên kết {{provider}}. Lần sau
  chỉ cần {{provider}}.", khối danh tính có dấu kiểm (`CircleCheck`, tông success) + nút "Tiếp tục" được focus (không
  tự chuyển trang). Tải lại sau khi xong mà vé đã hết → coi như đã xong. `sign_in_method_movable` → nhóm có tiêu đề
  "Chuyển {{provider}} sang tài khoản này?" (câu hỏi chỉ hỏi một lần), câu "Tài khoản {{provider}} này đang được dùng cho
  tài khoản trống {{masked}}." và ghi chú tài khoản trống sẽ bị xóa + "Chuyển sang đây" / "Không chuyển" (cùng cặp với
  Cài đặt; "Chuyển sang đây" gửi `move: true`; chuyển gặp lỗi thử lại được (mất mạng, 5xx, phải chờ) thì câu hỏi và cặp nút
  vẫn ở đó, bấm lại là gửi lại `move: true`). `taken` → "Tài khoản {{provider}} này đang được dùng cho {{masked}}.
  Đăng nhập vào đó và gỡ liên kết trước." Mọi lỗi
  vẫn có "Tiếp tục". Chưa đăng nhập mà vé còn → `/login?link=1&next=<bước này>`; không còn vé → "Đã xong" + "Không còn
  gì để liên kết. Tiếp tục vào UniWork." `proof_required` → hộp bằng chứng cho `link_<provider>` (4.5) trên các cách
  `fields.proofs` nêu, rồi gửi lại một lần; đóng hộp thì câu hỏi giữ nguyên, bấm "Liên kết" là hỏi lại. Phiên đã kết
  thúc (`invalid_token`) → "Đăng nhập để liên kết" (phiên mới hơn vé thì liên kết được).

### 4.4 Chế độ liên kết trên `/login`

`?link=1`: `Alert` thông tin trên form: "Đăng nhập vào tài khoản UniWork của bạn để liên kết {{provider}}
({{email}})." + nút "Không liên kết" (xoá vé, bỏ `link`). Nút của chính nhà cung cấp đang chờ bị ẩn (không lặp). Mọi
cách còn lại (mật khẩu, nhà cung cấp kia, MFA) giữ `next`. Bước MFA có phụ đề "Đăng nhập vào {{email}} để liên kết
{{provider}}". `next` là bước liên kết cũng là chế độ liên kết (quy tắc `keepsSignInTicket` của server): nhà cung cấp kia
gặp MFA thì server trả về `/login?mfa=1&next=<bước liên kết>` không có `link=1`, và mã vẫn giữ vé. Nhà cung cấp kia
cũng không thấy tài khoản nào thì vé đang chờ không bị thay: server bỏ vé mới (đồng ý của Apple trả lại Apple) và về
`/login?error=<google|apple>_no_account&next=<bước liên kết>`, "Chưa có tài khoản UniWork nào đăng nhập bằng tài khoản
Apple này. Đăng nhập bằng cách bạn vẫn dùng.", banner vẫn nêu nhà cung cấp đang chờ. "Quên mật khẩu?" giữ
`next`. Link reset trong mail không mang `next`; ở chế độ liên kết, trang quên mật khẩu nhớ (qua `StorageAdapter`, 15 phút
như vé) địa chỉ đã gửi reset. Chỉ khi có điều đó trang reset mới hỏi `GET /auth/sign-in-ticket`, chờ câu trả lời rồi mới
gửi (bấm sớm thì chờ), gửi `keep_sign_in_ticket` khi còn vé, và chỉ về `/auth/continue?step=link` khi reset mở đúng địa
chỉ đó; địa chỉ khác thì xoá vé và đi tiếp như reset thường. Bật MFA thì `/login?mfa=1&reset=1&link=1&next=` bước đó, và
trang đăng nhập so địa chỉ đó với tài khoản mà mã mở, như trang reset: khác thì xoá vé và đi tiếp qua bước liên kết. Điều
đã nhớ bị quên khi reset xong (cả nhánh MFA), khi đăng xuất, và khi đọc thấy nó quá hạn hay hỏng. Không có điều
đó thì trang reset không đọc, không giữ vé nào: vé người khác bỏ lại trong trình duyệt không bao giờ được liên kết. Vé `link_required` điền sẵn email của tài khoản
(trừ email ẩn của Apple) và đưa focus tới mật khẩu. "Đăng ký" ở chế độ này đi tới `next` của bước liên kết, vì đăng ký
xoá vé.

### 4.5 Cài đặt › Phương thức đăng nhập

`packages/views/settings/components/security-sign-in-methods.tsx`, section đầu của `SecurityTab` (cả `SettingsPage` và
`ChatSettingsPage`). ⚑ Trang `/settings` (slug đã giữ chỗ, có trong `GLOBAL_PREFIXES`) cho mọi người: có workspace
(`homeWorkspace`: workspace vào gần nhất, không thì cái đầu) → chuyển tới `/{org}/{ws}/settings` giữ nguyên query (`tab`,
`expect_user`, kết quả liên kết); chưa có, hay còn cổng → trang cấp tài khoản (`PageHeader` "Cài đặt tài khoản" + nút
quay lại `/workspaces` + `SecurityTab`); chưa đăng nhập → `/login?next=` trang này. Builder `paths.accountSettings()`
và `paths.securitySettings({expectUser})`.

Tiêu đề "Phương thức đăng nhập", mô tả "Cách bạn đăng nhập UniWork trên web, máy tính và điện thoại." Ba hàng
(`SettingsListItem`, ô 32 px):

| Hàng | Meta | Huy hiệu | Hành động |
|---|---|---|---|
| Mật khẩu (`KeyRound`) | email đăng nhập · "Đổi lần cuối ngày {{date}}" / "Đặt mật khẩu để đăng nhập bằng email" | Đã đặt / Chưa đặt | Đổi mật khẩu / Đặt mật khẩu |
| Google (`GoogleMark`) | email · "Đã liên kết ngày {{date}}" / "Đã liên kết" | Đã liên kết | Gỡ liên kết / Liên kết |
| Apple (`AppleMark`) | email hay "Email ẩn của Apple" · ngày | Đã liên kết | Gỡ liên kết / Liên kết |

- Hàng hẹp (điện thoại) xếp email và ngày thành hai dòng thay vì cắt ngày sau dấu "…"; hàng rộng giữ "email · ngày".
- Nhà cung cấp chưa liên kết mà deployment không bật thì ẩn hàng (`webSignInProviders`: `google`, `apple_web`). Đang
  tải: skeleton đúng hình hàng (trên điện thoại cũng xuống dòng như hàng thật); đọc lỗi: `SettingsLoadError` + "Thử lại", không bao giờ hiện "Chưa đặt" thay cho lỗi.
- Gỡ phương thức cuối: `aria-disabled` + `SettingsRowReason` "Đây là cách đăng nhập duy nhất. Đặt mật khẩu hoặc liên kết
  cách khác trước." Gỡ Apple của tài khoản relay: "Email tài khoản của bạn là email ẩn của Apple, nên không gỡ liên kết Apple được."
- **Hộp bằng chứng** (`step-up-proof.tsx`, dùng chung cho mọi lệnh nhạy cảm, kể cả bật MFA, xoá tài khoản, chuyển
  quyền): theo `proofs` — ô mật khẩu (kèm "Quên mật khẩu?" và nút hiện mật khẩu), ô "Mã từ ứng dụng xác thực", hay "Gửi mã
  tới {{email}}" + sáu ô mã như màn chọn (gửi khi đủ chữ số thứ sáu, "Xác nhận" vẫn còn cho bàn phím); có "Dùng cách khác" khi có hơn một cách. Gọi `/me/step-up` trước, giữ `step_up_token` trong bộ nhớ 10 phút
  (lệnh tiếp theo trong cửa sổ đó không hỏi lại; token mua bằng mã email chỉ dùng cho đúng việc đó, nên dòng gợi ý theo
  cách xác nhận: `stepUpWindowHintKey`). Hạn tính theo đồng hồ máy, trừ biên, nhưng token giữ ít nhất 60 s kể từ lúc mua
  (`STEP_UP_FIRST_USE_MS`), cho mọi lệnh chứ không chỉ lệnh đã mua nó: đồng hồ lệch hay mạng chậm không vứt token vừa
  mua; server vẫn quyết, token chết chỉ tốn một vòng `proof_required`. Hộp mở với focus ở ô của cách xác nhận (hay nút "Gửi mã tới…"), không ở link
  "Quên mật khẩu?" đứng trước ô; "Dùng cách khác" rộng hết hàng khi chân hộp xếp dọc trên điện thoại. Lỗi dưới ô,
  focus trả về ô. Mã email: trước khi gửi, nút "Gửi mã tới {{email}}"
  là hành động duy nhất của hộp (chân hộp chỉ còn "Hủy"); gửi rồi thì "Đã gửi mã tới…", ô mã và "Gửi lại sau {{count}}
  giây". Lệnh gọi qua `useStepUpGate().run({action, command})`: có token phục vụ thì chạy luôn, không thì mở hộp; bị
  `proof_required` thì mở lại hộp trên `fields.proofs` và chạy lại một lần. Lệnh tự mang bằng chứng (đổi mật khẩu bằng
  mật khẩu hiện tại, xác nhận chuyển từ đúng phiên đã liên kết) dùng `upfront: false`: chỉ hỏi khi server đòi. Hộp mở
  từ trong một hộp khác thì nằm lồng trong hộp đó. Lúc danh sách bằng chứng còn tải, hộp vẽ cách mà `proofChoice` đoán
  từ phiên (nhãn, ô, gợi ý) bằng chữ khung xương, chân hộp đã có "Xác nhận" (giữ) và "Dùng cách khác". Mã email chỉ
  bị xoá khi server từ chối nó; mất mạng, 5xx hay phải chờ thì mã còn nguyên để "Xác nhận" gửi lại.
- "Quên mật khẩu?" trong hộp bằng chứng và "Đổi mật khẩu" (`ForgotPasswordLink`) mở
  `/forgot-password?next=<trang cài đặt>?tab=security`, ô email điền sẵn địa chỉ của tài khoản đang đăng nhập; trong
  shell UniChat thì mở trang đó ở trình duyệt (`bridge.openExternal`), cửa sổ chat giữ nguyên.
- **Đặt/Đổi mật khẩu** (`FormDialog` md): mọi ô mật khẩu có nút hiện/ẩn (`PasswordField size="form"`); đổi = mật khẩu
  hiện tại (kèm "Quên mật khẩu?" trên hàng nhãn, hộp mở với focus ở ô) + mới, ghi chú "Các thiết bị khác sẽ đăng xuất."; đặt
  = bằng chứng + mới + "Bạn sẽ đăng nhập bằng {{email}}" (relay có nút sao chép). Bằng chứng của "đặt" hỏi khi bấm
  "Lưu mật khẩu" (hộp lồng). Tài khoản bật MFA, hay đang giữ token, thì "đổi" không hỏi mật khẩu hiện tại (server
  không nhận nó làm bằng chứng khi bật MFA). Thành công: ghi user, toast.
- **Liên kết** (web): bằng chứng → `POST …/link` → `window.location.assign(authorization_url)`. Quay lại với
  `?sign_in_method=&result=`: toast theo kết quả, xoá tham số khỏi URL. `denied` (người dùng dừng ở nhà cung cấp) là toast
  thông tin, không phải lỗi: "Bạn đã dừng giữa chừng, {{provider}} chưa được liên kết." `movable` mở hộp xác nhận chuyển
  chỉ khi `GET /auth/sign-in-ticket` xác nhận một vé `link_required` của đúng nhà cung cấp đó (không có thì "Chưa liên kết
  được {{provider}}. Thử lại."), và email đã che từ URL chỉ được hiện khi đúng dạng server che (`urlMaskedEmailOf`). Back
  từ trang nhà cung cấp (bfcache) trả hàng về nút "Liên kết".
- **Gỡ liên kết**: bằng chứng trước, rồi `ConfirmDialog` destructive (ô `Unlink`), nói còn lại cách nào và "Các thiết bị
  khác sẽ đăng xuất."
- **Chuyển** (`result=movable`): `ConfirmDialog` (ô `ArrowRightLeft`, tông cảnh báo) "Chuyển sang đây" / "Không chuyển";
  "Không chuyển" xoá vé. Chính phiên đã bắt đầu liên kết xác nhận được mà không hỏi bằng chứng lần hai khi bằng chứng
  đã cho bắt đầu còn hạn (3.7); quá hạn thì "Xác nhận là bạn" mở trước rồi lệnh chạy lại. Mất mạng,
  5xx hay phải chờ thì hộp vẫn mở và nói lý do trong hộp (`ConfirmDialog error`), bấm lại là thử lại; chỉ câu trả lời
  cuối (bị dùng, đã hết hạn…) mới đóng hộp kèm toast.
- **Shell UniChat desktop** (`getDesktopBridge()` có): "Liên kết trên web" (biểu tượng mở ngoài) mở
  `${appUrl}/settings?tab=security&expect_user=<id>` bằng `bridge.openExternal`; trang web thấy trình duyệt đăng nhập
  người khác thì cảnh báo "Trình duyệt đang đăng nhập {{other}}, không phải tài khoản bạn dùng trong UniChat." + "Đăng
  xuất" (về `/login?next=/settings?tab=security&expect_user=<id>`: không phải URL đang mở, vì `/settings` đã chuyển
  tài khoản kia sang workspace của nó, nơi tài khoản UniChat có thể không thuộc về). Cảnh báo nằm một lần ở đầu tab Bảo
  mật (`useOtherBrowserAccount`), và mọi lệnh của tab (các hàng đăng nhập, bật/tắt MFA, thu hồi phiên, xoá tài khoản)
  `aria-disabled`, mô tả bởi cảnh báo đó, cho tới khi hai tài khoản trùng. Trang web chỉ biết id của tài khoản UniChat, không biết email, nên câu không nêu
  `{{me}}`. Danh sách tải lại khi cửa sổ có focus (`bridge.onFocusChange`). Đổi mật khẩu và gỡ chạy tại chỗ.
- Bỏ (không chỉ sửa lời) ngõ cụt `org.transfer.reason_no_password`, `org.transfer.no_password`,
  `invitations.switch.no_password_reason` (cùng `org.transfer.reason_password`, `org.transfer.wrong_password`,
  `org.transfer.password_label`, `TransferPasswordField`, `passwordRefusal`): không lệnh nào trên web còn gửi mật khẩu
  làm bằng chứng. Mỗi lệnh nhạy cảm dưới đây chạy qua `useStepUpGate().run` / `ensure`:
  - **Bật MFA** (`enable_mfa`): địa chỉ đã biết là xác minh thì hỏi bằng chứng trước setup; không thì để server nói
    trước (setup xét địa chỉ trước bằng chứng): chưa xác minh → toast "Xác minh email của bạn trước, rồi bật xác thực hai
    lớp.", `proof_required` → hộp trên `proofs`. Xác nhận mã dùng token của setup (`upfront: false`); token hết hạn giữa
    chừng thì hộp hỏi lại và gửi đúng mã đã gõ. Bằng chứng bị từ chối không bao giờ thành toast "Không bắt đầu được thiết
    lập MFA" hay lỗi "Mã không đúng". Bước quét mã nhận focus ở ô mã.
  - **Xoá tài khoản** (`delete_account`): hộp destructive (`FormDialog`, nền tối hơn) hỏi câu hỏi kèm ba dòng (xoá gì,
    giữ gì, chủ sở hữu tổ chức thì sao), không có ô bằng chứng riêng. Server xét bằng chứng trước rồi mới xét chủ sở hữu
    (`409 owner_must_transfer` mang `organization_name`, `organization_slug`, `can_close`; core `ownedOrganization`):
    thành viên duy nhất → "Bạn là thành viên duy nhất của {{name}}, nên tổ chức sẽ được đóng cùng lúc với tài khoản." kèm
    hậu quả của việc đóng, gõ lại định danh, nút "Đóng tổ chức và xóa tài khoản" gửi `close_organization` (token của lần
    bấm đầu chứng minh luôn: một lần bằng chứng); còn thành viên khác → "Bạn là chủ sở hữu {{name}}, và tổ chức còn thành
    viên khác. Chuyển quyền sở hữu trong Cài đặt › Thành viên tổ chức, rồi quay lại xóa tài khoản." và chỉ còn "Đóng";
    `organization_has_members` lúc đóng → câu đó. Lỗi khác nói trong hộp, không toast. Mỗi lần mở lại bắt đầu từ câu hỏi.
  - **Chuyển quyền** (Cài đặt › Thành viên tổ chức, `transfer_ownership`): chọn người + gõ tên tổ chức; "Chuyển quyền"
    mở hộp bằng chứng lồng trong hộp chuyển quyền (trừ khi token còn phục vụ).
  - **Chuyển tổ chức khi nhận lời mời** (email hay link mời, `transfer_ownership`): bước xử lý chỉ chọn người nhận;
    "Chuyển sang …" mở hộp bằng chứng khi có bước chuyển quyền mà chưa có token, và `withTransferProof` gửi token.
    `proof_required` → hỏi lại một lần trên `proofs` rồi gửi lại; bị từ chối lần nữa → "Chưa gửi được yêu cầu chuyển tổ
    chức…", bấm lại thì hỏi lại. Người dùng luôn ở bước xác nhận, không bị đưa lùi bước.
- `auth.forgot.googleHint` nói cả Apple và mail "đặt mật khẩu" mới, và đứng trên form gửi link (dưới "Gửi link đặt
  lại", nơi "nhập email ở trên" đúng), không ở màn "Kiểm tra hộp thư": mail biến thể đã tự nói điều đó.

### 4.6 Test web

Unit: mỗi endpoint mới có ca response hỏng (trừ `createFromSignInTicket` và claim-email verify, thêm vào danh sách
"fail loudly" của `CLAUDE.md` cạnh login/register); `social-sign-in` (2 nút, placeholder, ẩn theo cờ, là `<a>`, giữ
`next`/`intent`); `continue-view`, `continue-link-step` (mọi trạng thái 4.3); `login-view`, `login-view.link` (chế độ
liên kết, ẩn nút đang chờ, bảng lỗi); `provider` tự chuyển một lần ở `apps/web/platform/auth/provider-handoff.test.tsx`
và `login-page.test.tsx` (phần đó sống ở `apps/web`, 4.2); `security-sign-in-methods`, `security-password-dialog` (mỗi
loại bằng chứng, cửa sổ step-up, phương thức cuối, relay, shell, kết quả trên URL); `/settings`
(`account-settings-view`, có/không workspace); `delete-account-dialog`, `transfer-ownership-dialog` và lời mời với bằng
chứng. `packages/views/step-up-gate.test.ts` giữ luật mọi lệnh gửi token step-up đi qua `useStepUpGate()`.
E2E (`/auth/providers` và `/auth/sign-in-ticket` stub bằng `page.route` qua `e2e/sign-in-page.ts`, giữ CORS của server):
`e2e/auth-providers.spec.ts` đo tương phản `/login`, `/register` và hai loại lỗi `?error=` ở hai chế độ màu, màu Apple
theo HIG (trắng chữ tối, dấu theo màu chữ), bố cục 1440/375 px và form không dịch khi nút tới;
`e2e/auth-continue.spec.ts` đo tương phản `/auth/continue` (unmatched Google, unmatched Apple email ẩn, `link_required`,
hết hạn) ở hai chế độ, email ẩn không bao giờ in thô, và vùng chạm 44 px ở 375 px. Năm spec onboarding không sửa.

## 5. Mobile (`apps/chat-mobile`)

> **Trạng thái:** in-progress — phần mobile (5.1–5.3) đã có trên nhánh `feature/auth-unified-sign-in`, có test vitest và
> jest; module Google, sheet Apple/Google và các flow Maestro chưa chạy trên máy hay trong một bản build native nào.
> Chỗ làm khác bản thiết kế ở 5.4.

### 5.1 Lớp dữ liệu

- Kết quả issuer: `{kind:"session", session} | {kind:"mfa", token, context} | {kind:"choice", ticket, nonce, identity,
  ticketKind}` (`ticketKind` là `unmatched` | `link_required`, như `SignInTicketKind` của core; `context` của bước hai là
  `{method, email, provider}`); bước hai giữ trong store chỉ-bộ-nhớ `data/auth/pending-sign-in.ts` (không persist,
  không thành route param); chỉ phiên đã có mới qua `loginWith`/`adoptIssued`. Tách `session.ts` trước khi thêm (đang 483 dòng).
- `LoginMethod` thêm `password | google | ticket | register | email_claim | second_factor` (mã của bước hai là bằng
  chứng khác bước một, nên có nhãn riêng); mật khẩu vào issuer bằng closure, không bao giờ nằm trong event/effect.
- Route, mã mới vào `Route`/`SERVER_CODES`; `scripts/mobile-route-catalogue`, `server-contract.test.ts` (+
  `HANDLER_FILES`, `mobile-native-scope.mjs`, `E2E_PATHS`), `COMMAND_MODULES`.
- Google: module Expo riêng `modules/unichat-google-sign-in` (bọc trong `data/auth/google.ts`, mock được trong vitest),
  không phải `@react-native-google-signin/google-signin`: bản miễn phí của gói đó không có nonce ở nền tảng nào (chỉ bản
  trả phí có), mà server bắt buộc nonce. Module gọi thẳng API có nonce của Google: GoogleSignIn 8 trên iOS, Credential
  Manager `GetSignInWithGoogleOption` trên Android; sheet nhận SHA-256 hex của nonce gốc; `pnpm-lock.yaml` không đổi.
  Client id từ biến build `UNICHAT_GOOGLE_IOS_CLIENT_ID`, `UNICHAT_GOOGLE_WEB_CLIENT_ID`, ghi vào Info.plist và manifest
  bằng `plugins/with-google-sign-in.js` (không qua `extra`: binary mang cấu hình của nó, OTA không làm lệch được). Đăng
  xuất Google trước khi liên kết (Google hỏi chọn tài khoản) và khi đăng xuất UniChat; thiếu client id hay không có Play
  Services → Google qua trình duyệt. Dấu "G" là ảnh qua `expo-image`.
- `webcredentials:${APP_LINK_HOST}` trong `associatedDomains`; AASA thêm `webcredentials.apps`, assetlinks thêm
  `get_login_creds` (`apps/web/platform/well-known.ts` + test) để AutoFill gợi ý mật khẩu đã lưu cho web; chỉ id prod
  `com.uniworkos.chat`, như `applinks`.
- Mỗi cửa gửi `locale` của app (3.6), đọc lúc gọi (`nativeClient` › `locale`), nên tài khoản cửa tạo và mail cửa gửi
  theo ngôn ngữ đang dùng trong app.

### 5.2 Màn hình

- **Đăng nhập** (`app/(auth)/login.tsx` chỉ ghép, thành phần ở `components/auth/`): dấu UniChat, "Đăng nhập UniChat",
  một dòng phụ; iPhone: nút Apple hệ thống (đen/trắng theo chế độ, bo tròn) rồi Google, hai nút một chiều cao theo cỡ
  chữ (48 ở cỡ mặc định, tới 1.6×: `providerButtonHeight`); Android: Google rồi Apple (pill trắng/đen có dấu Apple →
  PKCE `provider=apple`); vạch "hoặc dùng email"; ô Email
  (`textContentType="username"`, `autoComplete="email"`), ô Mật khẩu (hiện/ẩn, `textContentType="password"`),
  "Quên mật khẩu?" (mở `/forgot-password` trong trình duyệt), nút "Đăng nhập"; chân trang "Chưa có tài khoản? Tạo tài
  khoản" và nút chữ "Đăng nhập bằng trình duyệt". Bàn phím không che ô. Lỗi một dòng có biểu tượng, `role=alert`,
  `useAnnounce`. Đang bận: spinner có nhãn, nút khác mờ và bỏ qua chạm.
- **Hai lớp** (`mfa.tsx`): ô 6 số (`oneTimeCode`), tự gửi khi đủ, "Dùng mã khôi phục"; phụ đề "Đăng nhập vào {{email}}"
  (và "để liên kết {{provider}}" khi có); `429 second_factor_locked` → đếm ngược.
- **Màn chọn** (`continue.tsx`): như 4.3, thứ tự lựa chọn trên app: "Tôi được mời bằng email khác" và "Tôi đã có tài
  khoản" trước, "Tạo tài khoản mới" sau (app không tạo được tổ chức). Vé + nonce chỉ trong bộ nhớ; app bị tắt giữa
  chừng thì máy chỉ còn dấu `{provider, at}` không bí mật, và lần mở sau trong một giờ nói "Lượt đăng nhập bằng
  {{provider}} đã hết hạn." + "Thử lại" (lời của core, `auth.continue.expired.bodyProvider`).
- **Đăng ký** (`register.tsx`): tên, email, mật khẩu (`newPassword`) + Apple/Google với `intent=sign_up` → đăng nhập →
  **xác minh email** (trong `(app)`): ô 6 số, gửi lại có đếm ngược, "Sai email? Đăng xuất", link Cài đặt (xoá tài
  khoản). Chưa xác minh thì không vào danh sách workspace.
- **Chọn workspace khi rỗng**: liệt kê `GET /me/invitations` (tổ chức, workspace, người mời) + "Tham gia" →
  `POST /invitations/{token}/accept`; lời mời cấp tổ chức không kèm workspace → "Đã vào {{org}}. Quản trị viên sẽ thêm
  bạn vào workspace."; `409 organization_switch_required` → thẻ nói tham gia nghĩa là gì (`invitations.switch.description`
  của core + "Bạn hoàn tất việc chuyển tổ chức trên web, rồi quay lại UniChat.") và nút "Tiếp tục trên web" mở
  `/invitations` (không phải `/invite/…`, tránh universal link quay về app) trong trình duyệt: trình duyệt không tự
  trượt lên sau "Tham gia". Không lời mời: "Chưa có lời mời nào gửi tới {{email}}." + "Tạo tổ chức trên web"; tài
  khoản đã ở một tổ chức (đọc `GET /orgs`, ADR 0032) thì nhờ quản trị viên thêm vào workspace thay vì tạo tổ chức.
  Danh sách lời mời đọc không được là lỗi + "Thử lại", không phải `[]` (rỗng nghĩa là không ai mời). Deep link
  `/invite/{token}` giữ qua đăng nhập và mở màn xem trước (không tự nhận).
- **Phương thức đăng nhập** (`components/settings/sign-in-methods-section.tsx`, tab Cài đặt workspace và `/account`):
  cùng ba hàng, cùng luật; bằng chứng bằng sheet (mật khẩu / mã TOTP / mã email / Apple-Google lại); bằng chứng kiểm
  **trước** khi mở sheet nhà cung cấp. Liên kết Google: SDK → `google/native`; Apple trên iPhone: sheet →
  `apple/native`; Apple trên Android: mở `/settings?tab=security` trong trình duyệt. Đặt/đổi mật khẩu:
  `app/(app)/password.tsx`. Tải lại khi app về foreground.
- Xoá tài khoản và chuyển quyền trên app dùng step-up (bỏ `mobile.account.transfer_password_needed`).

### 5.3 Cổng và tài liệu mobile

Chuỗi qua `t()`; dùng chung lời web qua `PATHS` của `sync-i18n.mjs` (`auth.social`, `auth.continue`, `auth.apple`,
`settings.security.signInMethods`, `settings.security.stepUp`, cùng `auth.mfa`, `auth.verify`, các nhánh lời mời
`INVITATION_PATHS` và lời xoá tài khoản `settings.security.delete`, `org.close.consequences`), chuỗi riêng app trong
`scripts/i18n-sign-in.mjs` và `scripts/i18n-invitations.mjs`.
Maestro `sign-in.yaml`, `smoke-launch.yaml`, `a11y-large-text-dark.yaml` viết lại theo ô native (testID), và
`upgrade-before.yaml` vẫn chạy được với bản cũ. Version app tăng (0.3.1 → 0.4.0, ghi chú ở `store/release-notes.md`);
privacy manifest, `store/listing.md`, `android-permissions.json`, ngân sách bundle/khởi động. `apps/chat-mobile/CLAUDE.md`
dòng đăng nhập;
`docs/engineering/unichat-mobile-masvs.md` hàng MASVS-AUTH: RFC 8252 nói về app bên thứ ba lấy thông tin đăng nhập của
dịch vụ khác; app first-party nhập mật khẩu của chính dịch vụ, bù bằng TLS pinning, mật khẩu chỉ trong bộ nhớ, không vào
log/Sentry, bucket thử theo email, khoá bước hai.

### 5.4 Chỗ làm khác bản thiết kế

- Bước liên kết sau khi đăng nhập là route riêng `app/(app)/link-sign-in.tsx`: nhóm `(auth)` chỉ cho người chưa đăng
  nhập, và Redirect thay cả ngăn `(auth)` nên không còn màn chọn cũ phía sau. Như `step=link` của 4.3: không ghi khi mở.
- Chế độ liên kết trên điện thoại ẩn thêm "Chưa có tài khoản? Tạo tài khoản" và "Đăng nhập bằng trình duyệt" (phiên
  trình duyệt cũ hơn vé sẽ gặp `proof_required`), không chỉ nút của nhà cung cấp đang chờ.
- Rời màn chọn (Back, vuốt cạnh iOS, nút back Android ở bước đầu) là "Hủy": bỏ vé, trừ khi đã đăng nhập; trong bước
  email hay mã thì Back của header và của Android lùi một bước, còn vuốt cạnh iOS tắt (native-stack đóng màn trước khi
  JavaScript biết).
- Bước hai có thêm nút "Xác nhận" cạnh tự gửi (chỗ cho trạng thái bận và thử lại; mã khôi phục chỉ gửi bằng nút); hết
  năm phút của thử thách thì màn nói hết và đưa về đăng nhập, kể cả khi khoá 15 phút còn đếm.
- Nút Google dùng font của app ở cỡ body và màu theo branding của Google, để nặng ngang nút Apple; nút đang đăng nhập
  giữ dấu và chữ, spinner ở cuối, nhãn `auth.social.signingIn` cho cả hai nhà cung cấp.
- Nút Apple hệ thống nói ngôn ngữ của iOS, không theo ngôn ngữ chọn trong app (`ASAuthorizationAppleIDButton` tự dịch);
  pill Apple tự vẽ theo HIG cần ảnh logo của Apple (việc của chủ sản phẩm, 6).
- Mọi điều khiển của màn đăng nhập vẽ đủ 48 dp trên Android, không hit slop, vì `android-smoke` đo màn này theo khung
  vẽ; phần còn lại của app vẫn 44 pt + hit slop.
- Xác minh email: 429 khi gửi lại là lỗi của form, không thêm câu đếm ngược (nút gửi lại đã đếm phút đó).
- Chuyển từ Cài đặt mở sheet nhà cung cấp lần hai thay vì gửi lại token đầu: server trả lại đồng ý Apple khi trả lời
  `movable`, và mã ủy quyền của Apple chỉ dùng được một lần.
- Bằng chứng Google của step-up luôn hỏi chọn tài khoản, để tài khoản sai Google còn nhớ không bị đưa lại sau
  `provider_token_invalid`.
- Gỡ liên kết và chuyển xác nhận bằng `Alert` native, như mục thiết bị. Sheet bằng chứng nằm lồng trong sheet Xoá tài
  khoản (iOS chỉ trình bày Modal trên Modal từ bên trong nó), và trên iOS sheet sau chờ sheet trước đóng hẳn.
- Khoá app cất sheet bằng chứng đi rồi đưa lại đúng chỗ, mã đã gửi giữ mười phút cho việc của nó; trong sheet Xoá tài
  khoản thì sheet bằng chứng đóng.
- Xoá tài khoản: chủ sở hữu còn thành viên khác chuyển quyền ngay trong sheet (Apple 5.1.1(v)), nơi web bảo làm ở Cài
  đặt; cả hai bằng chứng (`transfer_ownership`, `delete_account`) giữ đủ trước khi chuyển, nên mã gửi mail được gửi hai
  lần; xoá hỏng sau khi đã chuyển thì sheet nói tổ chức đã sang người nhận. Bước đóng tổ chức được đọc lên thay vì đưa
  focus vào ô, để bàn phím không che các dòng hậu quả.
- Privacy manifest và `android-permissions.json` không cần thêm gì (bằng chứng ghi ở `IOS_PRIVACY_MANIFEST` và trường
  `from` của hai quyền sinh trắc); `bundle-budget.json` nâng theo phép đo base/head; ngân sách khởi động để
  `android-smoke` và `ios-release` đo.

## 6. Tài liệu đi kèm

- `CLAUDE.md`: đoạn Sign in with Apple (Backend HTTP Rules) viết lại theo 0049 với tên test mới; câu redirect thêm
  `web_sign_in.go`, `apple_web.go`; đoạn rate limit thêm ba bucket; API Compatibility thêm hai route "fail loudly".
- `docs/adr/README.md` (0049), dòng Trạng thái của 0041.
- `docs/conventions.md` §2: "phương thức đăng nhập" / sign-in method; "liên kết" / "gỡ liên kết" (link/unlink account —
  khác "gắn"); "Đặt mật khẩu" / "Đổi mật khẩu"; "xác thực hai lớp"; "Ẩn địa chỉ email" (Hide My Email); "bằng chứng"
  không lộ ra giao diện (giao diện nói "xác nhận là bạn"); Apple vào danh sách thương hiệu; tiếng Anh nói Sign in /
  Sign up / Sign out ở mọi nơi (bỏ Log in / Log out, để một màn không trộn hai động từ).
- Chính sách quyền riêng tư + `store/listing.md` + test: Apple trên web, máy tính, Android; Google SDK trên app.
- Owner action (ADR 0049, danh sách đủ ở Hệ quả): Services ID, OAuth client Google iOS/Android và biến của chúng (EAS,
  `GOOGLE_NATIVE_CLIENT_IDS`), `UNICHAT_IOS_TEAM_ID` / `UNICHAT_ANDROID_SHA256` trên host phục vụ `app.uniworkos.com`,
  **đăng ký domain gửi mail với "Sign in with Apple for Email Communication" + SPF/DKIM** (không có thì mã step-up
  không tới được tài khoản relay).

## 7. Thứ tự giao

Một nhánh, commit theo lát, mỗi lát để server chạy được:

1. Dữ liệu + sqlc; sealer theo purpose; `resolveIdentity` với `reclaim`; Google web đi qua nó (PKCE, nonce, `next`);
   cổng `requireVerifiedEmail` cho MFA/liên kết; quên mật khẩu chưa xác minh = reclaim; helper thu hồi; khoá bước hai.
   Lát này còn tạo ngay khi `unmatched` (như cũ) để không có trang 404; `link_required` chưa có vé nên Google web từ
   chối (`/login?error=sign_in_conflict`, không liên kết). Lát 1b thêm token MFA gắn kênh và liên kết chờ `pl` cho
   Google web (3.3), khoá bước hai, cổng `credentials_revoked_at` cho đồng ý desktop/MCP, `revokeOtherUserSessions`.
2. Vé + màn chọn server (create, claim-email, link, move, `intent=sign_up`), `pl` cho vé và "email khác", chống login
   CSRF, `/auth/providers`, gợi ý PKCE. Từ lát này `unmatched` ra vé — **cùng PR** với trang `/auth/continue` của web.
   Lát 2 (server) đã làm phần route web; `link_required` của Google web cũng ra vé (bỏ lời từ chối tạm của lát 1).
   `/auth/providers` có `apple_web`, `google_native` (luôn `false` tới lát 4, 5). Còn lại: step-up thay
   `proof_required` khi phiên cũ hơn vé (lát 3), route native vé (lát 5).
3. Step-up + phương thức đăng nhập + mật khẩu + quên mật khẩu không mật khẩu + xoá tài khoản/chuyển quyền dùng step-up +
   mail + ngân sách thử. Lát 3 (server) xong, trừ liên kết Apple từ Cài đặt (lát 4) và lệnh liên kết native (lát 5).
   Quên mật khẩu đặt lần đầu ghi `auth.password_set` (cả khi là thu hồi tài khoản chưa xác minh mà chưa có mật
   khẩu), không thì `auth.password_changed`.
4. Apple web. Lát 4 (server) xong, gồm `POST /me/sign-in-methods/apple/link`; câu trả lời ghi ở 3.4.
5. Route native + Google ID token + bộ chuyển mã route Apple cũ. Lát 5 (server) xong, gồm
   `/me/sign-in-methods/{google,apple}/native` và bằng chứng step-up Google trên app; câu trả lời ghi ở 3.6.
6. Web (4.x). 7. Mobile (5.x).
