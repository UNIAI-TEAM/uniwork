# UniWork — Email giao dịch (transactional email)

**Ngày:** 2026-08-28
**Trạng thái:** Đã triển khai (nhánh feat/transactional-email, 2026-08-28)
**Spec nền:** `2026-08-27-google-auth-email-verification-design.md` (package `mail`,
OTP xác thực), `2026-08-25-onboarding-organizations-design.md` (`OnboardingService.Complete`,
`invitations`)
**Tham chiếu:** `../usf/server/internal/service/email.go` (chỉ lấy `sanitizeSubjectField`
và ý tưởng logo HTML thuần; phần còn lại uniwork đã làm tốt hơn)

## 1. Mục tiêu

Xây một hệ gửi email dùng chung cho mọi loại mail của UniWork, bắt đầu với bốn loại:

| Kind | Trigger | Người nhận |
| --- | --- | --- |
| `verification_code` | đăng ký bằng mật khẩu (đã có, chuyển sang hệ mới) | user |
| `password_reset` | quên mật khẩu (mới) | user |
| `workspace_invite` | `InviteMany` (đã tạo `invitations`, chưa gửi mail) | email được mời, có thể chưa có account |
| `welcome` | hoàn tất onboarding (mới) | user |

Yêu cầu "đẳng cấp thế giới" được diễn giải thành các tính chất đo được:

1. **Không mất mail.** Mail được ghi vào Postgres trước, gửi sau; SMTP chết hay
   process restart đều không làm mất. Retry có backoff, có giới hạn.
2. **Không làm chết request.** API trả về ngay sau khi ghi outbox; lỗi SMTP không
   thành lỗi 500.
3. **Tra cứu được.** Bảng `emails` là lịch sử: ai nhận gì, lúc nào, gửi thành công
   hay không, nội dung đúng như đã gửi.
4. **Song ngữ.** Mỗi mail có bản vi và en; chọn theo `users.locale`.
5. **An toàn.** Dữ liệu người dùng (tên, tên workspace) không thành phishing subject
   hay HTML injection. Forgot-password không lộ email nào tồn tại.
6. **Thêm loại mail mới rẻ.** Một file Go nhỏ + bốn file template; không đụng worker,
   không đụng migration.

**Ngoài phạm vi (lần sau, cấu trúc đã chừa chỗ):** sender HTTP API (Resend/SES),
open/click tracking, unsubscribe và notification preferences cho mail
không-transactional (digest, mention, nhắc việc), trang admin xem bảng `emails`,
đổi email, gửi hàng loạt/marketing.

## 2. Nguyên tắc

1. **Transport giữ nguyên.** `mail.Sender`, `SMTPSender`, `LogSender`, `buildMessage`
   không đổi. Thêm provider HTTP sau này là một file mới implement `Sender`.
2. **Service không gọi `Sender`.** Service gọi `mail.<Kind>(...)` để lấy `Message`
   rồi `outbox.Enqueue`. Chỉ worker gọi `Sender.Send`.
3. **Render trước, lưu sẵn.** `subject/html/text` render lúc enqueue và lưu vào
   bảng. Worker không biết template; lịch sử phản ánh đúng nội dung đã gửi kể cả
   khi template đổi sau này.
4. **Một loại mail = một hàm Go typed** (`mail.Invite(InviteData) (Message, error)`).
   Không registry động, không `map[string]any`. Sai kiểu lộ lúc compile; template
   lỗi lộ lúc boot (`template.Must`).
5. **Copy nằm trong template, không trong Go.** Subject là dòng đầu của file `.txt`
   (`Subject: …`). Người viết nội dung sửa template mà không đụng Go.
6. **Tuân `docs/conventions.md`:** ULID `TEXT`, không FK, `CREATE INDEX CONCURRENTLY`
   một mình một file, trạng thái là timestamp (`sent_at`/`failed_at`, không
   `status` enum), route toàn cục một từ hoặc `/{noun}/{verb}`, `vi.json` viết trước.
