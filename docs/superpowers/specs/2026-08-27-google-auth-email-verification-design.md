# UniWork — Đăng nhập Google + xác thực email

**Ngày:** 2026-08-27
**Trạng thái:** Đã duyệt thiết kế trong chat (brainstorming với chủ dự án), chờ duyệt spec
**Spec nền:** `2026-08-25-onboarding-organizations-design.md` (onboarding, `onboarded_at`)
**Tham chiếu:** `../usf/server/internal/handler/auth.go`, `../usf/server/internal/service/email.go`,
`../usf/packages/views/auth/login-page.tsx`

## 1. Mục tiêu

Thêm hai lối vào hệ thống bên cạnh đăng ký/đăng nhập bằng mật khẩu hiện có:

1. **Xác thực email** — sau khi đăng ký bằng mật khẩu, user nhận mã OTP 6 số qua
   email và phải nhập mã trước khi vào onboarding/workspace. Cơ chế OTP lấy từ usf
   (mã 6 số, hạn 10 phút, tối đa 5 lần sai, gửi lại sau 60 giây, dev-code cho
   local/CI).
2. **Đăng nhập Google** — nút "Tiếp tục với Google" ở login và register. Tài khoản
   Google có email đã xác thực được tự động liên kết với tài khoản mật khẩu cùng
   email; user Google-only không có mật khẩu.

Khác với usf (passwordless, OTP chính là đăng nhập), uniwork **giữ mật khẩu** và
dùng OTP thuần tuý để xác thực email; trạng thái xác thực ghi ở `users.email_verified_at`.

**Ngoài phạm vi:** quên/đặt lại mật khẩu, đổi email, gỡ liên kết Google, trang
settings tài khoản, OTP login không mật khẩu, Resend API (chỉ SMTP + log), One Tap /
Google Identity Services script. Mailer xây ở đây là nền cho các việc này sau.

## 2. Nguyên tắc

1. **Thứ tự cổng vào** là `verify → onboarding → workspace`, định nghĩa **một
   chỗ** (`pendingAuthStep(user)` trong `packages/core/paths/resolve.ts`); guard và
   mọi trang trong nhóm `(auth)` gọi nó thay vì tự kiểm `onboarded_at`.
2. Register/login vẫn tạo session ngay; chưa verify chỉ bị chặn ở tầng điều
   hướng của frontend và ở các endpoint cần verify (xem 4.4). Trang verify chạy
   với session bình thường.
3. Google là lối vào **đã verify sẵn**: chỉ chấp nhận ID token có
   `email_verified = true`; tạo/liên kết đều đặt `email_verified_at`.
4. Toàn bộ OAuth (state, đổi code, verify ID token) nằm ở Go. `client_id` và
   `client_secret` không xuống browser; frontend chỉ có một link tới
   `/api/v1/auth/google/start` và một trang `/auth/callback` chờ session.
5. Không phá regression contract e2e: 5 spec onboarding chỉ thêm bước nhập
   dev-code qua helper chung; kỳ vọng của spec giữ nguyên.
6. Mã OTP lưu **băm sha256** (khác usf lưu plaintext); e2e dùng
   `DEV_VERIFICATION_CODE` nên không cần đọc DB.
7. Tuân `docs/conventions.md`: trạng thái là timestamp, không boolean; route
   toàn cục một từ (`/verify`) hoặc `/{noun}/{verb}` (`/auth/callback`); Google là
   brand không dịch; `vi.json` viết trước.

## 3. Dữ liệu

### 3.1 Migration `005_email_verification` (không FK, theo lint từ 005)

```sql
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
ALTER TABLE users ADD COLUMN email_verified_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN google_id TEXT;
-- Grandfather: user đã tồn tại trước tính năng này coi như đã xác thực.
UPDATE users SET email_verified_at = created_at WHERE email_verified_at IS NULL;

CREATE TABLE email_verification_codes (
  id         TEXT PRIMARY KEY,           -- ULID
  user_id    TEXT NOT NULL,              -- không FK, dọn trong service
  code_hash  TEXT NOT NULL,              -- sha256 hex của mã 6 số
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ,
  attempts   INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Down: drop bảng, drop hai cột, `SET NOT NULL` lại cho `password_hash` sau khi
xoá user không có mật khẩu (down chỉ dùng ở dev).

### 3.2 Migration `006_users_google_id_idx`, `007_email_verification_codes_user_idx`

Mỗi file một câu lệnh:

```sql
CREATE UNIQUE INDEX CONCURRENTLY idx_users_google_id ON users(google_id) WHERE google_id IS NOT NULL;
CREATE INDEX CONCURRENTLY idx_email_verification_codes_user ON email_verification_codes(user_id, created_at DESC);
```

### 3.3 sqlc (`server/pkg/db/queries/`)

`users.sql` thêm:

- `CreateGoogleUser :one` — `(id, email, display_name, avatar_url, google_id, email_verified_at = now())`, `password_hash` NULL.
- `GetUserByGoogleID :one`.
- `LinkGoogleAccount :one` — set `google_id`, `email_verified_at = COALESCE(email_verified_at, now())`, `avatar_url = COALESCE(avatar_url, $avatar)`, `updated_at = now()`.
- `MarkEmailVerified :one` — `SET email_verified_at = now() WHERE id = $1 AND email_verified_at IS NULL`.

`email_verification_codes.sql` (mới, theo usf `verification_code.sql`):

- `CreateEmailVerificationCode :one`.
- `GetActiveEmailVerificationCode :one` — `WHERE user_id = $1 AND used_at IS NULL AND expires_at > now() AND attempts < 5 ORDER BY created_at DESC LIMIT 1`. Quy tắc dùng-một-lần / hết hạn / quá số lần nằm ngay trong WHERE.
- `GetLatestEmailVerificationCode :one` — mã mới nhất bất kể trạng thái, cho cổng gửi lại 60 giây.
- `MarkEmailVerificationCodeUsed :exec`, `IncrementEmailVerificationCodeAttempts :exec`.
- `DeleteExpiredEmailVerificationCodes :exec` — `expires_at < now() - interval '1 hour'`.
- `DeleteEmailVerificationCodesForUser :exec` — gọi khi verify xong.

`server/internal/testutil/db.go` thêm `email_verification_codes` vào TRUNCATE.
Model `db.User` có `PasswordHash pgtype.Text`; `AuthService.Login` coi
`!PasswordHash.Valid` là `ErrInvalidCredentials`.

## 4. Backend

### 4.1 Mailer — `server/internal/mail/`

```go
type Sender interface { Send(ctx context.Context, msg Message) error }
type Message struct { To, Subject, HTML, Text string }
```

- `smtp.go` — port từ usf `email.go`: `SMTP_HOST/PORT/USERNAME/PASSWORD`,
  `SMTP_TLS` (`starttls` mặc định; `implicit|smtps|ssl` hoặc tự implicit khi port 465),
  `SMTP_TLS_INSECURE`, `SMTP_EHLO_NAME`; dial 10s / deadline 30s; AUTH PLAIN, khi
  server trả "unrecognized authentication type"/`504 5.7.4` thì reconnect và thử
  LOGIN; probe `8BITMIME` sau STARTTLS, fallback quoted-printable; subject
  `mime.QEncoding`; tự sinh `Message-ID`. `loginAuth` từ chối kênh không mã hoá
  trừ localhost.
- `log.go` — `LogSender`: ghi `slog.Info("mail not configured, printing", to, subject, text)`.
  Dùng khi `SMTP_HOST` trống. Log ở mức Info để dev thấy mã trong terminal.
- `New(cfg)` chọn impl và log chế độ đang dùng khi khởi động (như usf).
- `MAIL_FROM` (mặc định `UniWork <noreply@unicomhub.com>`).
- Template: `server/internal/mail/templates/verification_code.html` + `.txt`
  (`html/template`, tiếng Việt, thời hạn truyền qua biến `ExpiresInMinutes` —
  cùng hằng số với service, không hardcode hai nơi). Logo là bảng HTML/CSS thuần
  (Gmail bỏ SVG/data URI — ghi chú từ usf).
- `server/cmd/server/main.go` tạo `mail.Sender`, đưa vào `handler.Deps`.

### 4.2 Config (`server/internal/config/config.go`, `.env.example`)

| Biến | Mặc định | Ghi chú |
|---|---|---|
| `APP_ENV` | `development` | `production` tắt dev-code |
| `DEV_VERIFICATION_CODE` | (trống) | 6 số; chỉ có tác dụng khi `APP_ENV != production` |
| `SMTP_HOST` … `SMTP_EHLO_NAME`, `MAIL_FROM` | | trống → `LogSender` |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | (trống) | thiếu một trong hai → Google tắt |
| `API_PUBLIC_URL` | `http://localhost:8080` | origin công khai của API, dùng dựng redirect URI `${API_PUBLIC_URL}/api/v1/auth/google/callback`; phải là origin tuyệt đối như `FRONTEND_ORIGIN` |