7. **Không thêm dependency.** Outbox là một bảng + một goroutine; không River, không
   Redis queue. Nâng cấp khi khối lượng vượt mức một process xử lý được (xem 9).

## 3. Dữ liệu

### 3.1 Migration `008_emails`

```sql
-- Outbox + lịch sử email. Không FK: user_id NULL khi mời email chưa có account,
-- và lịch sử phải sống lâu hơn user (audit).
CREATE TABLE emails (
  id              TEXT PRIMARY KEY,
  kind            TEXT NOT NULL,
  to_email        TEXT NOT NULL,
  user_id         TEXT,
  locale          TEXT NOT NULL,
  subject         TEXT NOT NULL,
  html            TEXT NOT NULL,
  text            TEXT NOT NULL,
  attempts        INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at         TIMESTAMPTZ,
  failed_at       TIMESTAMPTZ,
  last_error      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Trạng thái suy ra từ timestamp: `sent_at IS NULL AND failed_at IS NULL` = đang chờ;
`sent_at` = đã gửi; `failed_at` = bỏ cuộc sau khi hết lượt.

### 3.2 Migration `009_emails_pending_idx`

```sql
CREATE INDEX CONCURRENTLY idx_emails_pending ON emails(next_attempt_at)
  WHERE sent_at IS NULL AND failed_at IS NULL;
```

### 3.3 Migration `010_emails_user_kind_idx`

```sql
CREATE INDEX CONCURRENTLY idx_emails_user_kind ON emails(user_id, kind)
  WHERE user_id IS NOT NULL;