`Config` thêm `GoogleEnabled() bool`, `DevVerificationCode()` (trả "" khi production
hoặc không đúng 6 số). `config_test.go` thêm case cho `API_PUBLIC_URL` sai định
dạng và dev-code bị bỏ qua ở production.

### 4.3 Xác thực email — `server/internal/service/verification.go`

```go
type VerificationService struct { q *db.Queries; mail mail.Sender; devCode string; now func() time.Time }
const codeTTL = 10 * time.Minute; const resendGap = 60 * time.Second; const maxAttempts = 5

func (s *VerificationService) Send(ctx, userID string) error
func (s *VerificationService) Confirm(ctx, userID, code string) (db.User, error)
```

- `Send`: user không tồn tại → `ErrNotFound`; đã verify → `ErrConflict`; mã mới
  nhất tạo cách đây < 60s → `ErrRateLimited` (error kind mới trong `errors.go`,
  `mapServiceError` → 429 `rate_limited`); sinh mã bằng `crypto/rand` (4 byte mod
  1e6, `%06d`), lưu sha256 hex, `expires_at = now + 10m`; gửi mail; sau đó
  `DeleteExpired` best-effort (log warn nếu lỗi).
- `Confirm`: chuẩn hoá `code` (trim); `GetActiveEmailVerificationCode` lỗi
  `ErrNoRows` → `ErrInvalidCode`; nếu `code == devCode` (so constant-time, devCode
  khác rỗng) thì bỏ qua so hash; ngược lại so `sha256(code)` với `code_hash` bằng
  `subtle.ConstantTimeCompare`, sai → `IncrementAttempts` rồi `ErrInvalidCode`.
  Đúng → `MarkUsed`, `MarkEmailVerified`, `DeleteCodesForUser`, trả user mới.
  `ErrInvalidCode` → 400 `invalid_code`, một thông điệp chung cho sai / hết hạn /
  quá 5 lần (như usf, không lộ trạng thái).
- Dev-code vẫn cần có một mã đang hiệu lực (đã gọi `Send`) — giữ đúng luồng UI
  trong e2e và không mở đường tắt khi chưa gửi mã.
- `AuthService.Register` sau khi tạo user gọi `verification.Send`; lỗi gửi chỉ
  log warn — đăng ký vẫn thành công, user bấm "Gửi lại mã".

### 4.4 Routes (router.go)

```go
r.Get("/auth/providers", h.authProviders)                                   // public
r.With(credentialLimit).Get("/auth/google/start", h.googleStart)
r.With(credentialLimit).Get("/auth/google/callback", h.googleCallback)
r.Group(func(r chi.Router) {
    r.Use(mw.RequireAuth(d.Minter))
    r.With(credentialLimit).Post("/me/email/verify", h.verifyEmail)        // {code} → {user}
    r.With(credentialLimit).Post("/me/email/resend", h.resendVerification) // → {status:"ok"}
    ...
})
```

- `userDTO` thêm `email_verified_at *string` (RFC3339 hoặc null).
- Endpoint cần email đã verify ở backend: `POST /me/onboarding/complete`, tạo
  organization/workspace, gửi lời mời. `OnboardingService.Complete` và
  `OrganizationService.Create` kiểm `email_verified_at` → `ErrEmailUnverified` (403 `email_unverified`, xem 4.6). Đọc dữ liệu (`/me`,
  `/me/invitations`, danh sách workspace) không chặn — trang verify và guard cần
  chúng.

### 4.5 Google — `server/internal/service/googleauth.go` + `handler/google.go`

Dependency: `github.com/coreos/go-oidc/v3`, `golang.org/x/oauth2` (kéo theo).