```

Phục vụ "đã gửi welcome cho user này chưa" và trang lịch sử sau này.

### 3.4 Migration `011_password_reset_tokens`

```sql
-- Token lưu băm sha256 như email_verification_codes. Không FK: service xoá token
-- của user khi dùng xong.
CREATE TABLE password_reset_tokens (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Index `(user_id, created_at DESC)` ở migration `012` (CONCURRENTLY) cho rate-limit.

### 3.5 Migration `013_users_locale`

```sql
ALTER TABLE users ADD COLUMN locale TEXT NOT NULL DEFAULT 'vi';
```

Không `CHECK` — giá trị được service chuẩn hoá về `vi|en` trước khi ghi; thêm
locale mới không cần migration.

### 3.6 sqlc `queries/emails.sql`

- `CreateEmail` — insert đầy đủ.
- `ClaimPendingEmails` — `SELECT … WHERE sent_at IS NULL AND failed_at IS NULL AND
  next_attempt_at <= now() ORDER BY next_attempt_at LIMIT $1 FOR UPDATE SKIP LOCKED`.
  Chạy trong transaction của worker.
- `MarkEmailSent(id)` — `sent_at = now()`.
- `MarkEmailAttemptFailed(id, next_attempt_at, last_error)` — `attempts = attempts + 1`.
- `MarkEmailFailed(id, last_error)` — `failed_at = now(), attempts = attempts + 1`.
- `CountEmailsForUserKind(user_id, kind)` — cho welcome một lần.
- `DeleteSentEmailsBefore(ts)` — dọn lịch sử.

`queries/password_reset_tokens.sql`: `Create`, `GetActiveByHash` (chưa dùng, chưa
hết hạn), `GetLatestForUser`, `MarkUsed`, `DeleteForUser`, `DeleteExpired`.

`queries/users.sql`: thêm `UpdateUserLocale`, `UpdateUserPassword` (`GetUserByEmail` đã có).
`queries/refresh_tokens.sql`: thêm `RevokeAllRefreshTokensForUser`.

## 4. Package `mail`

```
server/internal/mail/
  mail.go              Sender, Message (thêm Kind, Locale, UserID), New()
  smtp.go              không đổi
  outbox.go            Outbox: Enqueue, Kick, Run (worker)
  render.go            layout, parse templates, sanitizeSubjectField, renderKind
  verification_code.go VerificationCode(VerificationData)
  password_reset.go    PasswordReset(PasswordResetData)
  invite.go            Invite(InviteData)
  welcome.go           Welcome(WelcomeData)
  templates/
    layout.html                       khung chung: logo, nội dung, footer
    verification_code.vi.html/.txt    (4 file mỗi kind)
    verification_code.en.html/.txt
    password_reset.{vi,en}.{html,txt}
    workspace_invite.{vi,en}.{html,txt}
    welcome.{vi,en}.{html,txt}
```

### 4.1 `Message`

```go
type Message struct {
    Kind    string // "verification_code" | "password_reset" | "workspace_invite" | "welcome"
    Locale  string // "vi" | "en"
    UserID  string // "" khi người nhận chưa có account
    To      string
    Subject string
    HTML    string
    Text    string
}
```

`Sender.Send(ctx, Message)` giữ chữ ký; SMTP bỏ qua các trường mới.

### 4.2 Render

- `layout.html` định nghĩa `{{define "layout"}}` với header (chữ "UniWork" +
  ô logo dựng bằng table/CSS inline như usf, vì Gmail bỏ SVG/data URI), slot
  `{{template "content" .}}`, footer ("Bạn nhận mail này vì… / You received this
  because…", link `FRONTEND_ORIGIN`). Toàn bộ style inline, bảng, không ảnh ngoài.
- Mỗi `kind.locale.html` chỉ `{{define "content"}}`.
- File `.txt`: dòng 1 là `Subject: …` (Go template), dòng trống, rồi body text.
  `renderKind(kind, locale, data)` tách subject ra, trim, chạy
  `sanitizeSubjectField` **sau** khi render (bỏ control char, cắt 200 rune).
- Dữ liệu người dùng đưa vào subject (tên người mời, tên workspace) được cắt
  60 rune **trước** khi vào template (giống usf `maxSubjectFieldRunes`).
  `html/template` tự escape body HTML; `text/template` không escape (đúng cho
  text/plain).
- Locale không phải `vi|en` → về `vi`. Template thiếu → panic lúc boot
  (`template.Must` trong `init`), test `TestAllKindsRenderBothLocales` bắt sớm hơn.
- `AppURL` (từ `FRONTEND_ORIGIN`) được truyền vào mọi data struct qua
  `mail.Renderer{AppURL}`; hàm kind là method của `Renderer` để không đọc env.

### 4.3 Outbox

```go
type Outbox struct {
    db     *pgxpool.Pool
    q      *db.Queries
    sender Sender
    log    *slog.Logger
    kick   chan struct{} // cap 1
    now    func() time.Time
}

func (o *Outbox) Enqueue(ctx context.Context, q *db.Queries, msg Message) (string, error)
func (o *Outbox) Kick()
func (o *Outbox) Run(ctx context.Context)
```

- `Enqueue` nhận `q` để caller đưa `Queries` gắn transaction của mình khi cần
  atomic với nghiệp vụ (invite, reset token). Sau khi caller commit, gọi
  `Kick()` để worker chạy ngay thay vì chờ tick. Với `LogSender` (dev) độ trễ
  thực tế < 100ms nên OTP vẫn đọc được ngay từ terminal.
- `Run`: vòng lặp `select { case <-ticker(5s); case <-kick; case <-ctx.Done() }`.
  Mỗi vòng: mở tx, `ClaimPendingEmails(limit 20)`, với mỗi row gọi
  `sender.Send` (timeout 30s/mail — SMTP đã có), rồi `MarkEmailSent` hoặc
  `MarkEmailAttemptFailed` / `MarkEmailFailed`; commit. Lặp lại ngay nếu claim
  đủ 20 (còn hàng). Mỗi giờ một lần gọi `DeleteSentEmailsBefore(now-30d)` và
  `DeleteExpiredPasswordResetTokens`.
- Backoff theo `attempts` **sau** lần thất bại: `[1m, 5m, 30m, 2h, 6h]`; sau lần
  thứ 5 → `failed_at`. Lỗi được log `Warn` kèm `kind, to, attempts`; lần bỏ cuộc
  log `Error`.
- `FOR UPDATE SKIP LOCKED` cho phép nhiều API node cùng chạy worker mà không gửi
  trùng. Row đang bị lock mà process chết giữa chừng → lock tự nhả, row vẫn
  pending → lần sau gửi lại. Ceiling: at-least-once, một mail có thể tới hai lần
  nếu chết đúng giữa `Send` và commit; chấp nhận cho transactional.
- Shutdown: `main` cancel ctx → worker kết thúc vòng hiện tại (đợi tối đa
  session timeout 30s) rồi thoát. Row chưa xong vẫn pending.
- `main.go`: `outbox := mail.NewOutbox(pool, q, sender, log)`; `go outbox.Run(ctx)`;
  truyền `outbox` (interface `mail.Enqueuer{Enqueue, Kick}`) vào các service.

### 4.4 Data struct mỗi kind

```go
type VerificationData struct{ Code string; ExpiresInMinutes int }
type PasswordResetData struct{ ResetURL string; ExpiresInMinutes int }
type InviteData struct{ InviterName, WorkspaceName, AcceptURL string; ExpiresInDays int }
type WelcomeData struct{ DisplayName, WorkspaceName, WorkspaceURL string }
```

`AcceptURL = AppURL + "/invite/" + token`; `ResetURL = AppURL + "/reset-password?token=" + token`;
`WorkspaceURL = AppURL + paths.Workspace(orgSlug, wsSlug)` — dùng cùng quy ước
route với `packages/core/paths/paths.ts` (`/{orgSlug}/{workspaceSlug}`).

## 5. Nghiệp vụ

### 5.1 `verification_code` (chuyển đổi)

`VerificationService` nhận `mail.Enqueuer` thay `mail.Sender`. `Send`: tạo code
→ `Renderer.VerificationCode(...)` với `u.Locale` → `Enqueue` → `Kick`. Hành vi
API và `DEV_VERIFICATION_CODE` không đổi. Test hiện có đổi fake sender thành
fake enqueuer.

### 5.2 `password_reset` (mới)

`PasswordResetService{q, enqueuer, renderer, refreshTTL}`:

- `Request(ctx, email)`:
  - Chuẩn hoá email; `GetUserByEmail`. Không có user, hoặc user Google-only
    (`password_hash IS NULL`) → **trả nil** (im lặng). Có → tiếp.
  - Rate-limit: token gần nhất < 60s → cũng trả nil (không lộ). Log `Info`
    `password reset rate-limited`.
  - Token: `util.NewID()+util.NewID()` (đủ entropy, cùng cách invitation), lưu
    `hashToken(token)`, hạn 60 phút. Xoá token cũ chưa dùng của user (chỉ token
    mới nhất hợp lệ).
  - Enqueue `password_reset` với `u.Locale`, `Kick`.
- `Reset(ctx, token, newPassword)`:
  - `GetActivePasswordResetTokenByHash` → không có/hết hạn/đã dùng →
    `ErrInvalidToken` (thêm vào `errors.go`, map 400).
  - Validate mật khẩu theo rule `Register` đang dùng (dùng chung hàm).
  - Trong một tx: `UpdateUserPassword`, `MarkPasswordResetTokenUsed`,
    `RevokeAllRefreshTokensForUser` (thêm query). Trả `Session` mới qua
    `AuthService.SessionFor` để user vào thẳng app.
- Google-only user gọi forgot: im lặng theo thiết kế; UI forgot ghi "Nếu bạn
  đăng nhập bằng Google, hãy dùng nút Google".

Route (`router/auth.go`, không cần auth):
- `POST /api/v1/auth/password/forgot` `{email}` → 200 `{}` luôn (trừ 400 email
  sai định dạng). Rate-limit IP bằng `middleware/ratelimit.go` sẵn có, cùng
  mức đang áp cho `/auth/login`.
- `POST /api/v1/auth/password/reset` `{token, password}` → 200 session như
  login; 400 `invalid_token`.

### 5.3 `workspace_invite` (bổ sung gửi mail)

Trong `InviteMany`, sau `CreateInvitation` thành công: `Renderer.Invite` với
locale = `inviter.Locale`, `Enqueue` bằng cùng `q` (hiện `InviteMany` không mở
tx; giữ nguyên — invitation tạo xong mà enqueue lỗi thì trả lỗi, row invitation
thừa vô hại vì có `expires_at`). `Kick` một lần sau vòng lặp. Handler bỏ trường
`token` khỏi response (không còn lý do lộ); UI đổi theo.

`InviterName = sanitize(u.DisplayName)`, `WorkspaceName = sanitize(ws.Name)`.

### 5.4 `welcome` (mới)

Trong `OnboardingService.Complete`, khi `path ∈ {"full", "invite_accept"}` và
`workspaceID != ""`: `CountEmailsForUserKind(userID, "welcome") == 0` → enqueue
`welcome` với tên, tên workspace, URL workspace; `Kick`. Lỗi enqueue chỉ
`slog.Warn` — onboarding không được fail vì mail chúc mừng. Đường `invite_skipped`
và `skip_existing` không gửi (user chưa có workspace hoặc đã là user cũ).

### 5.5 `users.locale`

- `Register` và Google sign-up nhận `locale` từ handler: đọc cookie
  `uniwork-locale`, không có thì `Accept-Language` qua `matchLocale` phía Go
  (một hàm nhỏ: tìm `en` trong danh sách, còn lại `vi`). Chuẩn hoá `vi|en`.
- `PATCH /api/v1/me` thêm trường tuỳ chọn `locale`; `UpdateProfile` nhận và ghi.
- `GET /me` trả `locale` trong DTO.

## 6. Frontend

- `packages/core/i18n/browser-cookie-adapter.ts`: sau khi ghi cookie, nếu đã
  đăng nhập gọi `patchMe({locale})` (fire-and-forget, lỗi bỏ qua).
- Reserved slugs: thêm `forgot-password`, `reset-password` vào
  `server/internal/service/reserved_slugs.json` (test parity với first-segment
  đã có).
- `packages/core/api/endpoints/auth.ts`: `forgotPassword(email)`,
  `resetPassword(token, password)`; `me.ts`: `locale` trong schema `parseWithFallback`.
- Trang mới trong `apps/web/app/(auth)/`:
  - `/forgot-password` — form email; sau submit luôn hiện "Nếu email tồn tại,
    chúng tôi đã gửi hướng dẫn" + gợi ý Google. Link "Quên mật khẩu?" trên
    `/login`.
  - `/reset-password?token=` — form mật khẩu mới + nhập lại; thành công → set
    session → `pendingAuthStep(user)` điều hướng như login. Token sai → thông
    báo + link về `/forgot-password`.
  - Thêm `forgotPassword`/`resetPassword` vào `packages/core/paths/paths.ts` và
    danh sách first-segment reserved.
- Views trong `packages/views/auth/` (`forgot-password-view.tsx`,
  `reset-password-view.tsx`) + test colocated.
- Invite UI (`packages/views/.../invite-members`): bỏ hiển thị token, hiện
  "Đã gửi lời mời tới N địa chỉ" và danh sách `skipped`.
- `vi.json` trước, `en.json` sau; `parity.test.ts` đã có.

## 7. Cấu hình & vận hành

- Env mới: không bắt buộc. `MAIL_OUTBOX_TICK` (mặc định `5s`),
  `MAIL_HISTORY_RETENTION` (mặc định `720h`). `.env.example` ghi chú.
- Log mode (`SMTP_HOST` trống): `LogSender` in `kind, to, subject, text` — link
  reset và OTP đọc từ terminal như hiện tại.
- Boot log: `mail: outbox worker started tick=5s`.
- Metrics: counter Prometheus `uniwork_emails_total{kind,result=sent|retry|failed}`
  đăng ký cạnh `HTTPMetrics` trong `main.go`.

## 8. Kiểm thử

- `mail/render_test.go`: mọi kind × vi/en render không lỗi, subject không rỗng,
  không chứa `\r\n`, HTML có `AcceptURL`/`ResetURL`; tên workspace chứa
  `<script>` và ký tự điều khiển bị escape/strip trong body và subject.
- `mail/outbox_test.go` (Postgres test như `migrate_test.go`): enqueue → run một
  vòng với fake sender lỗi → `attempts=1`, `next_attempt_at ≈ now+1m`; 5 lần →
  `failed_at`; hai worker song song trên 50 row → mỗi row gửi đúng một lần;
  `Kick` đánh thức worker trước tick.
- `service/password_reset_test.go`: email không tồn tại → nil, không enqueue;
  Google-only → nil; rate-limit; reset đúng → password đổi, token `used_at`,
  refresh token cũ bị revoke, session mới hợp lệ; token hết hạn/đã dùng/sai →
  `ErrInvalidToken`.
- `service/workspace_test.go`: `InviteMany` enqueue đúng số mail = số
  invitation, locale = của người mời, không enqueue cho `skipped`.
- `service/onboarding_test.go`: `Complete(full)` enqueue welcome đúng một lần;
  gọi lại không gửi thêm; `invite_skipped` không gửi.
- Handler tests: forgot luôn 200; reset 400 khi token sai; `PATCH /me {locale}`.
- e2e (`e2e/`): thêm `reset-password.spec.ts` — đăng ký, forgot, lấy token bằng
  cách đọc `emails.text` qua helper DB chỉ bật khi `APP_ENV=test` (cùng cơ chế
  e2e đang dùng để seed nếu có; nếu chưa có, helper mới trong `e2e/helpers/db.ts`
  dùng `pg`). Không thêm `DEV_PASSWORD_RESET_TOKEN` — token bypass cho reset là
  lỗ hổng không đáng.
- `scripts/no-usf-leak.test.mjs` vẫn phải pass (không chữ "multica"/"UniAI").

## 9. Giới hạn đã biết và đường nâng cấp

| Giới hạn | Khi nào chạm | Nâng cấp |
| --- | --- | --- |
| Worker poll 5s, batch 20, tuần tự | > ~200 mail/phút | tăng batch, gửi song song N goroutine trong một claim; sau nữa tách worker ra process riêng (cùng code, flag `--role=mail-worker`) |
| At-least-once | chết giữa `Send` và commit | chấp nhận; nếu cần exactly-once, thêm `Message-ID` cố định theo `emails.id` để client dedupe |
| Chỉ SMTP | cần webhook bounce/complaint | thêm `ResendSender` implement `Sender`, bảng `emails` thêm `provider_message_id` |
| Không preference | mail không-transactional | bảng `notification_preferences`, worker kiểm tra trước khi gửi; unsubscribe link ký HMAC |

## 10. Thứ tự triển khai (gợi ý cho plan)

1. Migration 008–013, sqlc, `users.locale` đọc/ghi (backend + `/me`).
2. `mail`: `Message` mở rộng, `render.go`, layout, chuyển `verification_code`
   sang template vi/en + subject trong `.txt`.
3. `outbox.go` + test; `main.go` wiring; `VerificationService` chuyển sang enqueue.
4. `workspace_invite`: template + `InviteMany` + handler/UI bỏ token.
5. `password_reset`: service, routes, template, frontend hai trang, e2e.
6. `welcome`: template + hook `Complete`.
7. Frontend sync locale; `.env.example`; boot log; metrics.