- Khởi tạo một lần khi `GoogleEnabled()`: `oidc.NewProvider(ctx, "https://accounts.google.com")`,
  `oauth2.Config{ClientID, ClientSecret, RedirectURL: apiPublicURL + "/api/v1/auth/google/callback", Endpoint: provider.Endpoint(), Scopes: {oidc.ScopeOpenID, "email", "profile"}}`,
  `verifier := provider.Verifier(&oidc.Config{ClientID})`. Discovery thất bại khi
  boot → log error và coi Google tắt (không làm server chết). Trong test, provider
  và endpoint được thay bằng `httptest.Server` giả (interface nhỏ
  `tokenExchanger` / `idTokenVerifier` để inject).
- `GET /auth/google/start?next=`:
  Google tắt → 503 `google_not_configured`. Sinh `state` 32 byte hex; cookie
  `uniwork_oauth_state` = `state` + `"|"` + `next` đã qua `sanitizeNext` (cùng quy tắc
  với `sanitizeNextUrl` TS: bắt đầu `/`, không `//`, không `/\`), HttpOnly,
  SameSite=Lax, Secure theo `SecureCookies`, `Path=/api/v1/auth/google`,
  MaxAge 600. 302 tới `AuthCodeURL(state, oauth2.SetAuthURLParam("prompt","select_account"))`.
- `GET /auth/google/callback?code&state&error`:
  1. Đọc và xoá cookie state. Thiếu cookie / `state` khác → redirect lỗi
     `google_failed`. `error=access_denied` từ Google → `google_denied`.
  2. `Exchange(ctx với timeout 10s, code)`; lấy `id_token` từ extra; `verifier.Verify`.
     Claims: `sub`, `email`, `email_verified`, `name`, `picture`.
     `email_verified != true` → `google_unverified`.
  3. `GoogleAuthService.SignIn(ctx, claims)`:
     - `GetUserByGoogleID(sub)` → user.
     - else `GetUserByEmail(lower(email))` → `LinkGoogleAccount` (đã có `google_id`
       khác → `ErrConflict` → `google_failed`; trường hợp hiếm, log warn).
     - else `CreateGoogleUser` (display_name = `name`, trống thì phần trước `@`;
       avatar = `picture`).
     - Trả `Session` qua `AuthService.NewSessionFor(user)` (tách từ `newSession`
       hiện có).
  4. Set refresh cookie như login; 302 `${FRONTEND_ORIGIN}/auth/callback?next=<next>`
     (bỏ `next` nếu trống). Lỗi → 302 `${FRONTEND_ORIGIN}/login?error=<code>`.
- `GET /auth/providers` → `{"google": cfg.GoogleEnabled()}`.
- Handler không truy vấn DB (rule handler); mọi quyết định ở service.

### 4.6 Lỗi mới (`errors.go` / `mapServiceError`)

| Error | HTTP | code |
|---|---|---|
| `ErrRateLimited` | 429 | `rate_limited` |
| `ErrInvalidCode` | 400 | `invalid_code` |
| `ErrEmailUnverified` | 403 | `email_unverified` |

## 5. Frontend

### 5.1 core

- `types/user.ts`: `email_verified_at: z.string().nullable().optional().default(null)`.
- `api/endpoints/auth.ts`: `verifyEmail(code)` → `{user}` (schema `UserEnvelope`,
  fallback null → hook `requireSession`-style ném `malformed_response`);
  `resendVerification()` → `{status}` lenient; `authProviders()` → schema
  `{google: z.boolean().optional().default(false)}`, fallback `{google:false}`.
  Ba case malformed trong `auth.test.ts`.
- `auth/hooks.ts`: `useVerifyEmail` (onSuccess → `setSessionUser`), `useResendVerification`,
  `useAuthProviders` (query key `authKeys.providers()`, `staleTime: Infinity`).
- `paths/paths.ts`: `verify: () => "/verify"`, `authCallback: () => "/auth/callback"`,
  `googleStart: (next?) => \`${runtimeConfig().apiUrl}/api/v1/auth/google/start${next ? "?next=" + encodeURIComponent(next) : ""}\``
  (URL tuyệt đối tới API, không phải page — không đưa vào `builderTemplates`).
  `GLOBAL_PREFIXES` thêm `/verify`, `/auth/`. `builderTemplates()` thêm `verify()`,
  `authCallback()`.
- `paths/resolve.ts`: `pendingAuthStep(user): "verify" | "onboarding" | null` —
  `email_verified_at == null → "verify"`, `onboarded_at == null → "onboarding"`.
  `resolvePostAuthDestination` nhận `user` thay cho `hasOnboarded`, trả
  `paths.verify()` trước tiên nếu chưa verify.
- Reserved slug: thêm `verify` vào `reserved_slugs.json`, chạy
  `pnpm generate:reserved-slugs` (`auth` đã có).
- i18n `vi.json` rồi `en.json`, khối:
  `auth.verify.{title, subtitle(email), codeLabel, invalidCode, resend, resendIn(seconds), resent, resendTooSoon, verifying, wrongEmailHint}`,
  `auth.google.{continueWith, or, denied, failed, unverified}`.
  Copy theo voice guide: không "vui lòng", lỗi nói điều không xảy ra và việc cần làm.

### 5.2 views

- `auth/verify-email-view.tsx` — `AuthShell`; câu dẫn có email của user;
  `InputOTP` 6 ô (`pnpm ui:add input-otp`, thêm vào `render-smoke.test.tsx`), autofocus,
  tự submit ở ký tự thứ 6, chặn submit khi `isPending`; lỗi `invalid_code` hiển thị
  dưới ô nhập (`aria-describedby`); nút "Gửi lại mã" với cooldown 60s ở client (bắt
  đầu đếm ngay khi mở trang vì register vừa gửi), 429 → hiện `resendTooSoon` và đặt
  lại cooldown; nút "Đăng xuất" nhỏ (`useLogout`) cho trường hợp nhập nhầm email.
  Thành công → `onSuccess(user)`.
- `auth/google-button.tsx` — `<a href={paths.googleStart(next)}>` style `Button`
  variant outline, SVG chữ G 4 màu inline, text `t("auth.google.continueWith")`.
  Chỉ render khi `useAuthProviders().data?.google`; trong lúc query loading không
  render (tránh nhảy layout thì đặt `min-height` cho vùng chứa).
- `auth/auth-divider.tsx` — đường kẻ + "hoặc".
- `login-view.tsx`, `register-view.tsx`: nhận prop `next?`, thêm divider + Google
  button dưới form. `login-view` nhận `initialError?: "google_denied" | "google_failed" | "google_unverified"`
  hiển thị trên form.
- `auth/post-auth-redirect.ts`: `resolveLoggedInDestination(user, workspaces)` —
  chưa verify → `paths.verify()`; còn lại như cũ.
- `layout/use-dashboard-guard.ts`: sau `anon`, dùng `pendingAuthStep(user)` →
  `replace(paths.verify() | paths.onboarding())`; `use-dashboard-guard.test.tsx`
  thêm case chưa verify.

### 5.3 apps/web

- `app/(auth)/verify/page.tsx`: `anon` → `/login`; đã verify → `resolveLoggedInDestination`;
  render `VerifyEmailView`, `onSuccess` → list workspaces → `resolveLoggedInDestination`.
- `app/auth/callback/page.tsx` (ngoài `(auth)` để có URL `/auth/callback`; layout riêng
  với `robots: noindex`): đọc `next`, `error`; chờ `status !== "loading"`; `anon` →
  `replace(/login?error=google_failed)`; `authed` → `next` đã sanitize hoặc
  `resolveLoggedInDestination`. Hiển thị spinner + `t("auth.google.signingIn")`.
  `initialize()` của `CoreProvider` đã gọi refresh khi load nên trang không gọi
  API auth nào thêm.
- `app/(auth)/login/page.tsx`: đọc `?error=google_*` → `initialError`, truyền `next`
  cho `LoginView`. Các trang `onboarding`, `invitations`, `workspaces` dùng
  `pendingAuthStep` để đẩy về `/verify` khi cần.

## 6. Cấu hình môi trường & CI

- `.env.example` thêm ba khối `Email`, `Google`, `App` (`APP_ENV`,
  `DEV_VERIFICATION_CODE=123456`). Makefile/`make dev` không đổi.
- `.github/workflows/ci.yml`: job Go và e2e set `DEV_VERIFICATION_CODE=123456`,
  `APP_ENV=test`; không cần SMTP (LogSender).
- `e2e/playwright.config.ts` đọc `E2E_VERIFICATION_CODE ?? "123456"`.

## 7. Kiểm thử

**Go**
- `service/verification_test.go`: send tạo mã và gửi qua `fakeSender`; gửi lại < 60s
  → `ErrRateLimited`; confirm đúng → `email_verified_at` set, mã bị xoá; sai 5 lần → mã
  vô hiệu kể cả khi nhập đúng sau đó; hết hạn (`now` giả) → `ErrInvalidCode`; dev-code
  đúng khi có mã đang hiệu lực, bị từ chối khi chưa `Send`; đã verify → `ErrConflict`.
- `service/googleauth_test.go`: `SignIn` ba nhánh (đã có google_id / trùng email →
  link + set verified + avatar / user mới không mật khẩu), `Login` mật khẩu với user
  Google-only → `ErrInvalidCredentials`.
- `handler/google_test.go`: `start` set cookie và redirect đúng URL; `callback`
  state sai → redirect `google_failed`; `email_verified=false` → `google_unverified`;
  thành công → refresh cookie + redirect `/auth/callback?next=`; Google tắt → 503.
  Provider giả bằng `httptest.Server` phục vụ discovery, token, JWKS (ký RS256 bằng
  key sinh trong test).
- `handler/auth_test.go`: `TestRegisterSendsCode`, `/me/email/verify` đúng/sai,
  `/me/email/resend` 429, `/me/onboarding/complete` khi chưa verify → 403.
- `mail/smtp_test.go`: port các test fake-SMTP của usf (PLAIN→LOGIN, TLS mode,
  EHLO, from resolution, từ chối kênh không mã hoá).
- `config_test.go`: biến mới.

**TS**
- `core/api/endpoints/auth.test.ts`: 3 malformed case.
- `core/paths/resolve.test.ts`: `pendingAuthStep`, `resolvePostAuthDestination` với user chưa verify.
- `views/auth/verify-email-view.test.tsx`: autofocus, auto-submit ô thứ 6, lỗi
  `invalid_code`, resend cooldown disable/enable, 429.
- `views/auth/google-button.test.tsx`: ẩn khi provider tắt, href đúng với `next`.
- `views/auth/login-view.test.tsx`: `initialError` hiển thị.
- `views/layout/use-dashboard-guard.test.tsx`: chưa verify → `/verify`.
- `paths/consistency.test.ts`, `render-smoke.test.tsx`, `parity.test.ts` tự bao phủ route/primitive/i18n mới.

**E2E**
- `e2e/helpers/register.ts`: `registerFreshUser(page, tag)` = đăng ký như hiện nay +
  nhập `E2E_VERIFICATION_CODE` ở `/verify` + `expect /onboarding`. Năm spec
  onboarding và `smoke.spec.ts` gọi helper; kỳ vọng cũ giữ nguyên.
- `e2e/verify.spec.ts`: sai mã hiện lỗi; nút gửi lại bị khoá trong cooldown; contrast
  light/dark trên trang verify; nút Google **không** hiện khi provider tắt (CI không
  cấu hình Google), `auth-layout.spec.ts` thêm `/verify` vào danh sách trang.

## 8. Rủi ro & quyết định

- **Redirect URI là API origin** (`${API_PUBLIC_URL}/api/v1/auth/google/callback`),
  phải đăng ký trên Google Cloud Console; khi deploy API và web khác domain cần
  `API_PUBLIC_URL` đúng. Đổi lại được: secret và state không rời server.
- **Liên kết theo email** chỉ khi Google báo `email_verified`; tài khoản mật khẩu
  chưa verify vẫn có thể bị "claim" bởi chủ email thật qua Google — đúng chủ đích,
  vì email thuộc về người đó.
- **User Google-only không có mật khẩu**; "quên mật khẩu" ngoài phạm vi nên họ chỉ
  đăng nhập được bằng Google cho tới khi có đặt lại mật khẩu.
- **Cổng 60 giây theo user** ở DB + **credentialLimit theo IP** ở Redis: cả hai
  đều cần; Redis vắng thì chỉ còn cổng DB (fail-open như usf).
- **Dev-code** chỉ hiệu lực khi `APP_ENV != production`; docker/production phải đặt
  `APP_ENV=production`, ghi trong `.env.example`.
- **Grandfather** user hiện hữu là đã verify: cơ sở dữ liệu hiện tại là dev, không
  có user thật cần xác thực lại.
- `PasswordHash` chuyển sang `pgtype.Text` chạm `Login`, `Register` và các test
  đang gán chuỗi — thay đổi cơ học, không đổi hành vi với user có mật khẩu.
