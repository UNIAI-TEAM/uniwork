# Transactional Email Implementation Plan

> **Trạng thái:** shipped

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hệ gửi email dùng chung (outbox Postgres + worker, template vi/en) và bốn loại mail đầu: xác thực, quên mật khẩu, mời workspace, chúc mừng onboarding.

**Architecture:** Service render mail bằng `mail.Renderer.<Kind>(data)` → `mail.Outbox.Enqueue` ghi bảng `emails` → goroutine `Outbox.Run` claim `FOR UPDATE SKIP LOCKED`, gọi `mail.Sender` (SMTP/Log hiện có), retry backoff. Password reset thêm bảng `password_reset_tokens` + 2 route public + 2 trang auth. `users.locale` chọn ngôn ngữ mail.

**Tech Stack:** Go 1.27, chi, pgx/v5, sqlc, `html/template` + `text/template`, Next.js + `@uniwork/core|views|ui`, vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-28-transactional-email-design.md`

## Global Constraints

- Mọi lệnh chạy từ `uniwork/`. Go: `cd server && go test ./internal/... -run X`; lint đầy đủ: `make test-go`. TS: `pnpm --filter @uniwork/core test`, `pnpm --filter @uniwork/views test`. sqlc: `make sqlc`.
- Ids là ULID `TEXT` qua `util.NewID()`. Migration: không `REFERENCES`/`FOREIGN KEY`; `CREATE INDEX CONCURRENTLY` **một mình một file**; mọi migration có `.up.sql` + `.down.sql` (`server/migrations/lint_test.go`).
- Không thêm dependency Go. Frontend chỉ thêm `pg` cho `e2e/`.
- Không chữ "multica"/"UniAI" ở bất kỳ file nào (`scripts/no-usf-leak.test.mjs`).
- Copy: `vi.json` trước, `en.json` cùng key (`packages/core/i18n/parity.test.ts`). Route toàn cục một từ: `/forgot-password`, `/reset-password` phải có trong `server/internal/service/reserved_slugs.json` và `packages/core/paths/reserved-slugs.ts` (generated).
- Lỗi service mới thêm vào `service/errors.go` và `mapServiceError` (`handler/auth.go:126`).
- Test Go chạm DB dùng `testutil.DB(t)`; test mới cho package `mail` cũng vậy.
- Commit sau mỗi task, message tiếng Anh ngắn dạng `feat(mail): …`, `feat(auth): …`.

---

## File map

**Backend — tạo mới**
- `server/migrations/008_emails.{up,down}.sql`, `009_emails_pending_idx`, `010_emails_user_kind_idx`, `011_password_reset_tokens`, `012_password_reset_tokens_user_idx`, `013_users_locale`
- `server/pkg/db/queries/emails.sql`, `password_reset_tokens.sql`
- `server/internal/mail/render.go` — layout, parse template, `sanitizeSubjectField`, `SafeField`, `Renderer`
- `server/internal/mail/render_test.go`
- `server/internal/mail/outbox.go`, `outbox_test.go`
- `server/internal/mail/password_reset.go`, `invite.go`, `welcome.go`
- `server/internal/mail/templates/layout.html`, `{verification_code,password_reset,workspace_invite,welcome}.{vi,en}.{html,txt}`
- `server/internal/service/password_reset.go`, `password_reset_test.go`
- `server/internal/handler/password_reset.go`

**Backend — sửa**
- `server/internal/mail/mail.go` (Message thêm Kind/Locale/UserID), `verification_code.go` (dùng Renderer)
- `server/internal/mail/templates/verification_code.{html,txt}` → xoá, thay bằng bản `.vi/.en`
- `server/internal/service/verification.go` (+`_test.go`), `auth.go` (Register nhận locale, UpdateProfile nhận locale), `workspace.go` (+`_test.go`), `onboarding.go` (+`_test.go`), `errors.go`
- `server/internal/handler/auth.go` (toUserDTO locale, patchMe locale, register locale, mapServiceError), `router.go`, `router/routes.go`, `router/auth.go`, `dto/sdi/auth.go`, `dto/sdo/auth.go`, `dto/sdo/workspace.go`, `workspace.go`, `auth_test.go` (newTestServer)
- `server/internal/testutil/db.go` (TRUNCATE thêm `emails, password_reset_tokens`)
- `server/internal/service/reserved_slugs.json`
- `server/cmd/server/main.go`, `.env.example`

**Frontend — tạo mới**
- `packages/views/auth/forgot-password-view.tsx`, `reset-password-view.tsx` (+ `.test.tsx`)
- `apps/web/app/(auth)/forgot-password/page.tsx`, `apps/web/app/(auth)/reset-password/page.tsx`
- `e2e/db.ts`, `e2e/reset-password.spec.ts`

**Frontend — sửa**
- `packages/core/types/user.ts`, `packages/core/api/endpoints/auth.ts` (+`.test.ts`), `packages/core/auth/hooks.ts`, `packages/core/paths/paths.ts`, `packages/core/paths/reserved-slugs.ts` (generated)
- `packages/core/api/endpoints/workspaces.ts` (bỏ `token`), `packages/views/workspace/invite-row.tsx`, `members-view.tsx`, `packages/views/onboarding/steps/step-invite.tsx`
- `packages/views/auth/login-view.tsx`, `apps/web/platform/locale.tsx`
- `packages/core/i18n/locales/vi.json`, `en.json`, `e2e/package.json`

---

### Task 1: Migrations + sqlc queries

**Files:**
- Create: `server/migrations/008_emails.up.sql`, `.down.sql`, `009_emails_pending_idx.*`, `010_emails_user_kind_idx.*`, `011_password_reset_tokens.*`, `012_password_reset_tokens_user_idx.*`, `013_users_locale.*`
- Create: `server/pkg/db/queries/emails.sql`, `server/pkg/db/queries/password_reset_tokens.sql`
- Modify: `server/pkg/db/queries/users.sql`, `server/pkg/db/queries/refresh_tokens.sql`, `server/internal/testutil/db.go`
- Test: `server/migrations/lint_test.go`, `server/migrations/migrate_test.go` (đã có)

**Interfaces:**
- Produces (sqlc): `db.Email`, `db.PasswordResetToken`, `db.User.Locale string`, và các hàm `CreateEmail`, `ClaimPendingEmails`, `MarkEmailSent`, `MarkEmailAttemptFailed`, `MarkEmailFailed`, `CountEmailsForUserKind`, `DeleteSentEmailsBefore`, `CreatePasswordResetToken`, `GetActivePasswordResetTokenByHash`, `GetLatestPasswordResetTokenForUser`, `MarkPasswordResetTokenUsed`, `DeletePasswordResetTokensForUser`, `DeleteExpiredPasswordResetTokens`, `UpdateUserLocale`, `UpdateUserPassword`, `RevokeAllRefreshTokensForUser`.

- [ ] **Step 1: Viết migrations**

`008_emails.up.sql`:
```sql
-- Outbox + lịch sử email. Không FK: user_id NULL khi mời email chưa có account,
-- và lịch sử phải sống lâu hơn user. Trạng thái suy từ timestamp:
-- sent_at/failed_at đều NULL = đang chờ.
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
`008_emails.down.sql`: `DROP TABLE IF EXISTS emails;`

`009_emails_pending_idx.up.sql`:
```sql
CREATE INDEX CONCURRENTLY idx_emails_pending ON emails(next_attempt_at) WHERE sent_at IS NULL AND failed_at IS NULL;
```
down: `DROP INDEX IF EXISTS idx_emails_pending;`

`010_emails_user_kind_idx.up.sql`:
```sql
CREATE INDEX CONCURRENTLY idx_emails_user_kind ON emails(user_id, kind) WHERE user_id IS NOT NULL;
```
down: `DROP INDEX IF EXISTS idx_emails_user_kind;`

`011_password_reset_tokens.up.sql`:
```sql
-- Token lưu băm sha256 như email_verification_codes. Không FK: service xoá
-- token của user khi dùng xong.
CREATE TABLE password_reset_tokens (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```
down: `DROP TABLE IF EXISTS password_reset_tokens;`

`012_password_reset_tokens_user_idx.up.sql`:
```sql
CREATE INDEX CONCURRENTLY idx_password_reset_tokens_user ON password_reset_tokens(user_id, created_at DESC);
```
down: `DROP INDEX IF EXISTS idx_password_reset_tokens_user;`

`013_users_locale.up.sql`:
```sql
-- Ngôn ngữ mail. Service chuẩn hoá về vi|en; không CHECK để thêm locale
-- không cần migration.
ALTER TABLE users ADD COLUMN locale TEXT NOT NULL DEFAULT 'vi';
```
down: `ALTER TABLE users DROP COLUMN IF EXISTS locale;`

- [ ] **Step 2: Viết queries**

`server/pkg/db/queries/emails.sql`:
```sql
-- name: CreateEmail :one
INSERT INTO emails (id, kind, to_email, user_id, locale, subject, html, text)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
RETURNING *;

-- Worker claim: chạy trong transaction; SKIP LOCKED để nhiều node không gửi trùng.
-- name: ClaimPendingEmails :many
SELECT * FROM emails
WHERE sent_at IS NULL AND failed_at IS NULL AND next_attempt_at <= now()
ORDER BY next_attempt_at
LIMIT $1
FOR UPDATE SKIP LOCKED;

-- name: MarkEmailSent :exec
UPDATE emails SET sent_at = now(), attempts = attempts + 1, last_error = NULL WHERE id = $1;

-- name: MarkEmailAttemptFailed :exec
UPDATE emails SET attempts = attempts + 1, next_attempt_at = $2, last_error = $3 WHERE id = $1;

-- name: MarkEmailFailed :exec
UPDATE emails SET attempts = attempts + 1, failed_at = now(), last_error = $2 WHERE id = $1;

-- name: CountEmailsForUserKind :one
SELECT count(*) FROM emails WHERE user_id = $1 AND kind = $2;

-- name: DeleteSentEmailsBefore :exec
DELETE FROM emails WHERE sent_at IS NOT NULL AND sent_at < $1;

-- Test/e2e: mail mới nhất gửi tới một địa chỉ theo kind.
-- name: GetLatestEmailForRecipient :one
SELECT * FROM emails WHERE to_email = $1 AND kind = $2 ORDER BY created_at DESC LIMIT 1;
```

`server/pkg/db/queries/password_reset_tokens.sql`:
```sql
-- name: CreatePasswordResetToken :one
INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at)
VALUES ($1, $2, $3, $4)
RETURNING *;

-- Chưa dùng và chưa hết hạn quyết định ở đây, caller không thể quên.
-- name: GetActivePasswordResetTokenByHash :one
SELECT * FROM password_reset_tokens
WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now();

-- name: GetLatestPasswordResetTokenForUser :one
SELECT * FROM password_reset_tokens WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1;

-- name: MarkPasswordResetTokenUsed :exec
UPDATE password_reset_tokens SET used_at = now() WHERE id = $1;

-- name: DeletePasswordResetTokensForUser :exec
DELETE FROM password_reset_tokens WHERE user_id = $1;

-- name: DeleteExpiredPasswordResetTokens :exec
DELETE FROM password_reset_tokens WHERE expires_at < now() - interval '1 day';
```

Thêm vào cuối `users.sql`:
```sql
-- name: UpdateUserLocale :one
UPDATE users SET locale = $2, updated_at = now()
WHERE id = $1
RETURNING *;

-- name: UpdateUserPassword :one
UPDATE users SET password_hash = $2, updated_at = now()
WHERE id = $1
RETURNING *;
```

Sửa `CreateUser` trong `users.sql` để nhận locale:
```sql
-- name: CreateUser :one
INSERT INTO users (id, email, password_hash, display_name, locale)
VALUES ($1, $2, $3, $4, $5)
RETURNING *;

-- name: CreateGoogleUser :one
INSERT INTO users (id, email, display_name, avatar_url, google_id, email_verified_at, locale)
VALUES ($1, $2, $3, $4, $5, now(), $6)
RETURNING *;
```

Thêm vào `refresh_tokens.sql`:
```sql
-- name: RevokeAllRefreshTokensForUser :exec
UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL;
```

- [ ] **Step 3: Regenerate sqlc, thêm bảng vào TRUNCATE**

Run: `make sqlc`
Sửa `server/internal/testutil/db.go` — câu `TRUNCATE` thêm `emails, password_reset_tokens` vào danh sách (trước `CASCADE`).

- [ ] **Step 4: Sửa các nơi gọi `CreateUser`/`CreateGoogleUser` cho compile**

`service/auth.go` `Register`: thêm `Locale: "vi"` vào `CreateUserParams` (Task 2 sẽ đưa locale thật vào). `service/googleauth.go`: thêm `Locale: "vi"` vào `CreateGoogleUserParams`.

Run: `cd server && go build ./... && go vet ./...`
Expected: OK.

- [ ] **Step 5: Chạy migration tests**

Run: `cd server && go test ./migrations/ ./internal/testutil/... -count=1`
Expected: PASS (lint kiểm tra up/down + CONCURRENTLY một mình một file).

- [ ] **Step 6: Commit**

```bash
git add server/migrations server/pkg/db server/internal/testutil server/internal/service/auth.go server/internal/service/googleauth.go
git commit -m "feat(db): emails outbox, password reset tokens, users.locale"
```

---

### Task 2: `users.locale` — đọc/ghi qua API

**Files:**
- Modify: `server/internal/service/auth.go`, `server/internal/service/googleauth.go`, `server/internal/handler/auth.go`, `server/internal/handler/google.go`, `server/internal/handler/dto/sdi/auth.go`, `server/internal/handler/dto/sdo/auth.go`
- Test: `server/internal/handler/auth_test.go`

**Interfaces:**
- Produces: `service.NormalizeLocale(s string) string` → `"vi"|"en"`; `AuthService.Register(ctx, email, password, displayName, locale string)`; `AuthService.UpdateProfile(ctx, userID string, displayName *string, locale *string) (db.User, error)`; `handler.requestLocale(r *http.Request) string`; `UserDTO.Locale`.
- Consumes: sqlc từ Task 1.

- [ ] **Step 1: Test handler thất bại**

Thêm vào `server/internal/handler/auth_test.go`:
```go
func TestRegisterPicksLocaleFromCookieThenAcceptLanguage(t *testing.T) {
	srv := newTestServer(t)
	body, _ := json.Marshal(map[string]string{"email": "loc@example.com", "password": "password123", "display_name": "L"})
	req, _ := http.NewRequest("POST", srv.URL+"/api/v1/auth/register", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept-Language", "en-US,en;q=0.9")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	var out map[string]any
	_ = json.NewDecoder(res.Body).Decode(&out)
	if got := out["user"].(map[string]any)["locale"]; got != "en" {
		t.Fatalf("locale from Accept-Language: want en, got %v", got)
	}

	body, _ = json.Marshal(map[string]string{"email": "loc2@example.com", "password": "password123", "display_name": "L"})
	req, _ = http.NewRequest("POST", srv.URL+"/api/v1/auth/register", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept-Language", "en")
	req.AddCookie(&http.Cookie{Name: "uniwork-locale", Value: "vi"})
	res, _ = http.DefaultClient.Do(req)
	_ = json.NewDecoder(res.Body).Decode(&out)
	if got := out["user"].(map[string]any)["locale"]; got != "vi" {
		t.Fatalf("cookie wins: want vi, got %v", got)
	}
	token := out["access_token"].(string)

	res, out = doJSON(t, srv, "PATCH", "/api/v1/me", token, map[string]string{"locale": "en"})
	if res.StatusCode != 200 || out["user"].(map[string]any)["locale"] != "en" {
		t.Fatalf("patch locale: %d %v", res.StatusCode, out)
	}
	res, _ = doJSON(t, srv, "PATCH", "/api/v1/me", token, map[string]string{"locale": "fr"})
	if res.StatusCode != 400 {
		t.Fatalf("unsupported locale must be 400, got %d", res.StatusCode)
	}
}
```
(`doJSON` đã có trong `onboarding_test.go` cùng package.)

Run: `cd server && go test ./internal/handler/ -run TestRegisterPicksLocale -count=1`
Expected: FAIL — `locale` không có trong response.

- [ ] **Step 2: Service**

`service/auth.go`:
```go
// NormalizeLocale maps any tag to a mail locale we have templates for.
func NormalizeLocale(s string) string {
	if strings.HasPrefix(strings.ToLower(strings.TrimSpace(s)), "en") {
		return "en"
	}
	return "vi"
}

func (s *AuthService) Register(ctx context.Context, email, password, displayName, locale string) (Session, error) {
	// ... validation như cũ ...
	u, err := s.q.CreateUser(ctx, db.CreateUserParams{
		ID: util.NewID(), Email: email, PasswordHash: pgtype.Text{String: hash, Valid: true},
		DisplayName: displayName, Locale: NormalizeLocale(locale),
	})
	// ... như cũ
}

// UpdateProfile changes display name and/or mail locale; nil leaves a field alone.
func (s *AuthService) UpdateProfile(ctx context.Context, userID string, displayName, locale *string) (db.User, error) {
	if displayName == nil && locale == nil {
		return db.User{}, Invalid("cần display_name hoặc locale")
	}
	var u db.User
	var err error
	if displayName != nil {
		name := strings.TrimSpace(*displayName)
		if name == "" {
			return db.User{}, Invalid("tên hiển thị không được để trống")
		}
		if utf8.RuneCountInString(name) > maxDisplayNameRunes {
			return db.User{}, Invalid("tên hiển thị quá dài")
		}
		u, err = s.q.UpdateUserDisplayName(ctx, db.UpdateUserDisplayNameParams{ID: userID, DisplayName: name})
		if errors.Is(err, pgx.ErrNoRows) {
			return db.User{}, ErrNotFound
		}
		if err != nil {
			return db.User{}, err
		}
	}
	if locale != nil {
		if *locale != "vi" && *locale != "en" {
			return db.User{}, Invalid("locale phải là vi hoặc en")
		}
		u, err = s.q.UpdateUserLocale(ctx, db.UpdateUserLocaleParams{ID: userID, Locale: *locale})
		if errors.Is(err, pgx.ErrNoRows) {
			return db.User{}, ErrNotFound
		}
		if err != nil {
			return db.User{}, err
		}
	}
	return u, nil
}
```
`service/googleauth.go`: hàm tạo user Google nhận thêm tham số `locale string` và truyền `Locale: NormalizeLocale(locale)`; cập nhật chữ ký hàm public tương ứng và chỗ gọi trong `handler/google.go` (truyền `requestLocale(r)`). Cập nhật `verification_test.go`, `helpers_test.go`, `googleauth_test.go`, `auth_test.go` (service) cho chữ ký `Register(..., "vi")`.

- [ ] **Step 3: Handler**

`handler/auth.go`:
```go
// requestLocale: cookie uniwork-locale (frontend ghi) rồi Accept-Language; mặc định vi.
func requestLocale(r *http.Request) string {
	if c, err := r.Cookie("uniwork-locale"); err == nil && c.Value != "" {
		return service.NormalizeLocale(c.Value)
	}
	return service.NormalizeLocale(r.Header.Get("Accept-Language"))
}
```
`register`: `h.Auth.Register(r.Context(), in.Email, in.Password, in.DisplayName, requestLocale(r))`.
`patchMe`: bỏ check `DisplayName == nil`; gọi `h.Auth.UpdateProfile(ctx, uid, in.DisplayName, in.Locale)`.
`toUserDTO`: `Locale: u.Locale`.

`dto/sdi/auth.go` `PatchMeSDI` thêm:
```go
Locale *string `json:"locale" description:"Ngôn ngữ email: vi hoặc en" example:"vi"`
```
`dto/sdo/auth.go` `UserDTO` thêm:
```go
Locale string `json:"locale" description:"Ngôn ngữ email của người dùng" example:"vi"`
```
`router/me.go` mô tả PATCH /me: "Đổi tên hiển thị hoặc ngôn ngữ email."

- [ ] **Step 4: Chạy test**

Run: `cd server && go test ./internal/... -count=1`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server
git commit -m "feat(auth): users.locale from request, PATCH /me locale"
```

---

### Task 3: `mail` render — layout, template vi/en, subject trong `.txt`

**Files:**
- Create: `server/internal/mail/render.go`, `render_test.go`, `templates/layout.html`, `templates/verification_code.{vi,en}.{html,txt}`
- Modify: `server/internal/mail/mail.go`, `verification_code.go`
- Delete: `templates/verification_code.html`, `templates/verification_code.txt`

**Interfaces:**
- Produces:
  ```go
  type Message struct { Kind, Locale, UserID, To, Subject, HTML, Text string }
  type Renderer struct { AppURL string }
  func (Renderer) VerificationCode(to, locale, userID string, d VerificationData) (Message, error)
  type VerificationData struct { Code string; ExpiresInMinutes int }
  func SafeField(s string) string      // strip control, cắt 60 rune — cho tên user/workspace
  const KindVerificationCode = "verification_code" // + KindPasswordReset, KindWorkspaceInvite, KindWelcome
  ```
  `renderKind(kind, locale string, data any) (subject, html, text string, err error)` nội bộ.

- [ ] **Step 1: Test thất bại**

`server/internal/mail/render_test.go`:
```go
package mail

import (
	"strings"
	"testing"
)

func TestVerificationCodeRendersBothLocales(t *testing.T) {
	r := Renderer{AppURL: "http://localhost:3000"}
	for _, loc := range []string{"vi", "en"} {
		m, err := r.VerificationCode("a@example.com", loc, "u1", VerificationData{Code: "123456", ExpiresInMinutes: 10})
		if err != nil {
			t.Fatalf("%s: %v", loc, err)
		}
		if m.Kind != KindVerificationCode || m.Locale != loc || m.UserID != "u1" || m.To != "a@example.com" {
			t.Fatalf("%s: envelope %+v", loc, m)
		}
		if !strings.Contains(m.Subject, "123456") || strings.ContainsAny(m.Subject, "\r\n") {
			t.Fatalf("%s: subject %q", loc, m.Subject)
		}
		if !strings.Contains(m.HTML, "123456") || !strings.Contains(m.Text, "123456") {
			t.Fatalf("%s: code missing from body", loc)
		}
		if !strings.Contains(m.HTML, "UniWork") || !strings.Contains(m.HTML, "http://localhost:3000") {
			t.Fatalf("%s: layout not applied", loc)
		}
	}
	m, _ := r.VerificationCode("a@example.com", "fr", "", VerificationData{Code: "1", ExpiresInMinutes: 1})
	if m.Locale != "vi" {
		t.Fatalf("unknown locale must fall back to vi, got %q", m.Locale)
	}
}

func TestSafeFieldStripsControlAndCaps(t *testing.T) {
	got := SafeField("Acme\r\nBcc: x@y.z " + strings.Repeat("a", 100))
	if strings.ContainsAny(got, "\r\n") || len([]rune(got)) > 60 {
		t.Fatalf("got %q", got)
	}
}
```

Run: `cd server && go test ./internal/mail/ -run 'TestVerificationCode|TestSafeField' -count=1`
Expected: FAIL — `Renderer` undefined.

- [ ] **Step 2: `mail.go` — mở rộng Message**

```go
const (
	KindVerificationCode = "verification_code"
	KindPasswordReset    = "password_reset"
	KindWorkspaceInvite  = "workspace_invite"
	KindWelcome          = "welcome"
)

type Message struct {
	Kind    string // Kind* constants
	Locale  string // "vi" | "en"
	UserID  string // "" when the recipient has no account (invites)
	To      string
	Subject string
	HTML    string
	Text    string
}
```
`LogSender.Send` log thêm `"kind", msg.Kind`.

- [ ] **Step 3: `render.go`**

```go
package mail

import (
	"bytes"
	"embed"
	"fmt"
	htmltemplate "html/template"
	"strings"
	texttemplate "text/template"
	"unicode"
	"unicode/utf8"
)

//go:embed templates/*.html templates/*.txt
var templateFS embed.FS

var kinds = []string{KindVerificationCode, KindPasswordReset, KindWorkspaceInvite, KindWelcome}
var locales = []string{"vi", "en"}

// One parsed pair per kind×locale; a missing file panics at boot, which is
// the earliest a template mistake can surface.
var (
	htmlTemplates = map[string]*htmltemplate.Template{}
	textTemplates = map[string]*texttemplate.Template{}
)

func init() {
	for _, k := range kinds {
		for _, l := range locales {
			key := k + "." + l
			htmlTemplates[key] = htmltemplate.Must(htmltemplate.ParseFS(templateFS, "templates/layout.html", "templates/"+key+".html"))
			textTemplates[key] = texttemplate.Must(texttemplate.ParseFS(templateFS, "templates/"+key+".txt"))
		}
	}
}

// Renderer builds Messages. AppURL is FRONTEND_ORIGIN; every link in a mail
// starts with it. Services hold a Renderer by value.
type Renderer struct {
	AppURL string
}

// layoutData is what every template sees: the kind's data plus the app URL
// for links and the footer.
type layoutData struct {
	AppURL string
	Data   any
}

func normalizeLocale(l string) string {
	if l == "en" {
		return "en"
	}
	return "vi"
}

// renderKind executes the html (through layout) and text templates. The
// text file's first line is "Subject: …"; it is the subject for both parts.
func renderKind(kind, locale, appURL string, data any) (subject, html, text string, err error) {
	key := kind + "." + locale
	ld := layoutData{AppURL: appURL, Data: data}
	var hb, tb bytes.Buffer
	if err := htmlTemplates[key].ExecuteTemplate(&hb, "layout", ld); err != nil {
		return "", "", "", fmt.Errorf("render %s html: %w", key, err)
	}
	if err := textTemplates[key].Execute(&tb, ld); err != nil {
		return "", "", "", fmt.Errorf("render %s text: %w", key, err)
	}
	raw := tb.String()
	first, rest, _ := strings.Cut(raw, "\n")
	if !strings.HasPrefix(first, "Subject:") {
		return "", "", "", fmt.Errorf("render %s: text template must start with 'Subject:'", key)
	}
	subject = sanitizeSubject(strings.TrimSpace(strings.TrimPrefix(first, "Subject:")))
	return subject, hb.String(), strings.TrimLeft(rest, "\n"), nil
}

const maxSubjectRunes = 200
const maxFieldRunes = 60

// sanitizeSubject drops control characters (header injection) and caps length.
func sanitizeSubject(s string) string { return stripControl(s, maxSubjectRunes) }

// SafeField prepares user-controlled text (display name, workspace name) for
// a subject or body: no control characters, at most 60 runes so a workspace
// name cannot become a phishing subject.
func SafeField(s string) string { return stripControl(s, maxFieldRunes) }

func stripControl(s string, max int) string {
	var b strings.Builder
	for _, r := range s {
		if !unicode.IsControl(r) {
			b.WriteRune(r)
		}
	}
	out := strings.TrimSpace(b.String())
	if utf8.RuneCountInString(out) <= max {
		return out
	}
	return string([]rune(out)[:max-1]) + "…"
}
```

- [ ] **Step 4: `verification_code.go` (thay toàn bộ)**

```go
package mail

type VerificationData struct {
	Code             string
	ExpiresInMinutes int
}

// VerificationCode is the sign-up code mail. The expiry is a parameter so
// the copy and the service that enforces it share one number.
func (r Renderer) VerificationCode(to, locale, userID string, d VerificationData) (Message, error) {
	locale = normalizeLocale(locale)
	subject, html, text, err := renderKind(KindVerificationCode, locale, r.AppURL, d)
	if err != nil {
		return Message{}, err
	}
	return Message{Kind: KindVerificationCode, Locale: locale, UserID: userID, To: to, Subject: subject, HTML: html, Text: text}, nil
}
```

- [ ] **Step 5: Templates**

`templates/layout.html` (style inline, bảng, không ảnh ngoài; logo là ô gradient + chữ):
```html
{{define "layout"}}<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f5f5f7;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:480px;margin:0 auto;background:#fff;border-radius:12px;padding:32px">
      <tr><td style="padding-bottom:20px">
        <table role="presentation" cellspacing="0" cellpadding="0"><tr>
          <td style="width:32px;height:32px;border-radius:8px;background:#3C83F6;text-align:center;vertical-align:middle;color:#fff;font-size:16px;line-height:32px">&#10022;</td>
          <td style="padding-left:10px;font-size:18px;font-weight:700;letter-spacing:-0.01em">UniWork</td>
        </tr></table>
      </td></tr>
      {{template "content" .}}
      <tr><td style="padding-top:24px;font-size:12px;line-height:1.5;color:#888;border-top:1px solid #eee">
        {{template "footer" .}} <a href="{{.AppURL}}" style="color:#888">{{.AppURL}}</a>
      </td></tr>
    </table>
  </body>
</html>{{end}}
```
Mỗi file `kind.locale.html` định nghĩa `{{define "content"}}…{{end}}` và `{{define "footer"}}…{{end}}`.

`verification_code.vi.html`:
```html
{{define "content"}}
<tr><td style="font-size:15px;line-height:1.5;padding-bottom:16px">Mã xác thực email của bạn:</td></tr>
<tr><td style="font-size:32px;font-weight:700;letter-spacing:8px;font-family:SFMono-Regular,Menlo,Consolas,monospace;padding-bottom:16px">{{.Data.Code}}</td></tr>
<tr><td style="font-size:13px;line-height:1.5;color:#555">Mã hết hạn sau {{.Data.ExpiresInMinutes}} phút. Nếu bạn không đăng ký UniWork, bỏ qua email này.</td></tr>
{{end}}
{{define "footer"}}Bạn nhận email này vì vừa đăng ký UniWork.{{end}}
```
`verification_code.vi.txt`:
```
Subject: {{.Data.Code}} là mã xác thực UniWork của bạn

Mã xác thực email UniWork của bạn: {{.Data.Code}}

Mã hết hạn sau {{.Data.ExpiresInMinutes}} phút. Nếu bạn không đăng ký UniWork, bỏ qua email này.
```
`verification_code.en.html`:
```html
{{define "content"}}
<tr><td style="font-size:15px;line-height:1.5;padding-bottom:16px">Your email verification code:</td></tr>
<tr><td style="font-size:32px;font-weight:700;letter-spacing:8px;font-family:SFMono-Regular,Menlo,Consolas,monospace;padding-bottom:16px">{{.Data.Code}}</td></tr>
<tr><td style="font-size:13px;line-height:1.5;color:#555">The code expires in {{.Data.ExpiresInMinutes}} minutes. If you did not sign up for UniWork, ignore this email.</td></tr>
{{end}}
{{define "footer"}}You received this email because you signed up for UniWork.{{end}}
```
`verification_code.en.txt`:
```
Subject: {{.Data.Code}} is your UniWork verification code

Your UniWork verification code: {{.Data.Code}}

The code expires in {{.Data.ExpiresInMinutes}} minutes. If you did not sign up for UniWork, ignore this email.
```

Để `init()` không panic trước khi Task 6/7/9 thêm template, **tạo ngay trong task này** 12 file placeholder cho ba kind còn lại với nội dung tối thiểu hợp lệ (sẽ được thay ở task sau):
- `password_reset.{vi,en}.html`, `workspace_invite.{vi,en}.html`, `welcome.{vi,en}.html`: `{{define "content"}}<tr><td>{{.Data}}</td></tr>{{end}}{{define "footer"}}UniWork{{end}}`
- `.txt` tương ứng: dòng 1 `Subject: UniWork`, dòng trống, `{{.Data}}`.

Xoá `templates/verification_code.html` và `.txt` cũ.

- [ ] **Step 6: Chạy test**

Run: `cd server && go test ./internal/mail/ -count=1`
Expected: PASS (kể cả `smtp_test.go` cũ).

- [ ] **Step 7: Commit**

```bash
git add server/internal/mail
git commit -m "feat(mail): renderer with layout, vi/en templates, subject in txt"
```

---

### Task 4: `mail.Outbox` — enqueue + worker + retry

**Files:**
- Create: `server/internal/mail/outbox.go`, `server/internal/mail/outbox_test.go`

**Interfaces:**
- Produces:
  ```go
  type Enqueuer interface {
      Enqueue(ctx context.Context, q *db.Queries, msg Message) (string, error)
      Kick()
  }
  func NewOutbox(pool *pgxpool.Pool, sender Sender, log *slog.Logger) *Outbox
  func (o *Outbox) Enqueue(ctx, q *db.Queries, msg Message) (string, error)
  func (o *Outbox) Kick()
  func (o *Outbox) Run(ctx context.Context)          // blocking loop
  func (o *Outbox) RunOnce(ctx context.Context) (int, error) // một vòng claim+gửi; test và Run dùng chung
  ```
- Consumes: `db.CreateEmail`, `ClaimPendingEmails`, `MarkEmail*` (Task 1), `Sender`, `Message` (Task 3).

- [ ] **Step 1: Test thất bại**

`server/internal/mail/outbox_test.go`:
```go
package mail

import (
	"context"
	"errors"
	"log/slog"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/testutil"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

type flakySender struct {
	mu    sync.Mutex
	fails int // số lần đầu trả lỗi
	sent  []Message
}

func (f *flakySender) Send(_ context.Context, m Message) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.fails > 0 {
		f.fails--
		return errors.New("smtp down")
	}
	f.sent = append(f.sent, m)
	return nil
}

func msg(to string) Message {
	return Message{Kind: KindWelcome, Locale: "vi", To: to, Subject: "s", HTML: "<p>h</p>", Text: "t"}
}

func TestOutboxRetriesWithBackoffThenGivesUp(t *testing.T) {
	pool := testutil.DB(t)
	q := db.New(pool)
	s := &flakySender{fails: 10}
	o := NewOutbox(pool, s, slog.Default())
	now := time.Date(2026, 8, 28, 9, 0, 0, 0, time.UTC)
	o.now = func() time.Time { return now }
	ctx := context.Background()
	id, err := o.Enqueue(ctx, q, msg("a@example.com"))
	if err != nil {
		t.Fatal(err)
	}
	want := []time.Duration{time.Minute, 5 * time.Minute, 30 * time.Minute, 2 * time.Hour}
	for i, d := range want {
		if _, err := o.RunOnce(ctx); err != nil {
			t.Fatal(err)
		}
		row, _ := q.GetLatestEmailForRecipient(ctx, db.GetLatestEmailForRecipientParams{ToEmail: "a@example.com", Kind: KindWelcome})
		if row.Attempts != int32(i+1) || !row.NextAttemptAt.Time.Equal(now.Add(d)) || row.FailedAt.Valid {
			t.Fatalf("attempt %d: attempts=%d next=%v failed=%v", i+1, row.Attempts, row.NextAttemptAt.Time, row.FailedAt.Valid)
		}
		// Đẩy giả lập thời gian qua mốc retry để lần sau claim được.
		_, _ = pool.Exec(ctx, "UPDATE emails SET next_attempt_at = now() WHERE id = $1", id)
	}
	if _, err := o.RunOnce(ctx); err != nil {
		t.Fatal(err)
	}
	row, _ := q.GetLatestEmailForRecipient(ctx, db.GetLatestEmailForRecipientParams{ToEmail: "a@example.com", Kind: KindWelcome})
	if row.Attempts != 5 || !row.FailedAt.Valid || row.SentAt.Valid {
		t.Fatalf("after 5 failures: %+v", row)
	}
	if _ = util.NewID(); false {
	}
}

func TestOutboxSendsOnceAcrossTwoWorkers(t *testing.T) {
	pool := testutil.DB(t)
	q := db.New(pool)
	s := &flakySender{}
	ctx := context.Background()
	for i := 0; i < 50; i++ {
		if _, err := NewOutbox(pool, s, slog.Default()).Enqueue(ctx, q, msg("b@example.com")); err != nil {
			t.Fatal(err)
		}
	}
	var wg sync.WaitGroup
	var total atomic.Int32
	for w := 0; w < 2; w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			o := NewOutbox(pool, s, slog.Default())
			for {
				n, err := o.RunOnce(ctx)
				if err != nil {
					t.Error(err)
					return
				}
				if n == 0 {
					return
				}
				total.Add(int32(n))
			}
		}()
	}
	wg.Wait()
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.sent) != 50 || total.Load() != 50 {
		t.Fatalf("sent %d, processed %d", len(s.sent), total.Load())
	}
}

func TestOutboxKickWakesRun(t *testing.T) {
	pool := testutil.DB(t)
	q := db.New(pool)
	s := &flakySender{}
	o := NewOutbox(pool, s, slog.Default())
	o.tick = time.Hour // tick không thể là lý do gửi
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go o.Run(ctx)
	if _, err := o.Enqueue(ctx, q, msg("c@example.com")); err != nil {
		t.Fatal(err)
	}
	o.Kick()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		s.mu.Lock()
		n := len(s.sent)
		s.mu.Unlock()
		if n == 1 {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("Kick did not wake the worker")
}
```
(Bỏ dòng `if _ = util.NewID(); false {}` nếu `util` không cần — chỉ giữ import khi dùng.)

Run: `cd server && go test ./internal/mail/ -run TestOutbox -count=1`
Expected: FAIL — `NewOutbox` undefined.

- [ ] **Step 2: `outbox.go`**

```go
package mail

import (
	"context"
	"errors"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Enqueuer is what services hold: queue a rendered message, optionally on
// the caller's transaction, and nudge the worker.
type Enqueuer interface {
	Enqueue(ctx context.Context, q *db.Queries, msg Message) (string, error)
	Kick()
}

const (
	outboxBatch     = 20
	outboxMaxTries  = 5
	outboxRetention = 30 * 24 * time.Hour
	defaultTick     = 5 * time.Second
)

// backoff[n] is the wait after the (n+1)th failure; the 5th failure gives up.
var backoff = []time.Duration{time.Minute, 5 * time.Minute, 30 * time.Minute, 2 * time.Hour, 6 * time.Hour}

// Outbox stores mail in the emails table and delivers it from Run. One
// goroutine per process; several processes are safe because the claim uses
// FOR UPDATE SKIP LOCKED. Delivery is at-least-once: a crash between Send
// and commit re-sends that one message.
type Outbox struct {
	pool   *pgxpool.Pool
	q      *db.Queries
	sender Sender
	log    *slog.Logger
	kick   chan struct{}
	tick   time.Duration
	now    func() time.Time
}

func NewOutbox(pool *pgxpool.Pool, sender Sender, log *slog.Logger) *Outbox {
	if log == nil {
		log = slog.Default()
	}
	return &Outbox{pool: pool, q: db.New(pool), sender: sender, log: log,
		kick: make(chan struct{}, 1), tick: defaultTick, now: time.Now}
}

// Enqueue inserts the message. q lets the caller pass its transaction's
// Queries so the row commits with the business change; pass o.q-equivalent
// (any Queries on the pool) otherwise.
func (o *Outbox) Enqueue(ctx context.Context, q *db.Queries, msg Message) (string, error) {
	if q == nil {
		q = o.q
	}
	row, err := q.CreateEmail(ctx, db.CreateEmailParams{
		ID: util.NewID(), Kind: msg.Kind, ToEmail: msg.To,
		UserID: pgtype.Text{String: msg.UserID, Valid: msg.UserID != ""},
		Locale: msg.Locale, Subject: msg.Subject, Html: msg.HTML, Text: msg.Text,
	})
	if err != nil {
		return "", err
	}
	return row.ID, nil
}

// Kick wakes Run before the next tick. Non-blocking; a pending kick is enough.
func (o *Outbox) Kick() {
	select {
	case o.kick <- struct{}{}:
	default:
	}
}

// Run delivers until ctx is done. A full batch loops immediately; otherwise
// it waits for a tick or a Kick. Once an hour it prunes old history.
func (o *Outbox) Run(ctx context.Context) {
	o.log.Info("mail: outbox worker started", "tick", o.tick)
	ticker := time.NewTicker(o.tick)
	defer ticker.Stop()
	lastPrune := o.now()
	for {
		n, err := o.RunOnce(ctx)
		if err != nil && !errors.Is(err, context.Canceled) {
			o.log.Error("mail: outbox run", "err", err)
		}
		if o.now().Sub(lastPrune) > time.Hour {
			lastPrune = o.now()
			if err := o.q.DeleteSentEmailsBefore(ctx, pgtype.Timestamptz{Time: o.now().Add(-outboxRetention), Valid: true}); err != nil {
				o.log.Warn("mail: prune history", "err", err)
			}
			if err := o.q.DeleteExpiredPasswordResetTokens(ctx); err != nil {
				o.log.Warn("mail: prune reset tokens", "err", err)
			}
		}
		if n == outboxBatch {
			continue
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		case <-o.kick:
		}
	}
}

// RunOnce claims one batch, sends each row, records the outcome, commits.
// Returns how many rows it claimed.
func (o *Outbox) RunOnce(ctx context.Context) (int, error) {
	tx, err := o.pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	qtx := o.q.WithTx(tx)
	rows, err := qtx.ClaimPendingEmails(ctx, outboxBatch)
	if err != nil {
		return 0, err
	}
	for _, row := range rows {
		o.deliver(ctx, qtx, row)
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}
	return len(rows), nil
}

func (o *Outbox) deliver(ctx context.Context, q *db.Queries, row db.Email) {
	msg := Message{Kind: row.Kind, Locale: row.Locale, UserID: row.UserID.String, To: row.ToEmail,
		Subject: row.Subject, HTML: row.Html, Text: row.Text}
	sendErr := o.sender.Send(ctx, msg)
	if sendErr == nil {
		if err := q.MarkEmailSent(ctx, row.ID); err != nil {
			o.log.Error("mail: mark sent", "id", row.ID, "err", err)
		}
		return
	}
	attempt := int(row.Attempts) + 1
	if attempt >= outboxMaxTries {
		o.log.Error("mail: giving up", "kind", row.Kind, "to", row.ToEmail, "attempts", attempt, "err", sendErr)
		if err := q.MarkEmailFailed(ctx, db.MarkEmailFailedParams{ID: row.ID, LastError: pgtype.Text{String: sendErr.Error(), Valid: true}}); err != nil {
			o.log.Error("mail: mark failed", "id", row.ID, "err", err)
		}
		return
	}
	next := o.now().Add(backoff[attempt-1])
	o.log.Warn("mail: send failed, will retry", "kind", row.Kind, "to", row.ToEmail, "attempts", attempt, "next", next, "err", sendErr)
	if err := q.MarkEmailAttemptFailed(ctx, db.MarkEmailAttemptFailedParams{
		ID: row.ID, NextAttemptAt: pgtype.Timestamptz{Time: next, Valid: true},
		LastError: pgtype.Text{String: sendErr.Error(), Valid: true},
	}); err != nil {
		o.log.Error("mail: mark attempt", "id", row.ID, "err", err)
	}
}
```
Kiểm tra tên field sqlc sinh ra (`Html`, `UserID`, `NextAttemptAt`, `LastError`) trong `server/pkg/db/generated/emails.sql.go` và sửa cho khớp.

- [ ] **Step 3: Chạy test**

Run: `cd server && go test ./internal/mail/ -run TestOutbox -count=1 -race`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add server/internal/mail
git commit -m "feat(mail): postgres outbox worker with retry backoff"
```

---

### Task 5: Wiring — `main.go`, `VerificationService` qua outbox, test server

**Files:**
- Modify: `server/cmd/server/main.go`, `server/internal/service/verification.go`, `verification_test.go`, `server/internal/handler/auth_test.go`, `.env.example`

**Interfaces:**
- Produces: `service.NewVerificationService(q *db.Queries, r mail.Renderer, out mail.Enqueuer, devCode string)`; `handler.Deps` không đổi.
- Consumes: `mail.NewOutbox`, `mail.Renderer` (Task 3–4).

- [ ] **Step 1: Đổi test fixture (thất bại trước)**

`service/verification_test.go`: thay `fakeSender` bằng `fakeOutbox`:
```go
type fakeOutbox struct {
	mu     sync.Mutex
	queued []mail.Message
	kicks  int
}

func (f *fakeOutbox) Enqueue(_ context.Context, _ *db.Queries, m mail.Message) (string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.queued = append(f.queued, m)
	return fmt.Sprintf("e%d", len(f.queued)), nil
}
func (f *fakeOutbox) Kick() { f.mu.Lock(); f.kicks++; f.mu.Unlock() }
func (f *fakeOutbox) last(t *testing.T) mail.Message { /* như fakeSender.last cũ, đọc f.queued */ }
```
`newVerificationFixture`: `verify := NewVerificationService(q, mail.Renderer{AppURL: "http://localhost:3000"}, out, devCode)`; fixture field `sender` → `out *fakeOutbox`. Thay mọi `f.sender` → `f.out`. Thêm assertion trong `TestRegisterSendsVerificationCodeAndConfirmVerifies`: `if m := f.out.last(t); m.Kind != mail.KindVerificationCode || m.Locale != "vi" || m.UserID != u.ID { t.Fatalf("envelope %+v", m) }` và `if f.out.kicks == 0 { t.Fatal("no kick") }`.

`handler/auth_test.go`: thay `discardSender` bằng
```go
type discardOutbox struct{}

func (discardOutbox) Enqueue(context.Context, *db.Queries, mail.Message) (string, error) { return "e", nil }
func (discardOutbox) Kick()                                                            {}
```
và `service.NewVerificationService(q, mail.Renderer{AppURL: "http://localhost:3000"}, discardOutbox{}, testDevCode)`. Đặt `discardOutbox` ở `auth_test.go` để các test khác cùng package dùng.

Run: `cd server && go vet ./internal/...`
Expected: lỗi compile — chữ ký `NewVerificationService`.

- [ ] **Step 2: `verification.go`**

```go
type VerificationService struct {
	q       *db.Queries
	render  mail.Renderer
	out     mail.Enqueuer
	devCode string
	now     func() time.Time
}

func NewVerificationService(q *db.Queries, r mail.Renderer, out mail.Enqueuer, devCode string) *VerificationService {
	return &VerificationService{q: q, render: r, out: out, devCode: devCode, now: time.Now}
}
```
Trong `Send`, thay đoạn `mail.VerificationCode(...)` + `s.mail.Send(...)` bằng:
```go
	msg, err := s.render.VerificationCode(u.Email, u.Locale, u.ID, mail.VerificationData{Code: code, ExpiresInMinutes: int(verificationCodeTTL / time.Minute)})
	if err != nil {
		return err
	}
	if _, err := s.out.Enqueue(ctx, s.q, msg); err != nil {
		return fmt.Errorf("queue verification mail: %w", err)
	}
	s.out.Kick()
```

- [ ] **Step 3: `main.go`**

Sau khi tạo `sender`:
```go
	outbox := mail.NewOutbox(pool, sender, log)
	renderer := mail.Renderer{AppURL: cfg.FrontendOrigin}
	verification := service.NewVerificationService(q, renderer, outbox, cfg.DevVerificationCode())
```
Cần một `ctx` huỷ được cho worker: tìm chỗ `main` xử lý SIGTERM (phần sau `errCh`); tạo `workerCtx, stopWorker := context.WithCancel(ctx)` ngay trước `go outbox.Run(workerCtx)` (đặt sau khi `h` được tạo), và gọi `stopWorker()` ngay sau khi `srv.Shutdown` trả về trong nhánh tắt máy.

`.env.example` mục Email thêm dòng:
```
# Mail đi qua bảng emails và một worker trong process (retry 5 lần, backoff
# 1m→6h). Với SMTP_HOST trống, worker in mail ra log ngay sau khi ghi.
```

- [ ] **Step 4: Test toàn bộ**

Run: `make test-go`
Expected: PASS, gofmt/vet/staticcheck sạch.

- [ ] **Step 5: Commit**

```bash
git add server .env.example
git commit -m "feat(mail): route verification mail through the outbox"
```

---

### Task 6: `workspace_invite` — template, `InviteMany` gửi mail, API/UI bỏ token

**Files:**
- Create: `server/internal/mail/invite.go`; thay placeholder `templates/workspace_invite.{vi,en}.{html,txt}`
- Modify: `server/internal/mail/render_test.go`, `server/internal/service/workspace.go`, `workspace_test.go`, `onboarding_test.go` (fixture), `server/internal/handler/workspace.go`, `dto/sdo/workspace.go`, `handler/auth_test.go` (newTestServer), `server/cmd/server/main.go`
- Modify FE: `packages/core/api/endpoints/workspaces.ts`, `packages/views/workspace/invite-row.tsx`, `members-view.tsx`, `packages/views/onboarding/steps/step-invite.tsx`, `packages/core/i18n/locales/{vi,en}.json`

**Interfaces:**
- Produces: `mail.InviteData{InviterName, WorkspaceName, AcceptURL string; ExpiresInDays int}`; `(Renderer) Invite(to, locale string, d InviteData) (Message, error)`; `service.NewWorkspaceService(pool, q, orgs, r mail.Renderer, out mail.Enqueuer)`.
- Consumes: `mail.SafeField`, `Enqueuer`.

- [ ] **Step 1: Test render thất bại**

Thêm vào `render_test.go`:
```go
func TestInviteEscapesUserFields(t *testing.T) {
	r := Renderer{AppURL: "http://localhost:3000"}
	for _, loc := range []string{"vi", "en"} {
		m, err := r.Invite("b@example.com", loc, InviteData{
			InviterName: "An <script>alert(1)</script>", WorkspaceName: "Đội\r\nAlpha",
			AcceptURL: "http://localhost:3000/invite/tok", ExpiresInDays: 7,
		})
		if err != nil {
			t.Fatal(err)
		}
		if strings.Contains(m.HTML, "<script>") || strings.ContainsAny(m.Subject, "\r\n") {
			t.Fatalf("%s: unsafe output subject=%q", loc, m.Subject)
		}
		if !strings.Contains(m.HTML, "http://localhost:3000/invite/tok") || !strings.Contains(m.Text, "http://localhost:3000/invite/tok") {
			t.Fatalf("%s: accept url missing", loc)
		}
		if m.Kind != KindWorkspaceInvite || m.UserID != "" {
			t.Fatalf("%s: envelope %+v", loc, m)
		}
	}
}
```
Run: `cd server && go test ./internal/mail/ -run TestInvite -count=1` → FAIL.

- [ ] **Step 2: `invite.go` + templates**

```go
package mail

type InviteData struct {
	InviterName   string
	WorkspaceName string
	AcceptURL     string
	ExpiresInDays int
}

// Invite goes to an address that may have no account, so UserID is empty
// and the locale is the inviter's. User fields are trimmed with SafeField.
func (r Renderer) Invite(to, locale string, d InviteData) (Message, error) {
	locale = normalizeLocale(locale)
	d.InviterName = SafeField(d.InviterName)
	d.WorkspaceName = SafeField(d.WorkspaceName)
	subject, html, text, err := renderKind(KindWorkspaceInvite, locale, r.AppURL, d)
	if err != nil {
		return Message{}, err
	}
	return Message{Kind: KindWorkspaceInvite, Locale: locale, To: to, Subject: subject, HTML: html, Text: text}, nil
}
```
`workspace_invite.vi.html`:
```html
{{define "content"}}
<tr><td style="font-size:20px;font-weight:700;padding-bottom:12px">Bạn được mời vào {{.Data.WorkspaceName}}</td></tr>
<tr><td style="font-size:15px;line-height:1.5;padding-bottom:20px"><strong>{{.Data.InviterName}}</strong> mời bạn cùng làm việc trong workspace <strong>{{.Data.WorkspaceName}}</strong> trên UniWork.</td></tr>
<tr><td style="padding-bottom:20px"><a href="{{.Data.AcceptURL}}" style="display:inline-block;padding:12px 24px;background:#3C83F6;color:#fff;text-decoration:none;border-radius:8px;font-weight:600">Chấp nhận lời mời</a></td></tr>
<tr><td style="font-size:13px;line-height:1.5;color:#555">Lời mời hết hạn sau {{.Data.ExpiresInDays}} ngày. Bạn cần đăng nhập hoặc tạo tài khoản bằng đúng email này để tham gia.</td></tr>
{{end}}
{{define "footer"}}Bạn nhận email này vì một thành viên UniWork đã mời bạn.{{end}}
```
`workspace_invite.vi.txt`:
```
Subject: {{.Data.InviterName}} mời bạn vào {{.Data.WorkspaceName}} trên UniWork

{{.Data.InviterName}} mời bạn cùng làm việc trong workspace {{.Data.WorkspaceName}} trên UniWork.

Chấp nhận lời mời: {{.Data.AcceptURL}}

Lời mời hết hạn sau {{.Data.ExpiresInDays}} ngày. Bạn cần đăng nhập hoặc tạo tài khoản bằng đúng email này để tham gia.
```
`workspace_invite.en.html` / `.en.txt`: cùng cấu trúc, copy:
- Title: `You're invited to {{.Data.WorkspaceName}}`
- Body: `<strong>{{.Data.InviterName}}</strong> invited you to collaborate in the <strong>{{.Data.WorkspaceName}}</strong> workspace on UniWork.`
- Button: `Accept invitation`
- Note: `The invitation expires in {{.Data.ExpiresInDays}} days. Sign in or create an account with this email address to join.`
- Footer: `You received this email because a UniWork member invited you.`
- Subject: `{{.Data.InviterName}} invited you to {{.Data.WorkspaceName}} on UniWork`

Run: `cd server && go test ./internal/mail/ -count=1` → PASS.

- [ ] **Step 3: Service test thất bại**

`workspace_test.go` — `wsFix` thêm field `out *fakeOutbox`; `wsFixture` tạo `out := &fakeOutbox{}` và `NewWorkspaceService(pool, q, orgs, mail.Renderer{AppURL: "http://localhost:3000"}, out)`. Trong `TestInviteAndAccept` (test có `InviteMany` ở dòng ~115) sau khi `invs` được tạo thêm:
```go
	f.out.mu.Lock()
	queued := append([]mail.Message(nil), f.out.queued...)
	f.out.mu.Unlock()
	if len(queued) != 2 {
		t.Fatalf("want 2 invite mails, got %d", len(queued))
	}
	if queued[0].Kind != mail.KindWorkspaceInvite || queued[0].Locale != f.ua.Locale ||
		!strings.Contains(queued[0].HTML, "/invite/"+invs[0].Token) {
		t.Fatalf("invite mail %+v", queued[0])
	}
```
`fakeOutbox` sống ở `verification_test.go` cùng package — dùng lại. Sửa mọi `NewWorkspaceService(` khác trong `*_test.go` (onboarding, task, meeting, handler `newTestServer`) và `main.go` cho chữ ký mới.

Run: `cd server && go test ./internal/service/ -run TestInviteAndAccept -count=1` → FAIL (compile).

- [ ] **Step 4: `workspace.go`**

Struct + constructor:
```go
type WorkspaceService struct {
	pool   *pgxpool.Pool
	q      *db.Queries
	orgs   *OrganizationService
	render mail.Renderer
	out    mail.Enqueuer
}

func NewWorkspaceService(pool *pgxpool.Pool, q *db.Queries, orgs *OrganizationService, r mail.Renderer, out mail.Enqueuer) *WorkspaceService {
	return &WorkspaceService{pool: pool, q: q, orgs: orgs, render: r, out: out}
}
```
Import `mail` package: đổi import `"net/mail"` hiện có thành alias `netmail "net/mail"` và dùng `netmail.ParseAddress`.

Trong `InviteMany`, sau kiểm tra role hợp lệ, lấy inviter và workspace một lần:
```go
	inviter, err := s.q.GetUserByID(ctx, userID)
	if err != nil {
		return nil, nil, err
	}
	ws, err := s.q.GetWorkspaceByID(ctx, workspaceID)
	if err != nil {
		return nil, nil, err
	}
```
Trong vòng lặp, sau `CreateInvitation` thành công:
```go
		msg, err := s.render.Invite(email, inviter.Locale, mail.InviteData{
			InviterName: inviter.DisplayName, WorkspaceName: ws.Name,
			AcceptURL: s.render.AppURL + "/invite/" + inv.Token, ExpiresInDays: 7,
		})
		if err != nil {
			return nil, nil, err
		}
		if _, err := s.out.Enqueue(ctx, s.q, msg); err != nil {
			return nil, nil, err
		}
```
Sau vòng lặp: `if len(invs) > 0 { s.out.Kick() }`.

- [ ] **Step 5: Handler bỏ token**

`handler/workspace.go` `createInvitation`: `out = append(out, map[string]string{"id": inv.ID, "email": inv.Email, "role": inv.Role})`. `dto/sdo/workspace.go` `InvitationCreatedDTO` xoá field `Token`. `PendingInvitationDTO.Token` **giữ** (trang `/invitations` của chính người nhận cần).

Run: `make test-go` → PASS.

- [ ] **Step 6: Frontend — schema, UI**

`packages/core/api/endpoints/workspaces.ts` `InviteResponse`: `z.object({ id: z.string(), email: z.string(), role: z.string() })`.

`packages/views/workspace/invite-row.tsx` — thay toàn bộ bằng dòng "đã gửi":
```tsx
"use client";
import { MailCheck } from "lucide-react";
import { useTranslation } from "react-i18next";

export interface SentInvite {
  email: string;
}

/** Một dòng lời mời đã gửi: email + dấu đã gửi. Link không hiển thị nữa — mail tự đi. */
export function InviteRow({ sent }: { sent: SentInvite }) {
  const { t } = useTranslation();
  return (
    <li className="flex items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2">
      <MailCheck aria-hidden className="size-4 text-success" />
      <span className="min-w-0 flex-1 truncate text-body text-foreground">{sent.email}</span>
      <span className="text-caption text-muted-foreground">{t("workspace.inviteEmailed")}</span>
    </li>
  );
}
```
`members-view.tsx` và `step-invite.tsx`: `setSent((s) => [...s, ...d.invitations.map((i) => ({ email: i.email }))])`; `key={s.email}`.

`vi.json` `workspace`: thêm `"inviteEmailed": "Đã gửi email"`, đổi `"inviteSent": "Đã gửi {{count}} lời mời"`. `onboarding.step_invite`: `"sent_title": "Đã gửi {{count}} lời mời"`, `"sent_hint": "Mỗi người nhận một email kèm link tham gia."`, `"lede": "Nhập email của những người sẽ làm việc cùng bạn. Họ nhận email mời và vào thẳng workspace."`. `en.json`: `"inviteEmailed": "Emailed"`, `"inviteSent": "Sent {{count}} invitations"`, `"sent_title": "Sent {{count}} invitations"`, `"sent_hint": "Each person gets an email with a join link."`, `"lede": "Enter the emails of the people you will work with. They get an invitation email and land in the workspace."`.
Xoá key `workspace.copy_failed`, `workspace.copy_confirmed`, `workspace.inviteLink` ở cả hai file nếu không còn nơi nào dùng (`grep -rn "copy_failed\|copy_confirmed\|inviteLink" packages apps`).

Sửa test hiện có của invite-row/members-view/step-invite nếu có (`grep -rln "InviteRow\|token" packages/views --include='*.test.tsx'`) — bỏ assertion về link/copy.

Run: `pnpm --filter @uniwork/core test && pnpm --filter @uniwork/views test && pnpm typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server packages
git commit -m "feat(invite): email workspace invitations, stop exposing tokens"
```

---

### Task 7: Password reset — backend

**Files:**
- Create: `server/internal/mail/password_reset.go`; thay placeholder `templates/password_reset.{vi,en}.{html,txt}`; `server/internal/service/password_reset.go`, `password_reset_test.go`; `server/internal/handler/password_reset.go`
- Modify: `server/internal/mail/render_test.go`, `server/internal/service/errors.go`, `server/internal/handler/auth.go` (mapServiceError), `router.go`, `router/routes.go`, `router/auth.go`, `dto/sdi/auth.go`, `dto/sdo/auth.go`, `handler/auth_test.go` (Deps + test), `server/cmd/server/main.go`, `server/internal/service/reserved_slugs.json`

**Interfaces:**
- Produces:
  ```go
  mail.PasswordResetData{ResetURL string; ExpiresInMinutes int}
  (Renderer) PasswordReset(to, locale, userID string, d PasswordResetData) (Message, error)
  service.ErrInvalidToken
  service.NewPasswordResetService(q, auth *AuthService, r mail.Renderer, out mail.Enqueuer) *PasswordResetService
  (*PasswordResetService) Request(ctx, email string) error
  (*PasswordResetService) Reset(ctx, token, password string) (Session, error)
  handler.Deps.PasswordReset *service.PasswordResetService
  POST /api/v1/auth/password/forgot {email} → 200 {"status":"ok"}
  POST /api/v1/auth/password/reset {token,password} → 200 SessionSDO | 400 invalid_token
  ```

- [ ] **Step 1: Render test + template**

Thêm vào `render_test.go`:
```go
func TestPasswordResetRenders(t *testing.T) {
	r := Renderer{AppURL: "http://localhost:3000"}
	for _, loc := range []string{"vi", "en"} {
		m, err := r.PasswordReset("a@example.com", loc, "u1", PasswordResetData{ResetURL: "http://localhost:3000/reset-password?token=abc", ExpiresInMinutes: 60})
		if err != nil || m.Kind != KindPasswordReset || m.UserID != "u1" {
			t.Fatalf("%s: %v %+v", loc, err, m)
		}
		if !strings.Contains(m.HTML, "token=abc") || !strings.Contains(m.Text, "token=abc") {
			t.Fatalf("%s: reset url missing", loc)
		}
	}
}
```
`password_reset.go`:
```go
package mail

type PasswordResetData struct {
	ResetURL         string
	ExpiresInMinutes int
}

func (r Renderer) PasswordReset(to, locale, userID string, d PasswordResetData) (Message, error) {
	locale = normalizeLocale(locale)
	subject, html, text, err := renderKind(KindPasswordReset, locale, r.AppURL, d)
	if err != nil {
		return Message{}, err
	}
	return Message{Kind: KindPasswordReset, Locale: locale, UserID: userID, To: to, Subject: subject, HTML: html, Text: text}, nil
}
```
`password_reset.vi.html`:
```html
{{define "content"}}
<tr><td style="font-size:20px;font-weight:700;padding-bottom:12px">Đặt lại mật khẩu</td></tr>
<tr><td style="font-size:15px;line-height:1.5;padding-bottom:20px">Bạn (hoặc ai đó) vừa yêu cầu đặt lại mật khẩu UniWork cho địa chỉ này. Bấm nút bên dưới để chọn mật khẩu mới.</td></tr>
<tr><td style="padding-bottom:20px"><a href="{{.Data.ResetURL}}" style="display:inline-block;padding:12px 24px;background:#3C83F6;color:#fff;text-decoration:none;border-radius:8px;font-weight:600">Đặt lại mật khẩu</a></td></tr>
<tr><td style="font-size:13px;line-height:1.5;color:#555">Link dùng một lần và hết hạn sau {{.Data.ExpiresInMinutes}} phút. Nếu bạn không yêu cầu, bỏ qua email này — mật khẩu của bạn không đổi.</td></tr>
{{end}}
{{define "footer"}}Bạn nhận email này vì có yêu cầu đặt lại mật khẩu cho tài khoản UniWork của bạn.{{end}}
```
`password_reset.vi.txt`:
```
Subject: Đặt lại mật khẩu UniWork

Bạn (hoặc ai đó) vừa yêu cầu đặt lại mật khẩu UniWork cho địa chỉ này.

Đặt lại mật khẩu: {{.Data.ResetURL}}

Link dùng một lần và hết hạn sau {{.Data.ExpiresInMinutes}} phút. Nếu bạn không yêu cầu, bỏ qua email này — mật khẩu của bạn không đổi.
```
`.en`: Title `Reset your password`; body `You (or someone) asked to reset the UniWork password for this address. Click the button below to choose a new one.`; button `Reset password`; note `The link works once and expires in {{.Data.ExpiresInMinutes}} minutes. If you did not ask for this, ignore this email — your password stays the same.`; footer `You received this email because a password reset was requested for your UniWork account.`; subject `Reset your UniWork password`.

Run: `cd server && go test ./internal/mail/ -count=1` → PASS.

- [ ] **Step 2: Service test thất bại**

`service/password_reset_test.go`:
```go
package service

import (
	"context"
	"regexp"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/mail"
	"github.com/unicomhub/uniwork/server/internal/testutil"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

var resetToken = regexp.MustCompile(`token=([A-Za-z0-9]+)`)

func TestPasswordResetFlow(t *testing.T) {
	pool := testutil.DB(t)
	q := db.New(pool)
	out := &fakeOutbox{}
	r := mail.Renderer{AppURL: "http://localhost:3000"}
	as := NewAuthService(q, auth.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil)
	s := NewPasswordResetService(q, as, r, out)
	ctx := context.Background()
	u := registerVerified(t, q, as, "p@example.com", "P")
	old, _ := as.Login(ctx, "p@example.com", "password123")

	// Email lạ: im lặng, không mail.
	if err := s.Request(ctx, "nobody@example.com"); err != nil || len(out.queued) != 0 {
		t.Fatalf("unknown email: %v %d", err, len(out.queued))
	}
	if err := s.Request(ctx, "P@example.com "); err != nil || len(out.queued) != 1 {
		t.Fatalf("request: %v %d", err, len(out.queued))
	}
	m := out.queued[0]
	if m.Kind != mail.KindPasswordReset || m.UserID != u.ID {
		t.Fatalf("envelope %+v", m)
	}
	// Rate limit 60s: không mail thứ hai.
	if err := s.Request(ctx, "p@example.com"); err != nil || len(out.queued) != 1 {
		t.Fatalf("rate limit: %v %d", err, len(out.queued))
	}
	tok := resetToken.FindStringSubmatch(m.Text)[1]

	if _, err := s.Reset(ctx, tok, "short"); err == nil {
		t.Fatal("weak password accepted")
	}
	if _, err := s.Reset(ctx, "bogus", "newpassword1"); err != ErrInvalidToken {
		t.Fatalf("bogus token: %v", err)
	}
	sess, err := s.Reset(ctx, tok, "newpassword1")
	if err != nil || sess.AccessToken == "" {
		t.Fatalf("reset: %v", err)
	}
	if _, err := as.Login(ctx, "p@example.com", "password123"); err != ErrInvalidCredentials {
		t.Fatal("old password still works")
	}
	if _, err := as.Login(ctx, "p@example.com", "newpassword1"); err != nil {
		t.Fatal("new password rejected")
	}
	if _, err := as.Refresh(ctx, old.RefreshToken); err != ErrInvalidCredentials {
		t.Fatal("old refresh token not revoked")
	}
	if _, err := s.Reset(ctx, tok, "newpassword2"); err != ErrInvalidToken {
		t.Fatal("token reusable")
	}
}

func TestPasswordResetIgnoresGoogleOnly(t *testing.T) {
	pool := testutil.DB(t)
	q := db.New(pool)
	out := &fakeOutbox{}
	as := NewAuthService(q, auth.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil)
	s := NewPasswordResetService(q, as, mail.Renderer{AppURL: "x"}, out)
	ctx := context.Background()
	if _, err := q.CreateGoogleUser(ctx, db.CreateGoogleUserParams{ID: "g1", Email: "g@example.com", DisplayName: "G", GoogleID: pgtypeText("sub"), Locale: "vi"}); err != nil {
		t.Fatal(err)
	}
	if err := s.Request(ctx, "g@example.com"); err != nil || len(out.queued) != 0 {
		t.Fatalf("google-only: %v %d", err, len(out.queued))
	}
}
```
(`pgtypeText` — nếu chưa có helper trong package test, viết `pgtype.Text{String: "sub", Valid: true}` trực tiếp và import `pgtype`. Kiểm tra tên field `GoogleID`/`AvatarUrl` trong generated params.)

Run: `cd server && go test ./internal/service/ -run TestPasswordReset -count=1` → FAIL (compile).

- [ ] **Step 3: `errors.go` + service**

`errors.go` thêm:
```go
	// ErrInvalidToken covers unknown, expired and used password reset tokens.
	ErrInvalidToken = errors.New("invalid_token")
```
`service/password_reset.go`:
```go
package service

import (
	"context"
	"errors"
	"log/slog"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/mail"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

const (
	passwordResetTTL    = time.Hour
	passwordResetResend = 60 * time.Second
)

// PasswordResetService issues one-time reset links and applies them. Request
// never reveals whether an address exists: unknown, Google-only and
// rate-limited requests all return nil without mail.
type PasswordResetService struct {
	q      *db.Queries
	auth   *AuthService
	render mail.Renderer
	out    mail.Enqueuer
	now    func() time.Time
}

func NewPasswordResetService(q *db.Queries, a *AuthService, r mail.Renderer, out mail.Enqueuer) *PasswordResetService {
	return &PasswordResetService{q: q, auth: a, render: r, out: out, now: time.Now}
}

func (s *PasswordResetService) Request(ctx context.Context, email string) error {
	email = strings.ToLower(strings.TrimSpace(email))
	u, err := s.q.GetUserByEmail(ctx, email)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && !u.PasswordHash.Valid) {
		return nil
	}
	if err != nil {
		return err
	}
	latest, err := s.q.GetLatestPasswordResetTokenForUser(ctx, u.ID)
	if err == nil && s.now().Sub(latest.CreatedAt.Time) < passwordResetResend {
		slog.Info("password reset rate-limited", "user", u.ID)
		return nil
	}
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	// Only the newest token is valid.
	if err := s.q.DeletePasswordResetTokensForUser(ctx, u.ID); err != nil {
		return err
	}
	token := util.NewID() + util.NewID()
	if _, err := s.q.CreatePasswordResetToken(ctx, db.CreatePasswordResetTokenParams{
		ID: util.NewID(), UserID: u.ID, TokenHash: hashToken(token),
		ExpiresAt: pgtype.Timestamptz{Time: s.now().Add(passwordResetTTL), Valid: true},
	}); err != nil {
		return err
	}
	msg, err := s.render.PasswordReset(u.Email, u.Locale, u.ID, mail.PasswordResetData{
		ResetURL: s.render.AppURL + "/reset-password?token=" + token, ExpiresInMinutes: int(passwordResetTTL / time.Minute),
	})
	if err != nil {
		return err
	}
	if _, err := s.out.Enqueue(ctx, s.q, msg); err != nil {
		return err
	}
	s.out.Kick()
	return nil
}

// Reset sets the password, burns the token, revokes every refresh token and
// returns a fresh session so the user lands in the app.
func (s *PasswordResetService) Reset(ctx context.Context, token, password string) (Session, error) {
	if len(password) < 8 {
		return Session{}, Invalid("mật khẩu tối thiểu 8 ký tự")
	}
	t, err := s.q.GetActivePasswordResetTokenByHash(ctx, hashToken(strings.TrimSpace(token)))
	if errors.Is(err, pgx.ErrNoRows) {
		return Session{}, ErrInvalidToken
	}
	if err != nil {
		return Session{}, err
	}
	hash, err := auth.HashPassword(password)
	if err != nil {
		return Session{}, err
	}
	u, err := s.q.UpdateUserPassword(ctx, db.UpdateUserPasswordParams{ID: t.UserID, PasswordHash: pgtype.Text{String: hash, Valid: true}})
	if err != nil {
		return Session{}, err
	}
	if err := s.q.MarkPasswordResetTokenUsed(ctx, t.ID); err != nil {
		return Session{}, err
	}
	if err := s.q.RevokeAllRefreshTokensForUser(ctx, t.UserID); err != nil {
		return Session{}, err
	}
	return s.auth.SessionFor(ctx, u)
}
```
Chuẩn mật khẩu: `Register` cũng kiểm `len(password) < 8`; nếu muốn dùng chung, tách `validatePassword(p string) error` trong `auth.go` và gọi ở cả hai.

Run: `cd server && go test ./internal/service/ -run TestPasswordReset -count=1` → PASS.

- [ ] **Step 4: Handler test thất bại**

`handler/auth_test.go`:
```go
func TestForgotPasswordAlwaysOKAndResetChangesPassword(t *testing.T) {
	srv := newTestServer(t)
	res, out := doJSON(t, srv, "POST", "/api/v1/auth/password/forgot", "", map[string]string{"email": "ghost@example.com"})
	if res.StatusCode != 200 || out["status"] != "ok" {
		t.Fatalf("unknown email must be 200 ok: %d %v", res.StatusCode, out)
	}
	res, _ = doJSON(t, srv, "POST", "/api/v1/auth/password/forgot", "", map[string]string{"email": "not-an-email"})
	if res.StatusCode != 400 {
		t.Fatalf("malformed email: %d", res.StatusCode)
	}
	res, out = doJSON(t, srv, "POST", "/api/v1/auth/password/reset", "", map[string]string{"token": "nope", "password": "newpassword1"})
	if res.StatusCode != 400 || out["code"] != "invalid_token" {
		t.Fatalf("bad token: %d %v", res.StatusCode, out)
	}
}
```
(Kiểm tra tên field lỗi trong `respondError` — nếu body là `{"error":{"code":..}}` thì chỉnh assertion cho khớp `json_test.go`.)

Run: `cd server && go test ./internal/handler/ -run TestForgotPassword -count=1` → FAIL 404.

- [ ] **Step 5: Handler, DTO, routes, Deps**

`dto/sdi/auth.go`:
```go
// ForgotPasswordSDI is POST /api/v1/auth/password/forgot.
type ForgotPasswordSDI struct {
	Email string `json:"email" format:"email" minLength:"1" description:"Email tài khoản; phản hồi giống nhau dù tồn tại hay không" example:"an@acme.vn"`
}

// ResetPasswordSDI is POST /api/v1/auth/password/reset.
type ResetPasswordSDI struct {
	Token    string `json:"token" minLength:"1" description:"Token trong link email" example:"01J8X4…"`
	Password string `json:"password" minLength:"8" description:"Mật khẩu mới, tối thiểu 8 ký tự" example:"password123"`
}
```
`handler/password_reset.go`:
```go
package handler

import (
	"net/http"
	netmail "net/mail"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
)

// forgotPassword answers 200 for every syntactically valid address so the
// response cannot be used to enumerate accounts.
func (h *handlers) forgotPassword(w http.ResponseWriter, r *http.Request) {
	var in sdi.ForgotPasswordSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	if _, err := netmail.ParseAddress(in.Email); err != nil {
		respondError(w, http.StatusBadRequest, "invalid_request", "email không hợp lệ")
		return
	}
	if err := h.PasswordReset.Request(r.Context(), in.Email); err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (h *handlers) resetPassword(w http.ResponseWriter, r *http.Request) {
	var in sdi.ResetPasswordSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	sess, err := h.PasswordReset.Reset(r.Context(), in.Token, in.Password)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	h.sessionResponse(w, sess)
}
```
`mapServiceError` thêm:
```go
	case errors.Is(err, service.ErrInvalidToken):
		respondError(w, 400, "invalid_token", "invalid or expired token")
```
`handler/router.go` `Deps` thêm `PasswordReset *service.PasswordResetService`; routes (cạnh login):
```go
		r.With(credentialLimit).Post("/auth/password/forgot", h.forgotPassword)
		r.With(credentialLimit).Post("/auth/password/reset", h.resetPassword)
```
`router/routes.go` thêm `ForgotPassword, ResetPassword http.HandlerFunc`; `router/auth.go` thêm hai `apiOp` (summary "Forgot password" / "Reset password", tags auth, sdi tương ứng, sdo `StatusSDO` / `SessionSDO`).

`newTestServer` (`auth_test.go`): `PasswordReset: service.NewPasswordResetService(q, authSvc, mail.Renderer{AppURL: "http://localhost:3000"}, discardOutbox{})`.
`main.go`: `PasswordReset: service.NewPasswordResetService(q, authSvc, renderer, outbox)`.
`reserved_slugs.json`: thêm `"forgot-password", "reset-password"`.

Run: `make test-go` → PASS.

- [ ] **Step 6: Commit**

```bash
git add server
git commit -m "feat(auth): password reset by emailed one-time link"
```

---

### Task 8: Password reset — frontend

**Files:**
- Create: `packages/views/auth/forgot-password-view.tsx`, `forgot-password-view.test.tsx`, `reset-password-view.tsx`, `reset-password-view.test.tsx`, `apps/web/app/(auth)/forgot-password/page.tsx`, `apps/web/app/(auth)/reset-password/page.tsx`
- Modify: `packages/core/api/endpoints/auth.ts`, `auth.test.ts`, `packages/core/auth/hooks.ts`, `packages/core/paths/paths.ts`, `packages/core/paths/reserved-slugs.ts` (regenerate), `packages/views/auth/login-view.tsx`, `packages/core/i18n/locales/{vi,en}.json`

**Interfaces:**
- Produces: `auth.forgotPassword(email): Promise<void>`, `auth.resetPassword(token, password): Promise<SessionResponse | null>`, `useForgotPassword()`, `useResetPassword()`, `paths.forgotPassword()`, `paths.resetPassword(token?)`.

- [ ] **Step 1: Endpoint test thất bại**

`packages/core/api/endpoints/auth.test.ts` thêm:
```ts
  it("forgotPassword posts the email and resolves on 200", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ status: "ok" }));
    await expect(forgotPassword("a@b.c")).resolves.toBeUndefined();
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toBe("http://api.test/api/v1/auth/password/forgot");
    expect(JSON.parse(String(init?.body))).toEqual({ email: "a@b.c" });
  });

  it("resetPassword stores the token on success and returns null on drift", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ user, access_token: "tok-9" }));
    const sess = await resetPassword("tok", "newpassword1");
    expect(sess?.access_token).toBe("tok-9");
    expect(getAccessToken()).toBe("tok-9");
    vi.mocked(fetch).mockResolvedValueOnce(json({ user }));
    await expect(resetPassword("tok", "newpassword1")).resolves.toBeNull();
  });
```
Run: `pnpm --filter @uniwork/core test -- auth` → FAIL.

- [ ] **Step 2: Endpoints + hooks + paths**

`endpoints/auth.ts`:
```ts
export async function forgotPassword(email: string): Promise<void> {
  await request("/api/v1/auth/password/forgot", { method: "POST", body: { email }, skipRefresh: true });
}

export async function resetPassword(token: string, password: string): Promise<SessionResponse | null> {
  const raw = await request("/api/v1/auth/password/reset", {
    method: "POST",
    body: { token, password },
    skipRefresh: true,
  });
  const sess = parseWithFallback<SessionResponse | null>(raw, SessionResponseSchema, null, {
    endpoint: "POST /api/v1/auth/password/reset",
  });
  setAccessToken(sess?.access_token ?? null);
  return sess;
}
```
`auth/hooks.ts` (theo mẫu `useLogin`, xem cách nó gọi `setSessionUser`/store sau login):
```ts
export function useForgotPassword() {
  return useMutation({ mutationFn: (email: string) => auth.forgotPassword(email) });
}

export function useResetPassword() {
  return useMutation({
    mutationFn: async ({ token, password }: { token: string; password: string }) => {
      const sess = await auth.resetPassword(token, password);
      if (!sess) throw new ApiError("Unexpected response from the server", "malformed_response", 502);
      return sess;
    },
    onSuccess: (sess) => setSessionUser(sess.user),
  });
}
```
`paths.ts`: `forgotPassword: () => "/forgot-password"`, `resetPassword: (token?: string) => token ? \`/reset-password?token=${encodeURIComponent(token)}\` : "/reset-password"`; `GLOBAL_PREFIXES` thêm `"/forgot-password"`, `"/reset-password"`. Chạy `pnpm generate:reserved-slugs`.

Run: `pnpm --filter @uniwork/core test` → PASS (kể cả `consistency.test.ts`).

- [ ] **Step 3: i18n**

`vi.json` `auth` — sửa và thêm:
```json
"forgotPassword": "Quên mật khẩu?",
"forgot": {
  "title": "Quên mật khẩu",
  "subtitle": "Nhập email tài khoản, chúng tôi sẽ gửi link đặt lại.",
  "submit": "Gửi link đặt lại",
  "sending": "Đang gửi…",
  "sentTitle": "Kiểm tra hộp thư",
  "sentBody": "Nếu {{email}} có tài khoản UniWork, một email kèm link đặt lại mật khẩu đã được gửi. Link có hiệu lực 60 phút.",
  "googleHint": "Đăng nhập bằng Google? Dùng nút Google ở trang đăng nhập, không cần mật khẩu.",
  "backToLogin": "Về trang đăng nhập"
},
"reset": {
  "title": "Đặt mật khẩu mới",
  "subtitle": "Chọn mật khẩu mới cho tài khoản của bạn.",
  "newPassword": "Mật khẩu mới",
  "confirmPassword": "Nhập lại mật khẩu",
  "mismatch": "Hai mật khẩu chưa khớp",
  "submit": "Đổi mật khẩu",
  "submitting": "Đang đổi…",
  "invalidToken": "Link đã hết hạn hoặc đã dùng. Yêu cầu link mới.",
  "requestNew": "Yêu cầu link mới"
}
```
Xoá `forgotPasswordHelp`. `en.json` cùng key: `forgot.title "Forgot password"`, `subtitle "Enter your account email and we will send a reset link."`, `submit "Send reset link"`, `sending "Sending…"`, `sentTitle "Check your inbox"`, `sentBody "If {{email}} has a UniWork account, an email with a reset link is on its way. The link works for 60 minutes."`, `googleHint "Signed in with Google? Use the Google button on the login page — no password needed."`, `backToLogin "Back to login"`; `reset.title "Set a new password"`, `subtitle "Choose a new password for your account."`, `newPassword "New password"`, `confirmPassword "Confirm password"`, `mismatch "Passwords do not match"`, `submit "Change password"`, `submitting "Changing…"`, `invalidToken "This link has expired or was already used. Request a new one."`, `requestNew "Request a new link"`.

- [ ] **Step 4: View test thất bại**

`packages/views/auth/forgot-password-view.test.tsx` (theo mẫu `verify-email-view.test.tsx` — cùng cách render với provider/i18n; đọc file đó và copy phần setup):
```tsx
it("shows the sent state with the email after submit", async () => {
  // mock @uniwork/core/auth useForgotPassword → mutate gọi onSuccess
  render(<ForgotPasswordView />);
  await user.type(screen.getByLabelText("Email"), "a@b.c");
  await user.click(screen.getByRole("button", { name: "Gửi link đặt lại" }));
  expect(await screen.findByText(/Nếu a@b.c có tài khoản/)).toBeInTheDocument();
});
```
`reset-password-view.test.tsx`:
```tsx
it("blocks submit when passwords differ and shows invalid token error", async () => {
  render(<ResetPasswordView token="t" onSuccess={vi.fn()} />);
  await user.type(screen.getByLabelText("Mật khẩu mới"), "newpassword1");
  await user.type(screen.getByLabelText("Nhập lại mật khẩu"), "newpassword2");
  await user.click(screen.getByRole("button", { name: "Đổi mật khẩu" }));
  expect(screen.getByText("Hai mật khẩu chưa khớp")).toBeInTheDocument();
});
```
Run: `pnpm --filter @uniwork/views test -- password` → FAIL.

- [ ] **Step 5: Views**

`forgot-password-view.tsx`:
```tsx
"use client";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useForgotPassword } from "@uniwork/core/auth";
import { paths } from "@uniwork/core/paths";
import { Button } from "@uniwork/ui/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@uniwork/ui/components/ui/field";
import { Input } from "@uniwork/ui/components/ui/input";
import { AppLink } from "../navigation";
import { AuthShell } from "./auth-shell";
import { AUTH_LINK } from "./login-view";

export function ForgotPasswordView() {
  const { t } = useTranslation();
  const forgot = useForgotPassword();
  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);

  if (sentTo) {
    return (
      <AuthShell title={t("auth.forgot.sentTitle")} description={t("auth.forgot.sentBody", { email: sentTo })}>
        <div className="flex flex-col gap-4">
          <p className="text-label text-muted-foreground">{t("auth.forgot.googleHint")}</p>
          <AppLink href={paths.login()} className={AUTH_LINK}>{t("auth.forgot.backToLogin")}</AppLink>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell title={t("auth.forgot.title")} description={t("auth.forgot.subtitle")}>
      <form
        className="flex flex-col gap-6"
        onSubmit={(e) => {
          e.preventDefault();
          if (forgot.isPending) return;
          forgot.mutate(email, { onSuccess: () => setSentTo(email) });
        }}
      >
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="forgot-email">{t("auth.email")}</FieldLabel>
            <Input id="forgot-email" type="email" autoComplete="email" required autoFocus value={email}
              onChange={(e) => setEmail(e.target.value)} placeholder={t("auth.emailPlaceholder")} />
          </Field>
          <FieldError>{forgot.error ? t("common.error") : null}</FieldError>
        </FieldGroup>
        <Button type="submit" size="lg" className="w-full" aria-disabled={forgot.isPending || undefined}>
          {forgot.isPending ? (<><Loader2 aria-hidden className="animate-spin" />{t("auth.forgot.sending")}</>) : t("auth.forgot.submit")}
        </Button>
        <p className="text-center text-label text-muted-foreground">
          <AppLink href={paths.login()} className={AUTH_LINK}>{t("auth.forgot.backToLogin")}</AppLink>
        </p>
      </form>
    </AuthShell>
  );
}
```
`reset-password-view.tsx`:
```tsx
"use client";
import { Loader2 } from "lucide-react";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError } from "@uniwork/core/api";
import { useResetPassword } from "@uniwork/core/auth";
import { paths } from "@uniwork/core/paths";
import type { SessionResponse } from "@uniwork/core/types";
import { Button } from "@uniwork/ui/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@uniwork/ui/components/ui/field";
import { AppLink } from "../navigation";
import { AuthShell } from "./auth-shell";
import { AUTH_LINK } from "./login-view";
import { PasswordField } from "./password-field";

const MIN = 8;

export function ResetPasswordView({ token, onSuccess }: { token: string; onSuccess: (sess: SessionResponse) => void }) {
  const { t } = useTranslation();
  const reset = useResetPassword();
  const errorId = useId();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [mismatch, setMismatch] = useState(false);
  const invalidToken = reset.error instanceof ApiError && reset.error.code === "invalid_token";

  if (invalidToken) {
    return (
      <AuthShell title={t("auth.reset.title")} description={t("auth.reset.invalidToken")}>
        <AppLink href={paths.forgotPassword()} className={AUTH_LINK}>{t("auth.reset.requestNew")}</AppLink>
      </AuthShell>
    );
  }

  return (
    <AuthShell title={t("auth.reset.title")} description={t("auth.reset.subtitle")}>
      <form
        className="flex flex-col gap-6"
        onSubmit={(e) => {
          e.preventDefault();
          if (reset.isPending) return;
          if (password !== confirm) { setMismatch(true); return; }
          setMismatch(false);
          reset.mutate({ token, password }, { onSuccess });
        }}
      >
        <FieldGroup>
          <PasswordField id="reset-password" label={t("auth.reset.newPassword")} value={password}
            onChange={setPassword} minLength={MIN} autoComplete="new-password" autoFocus />
          <PasswordField id="reset-confirm" label={t("auth.reset.confirmPassword")} value={confirm}
            onChange={setConfirm} minLength={MIN} autoComplete="new-password" aria-describedby={mismatch ? errorId : undefined} />
          <FieldError id={errorId}>{mismatch ? t("auth.reset.mismatch") : reset.error ? t("common.error") : null}</FieldError>
        </FieldGroup>
        <Button type="submit" size="lg" className="w-full" aria-disabled={reset.isPending || undefined}>
          {reset.isPending ? (<><Loader2 aria-hidden className="animate-spin" />{t("auth.reset.submitting")}</>) : t("auth.reset.submit")}
        </Button>
      </form>
    </AuthShell>
  );
}
```
Đọc `password-field.tsx` để khớp props thật (`label`, `value`, `onChange` có thể là event); chỉnh cho đúng.

`login-view.tsx` dòng 131–138: thay đoạn "Stated, not linked" bằng
```tsx
          <p className="text-center text-label text-muted-foreground">
            <AppLink href={paths.forgotPassword()} className={AUTH_LINK}>{t("auth.forgotPassword")}</AppLink>
          </p>
```

- [ ] **Step 6: Pages**

`apps/web/app/(auth)/forgot-password/page.tsx`:
```tsx
"use client";
import { ForgotPasswordView } from "@uniwork/views/auth/forgot-password-view";

export default function ForgotPasswordPage() {
  return <ForgotPasswordView />;
}
```
`apps/web/app/(auth)/reset-password/page.tsx`:
```tsx
"use client";
import { api } from "@uniwork/core";
import { paths } from "@uniwork/core/paths";
import { ResetPasswordView } from "@uniwork/views/auth/reset-password-view";
import { resolveLoggedInDestination } from "@uniwork/views/auth/post-auth-redirect";
import { useNavigation } from "@uniwork/views/navigation";

export default function ResetPasswordPage() {
  const { push, replace, searchParams } = useNavigation();
  const token = searchParams.get("token");
  if (!token) {
    replace(paths.forgotPassword());
    return null;
  }
  return (
    <ResetPasswordView
      token={token}
      onSuccess={async (sess) => {
        push(await resolveLoggedInDestination(sess.user, await api.workspaces.list()));
      }}
    />
  );
}
```
Kiểm tra `apps/web/app/(auth)/layout.tsx` có guard đẩy user đã đăng nhập đi không; nếu có, `/reset-password` vẫn phải hiển thị khi anon (mặc định là vậy).

Run: `pnpm typecheck && pnpm --filter @uniwork/views test && pnpm --filter @uniwork/core test`
Expected: PASS (parity vi/en, consistency reserved slugs).

- [ ] **Step 7: Commit**

```bash
git add packages apps
git commit -m "feat(auth): forgot/reset password pages"
```

---

### Task 9: `welcome` — template + hook onboarding

**Files:**
- Create: `server/internal/mail/welcome.go`; thay placeholder `templates/welcome.{vi,en}.{html,txt}`
- Modify: `server/internal/mail/render_test.go`, `server/internal/service/onboarding.go`, `onboarding_test.go`, `server/internal/handler/auth_test.go`, `server/cmd/server/main.go`

**Interfaces:**
- Produces: `mail.WelcomeData{DisplayName, WorkspaceName, WorkspaceURL string}`; `(Renderer) Welcome(to, locale, userID string, d WelcomeData) (Message, error)`; `service.NewOnboardingService(q, ws, pub, r mail.Renderer, out mail.Enqueuer)`.

- [ ] **Step 1: Render test + template**

`render_test.go`:
```go
func TestWelcomeRenders(t *testing.T) {
	r := Renderer{AppURL: "http://localhost:3000"}
	for _, loc := range []string{"vi", "en"} {
		m, err := r.Welcome("a@example.com", loc, "u1", WelcomeData{DisplayName: "An", WorkspaceName: "Đội Alpha", WorkspaceURL: "http://localhost:3000/acme/alpha"})
		if err != nil || m.Kind != KindWelcome || !strings.Contains(m.HTML, "/acme/alpha") || !strings.Contains(m.Text, "/acme/alpha") {
			t.Fatalf("%s: %v %+v", loc, err, m)
		}
	}
}
```
`welcome.go`:
```go
package mail

type WelcomeData struct {
	DisplayName   string
	WorkspaceName string
	WorkspaceURL  string
}

func (r Renderer) Welcome(to, locale, userID string, d WelcomeData) (Message, error) {
	locale = normalizeLocale(locale)
	d.DisplayName = SafeField(d.DisplayName)
	d.WorkspaceName = SafeField(d.WorkspaceName)
	subject, html, text, err := renderKind(KindWelcome, locale, r.AppURL, d)
	if err != nil {
		return Message{}, err
	}
	return Message{Kind: KindWelcome, Locale: locale, UserID: userID, To: to, Subject: subject, HTML: html, Text: text}, nil
}
```
`welcome.vi.html`:
```html
{{define "content"}}
<tr><td style="font-size:20px;font-weight:700;padding-bottom:12px">Chào {{.Data.DisplayName}}, bạn đã sẵn sàng!</td></tr>
<tr><td style="font-size:15px;line-height:1.5;padding-bottom:20px">Workspace <strong>{{.Data.WorkspaceName}}</strong> của bạn đã được tạo. Ba việc để bắt đầu:</td></tr>
<tr><td style="font-size:15px;line-height:1.7;padding-bottom:20px">
  1. Tạo công việc đầu tiên và giao cho một người.<br>
  2. Mời đồng nghiệp ở trang Thành viên.<br>
  3. Lên lịch một cuộc họp và ghi chú ngay trong UniWork.
</td></tr>
<tr><td style="padding-bottom:8px"><a href="{{.Data.WorkspaceURL}}" style="display:inline-block;padding:12px 24px;background:#3C83F6;color:#fff;text-decoration:none;border-radius:8px;font-weight:600">Vào workspace</a></td></tr>
{{end}}
{{define "footer"}}Bạn nhận email này vì vừa hoàn tất thiết lập UniWork.{{end}}
```
`welcome.vi.txt`:
```
Subject: Chào mừng bạn đến với UniWork

Chào {{.Data.DisplayName}}, workspace {{.Data.WorkspaceName}} của bạn đã được tạo.

Ba việc để bắt đầu:
1. Tạo công việc đầu tiên và giao cho một người.
2. Mời đồng nghiệp ở trang Thành viên.
3. Lên lịch một cuộc họp và ghi chú ngay trong UniWork.

Vào workspace: {{.Data.WorkspaceURL}}
```
`.en`: title `Hi {{.Data.DisplayName}}, you're all set!`; body `Your workspace <strong>{{.Data.WorkspaceName}}</strong> is ready. Three things to start with:`; list `1. Create your first task and assign it to someone.` / `2. Invite teammates from the Members page.` / `3. Schedule a meeting and take notes right in UniWork.`; button `Open workspace`; footer `You received this email because you just finished setting up UniWork.`; subject `Welcome to UniWork`.

Run: `cd server && go test ./internal/mail/ -count=1` → PASS.

- [ ] **Step 2: Service test thất bại**

`onboarding_test.go` — trong `TestQuestionnaireAndComplete`, tạo service với outbox và kiểm tra:
```go
	out := &fakeOutbox{}
	s := NewOnboardingService(f.q, f.ws, NopPublisher{}, mail.Renderer{AppURL: "http://localhost:3000"}, out)
	w, _ := f.ws.CreateInOrg(ctx, f.ua.ID, f.org.ID, "Đội Alpha", "doi-alpha")
	// ... phần questionnaire giữ nguyên ...
	u3, err := s.Complete(ctx, f.ua.ID, "full", w.ID)
	if err != nil || !u3.OnboardedAt.Valid {
		t.Fatalf("complete: %v", err)
	}
	if len(out.queued) != 1 || out.queued[0].Kind != mail.KindWelcome || !strings.Contains(out.queued[0].HTML, "/unicom/doi-alpha") {
		t.Fatalf("welcome mail: %+v", out.queued)
	}
	u4, _ := s.Complete(ctx, f.ua.ID, "skip_existing", "")
	// ...
	if len(out.queued) != 1 {
		t.Fatal("welcome must be sent once")
	}
```
Thêm test đường `invite_skipped` không gửi: `s.Complete(ctx, f.ub.ID, "invite_skipped", "")` → `len(out.queued)` không đổi.

Run: `cd server && go test ./internal/service/ -run TestQuestionnaireAndComplete -count=1` → FAIL (compile).

- [ ] **Step 3: `onboarding.go`**

```go
type OnboardingService struct {
	q      *db.Queries
	ws     *WorkspaceService
	pub    EventPublisher
	render mail.Renderer
	out    mail.Enqueuer
}

func NewOnboardingService(q *db.Queries, ws *WorkspaceService, pub EventPublisher, r mail.Renderer, out mail.Enqueuer) *OnboardingService {
	return &OnboardingService{q: q, ws: ws, pub: pub, render: r, out: out}
}

func (s *OnboardingService) Complete(ctx context.Context, userID, path, workspaceID string) (db.User, error) {
	// ... validation như cũ ...
	u, err := s.q.MarkUserOnboarded(ctx, userID)
	if err != nil {
		return db.User{}, err
	}
	if (path == "full" || path == "invite_accept") && workspaceID != "" {
		s.sendWelcome(ctx, u, workspaceID)
	}
	return u, nil
}

// sendWelcome queues the welcome mail once per user. Failures are logged:
// onboarding must not fail because of a greeting.
func (s *OnboardingService) sendWelcome(ctx context.Context, u db.User, workspaceID string) {
	n, err := s.q.CountEmailsForUserKind(ctx, db.CountEmailsForUserKindParams{UserID: pgtype.Text{String: u.ID, Valid: true}, Kind: mail.KindWelcome})
	if err != nil || n > 0 {
		return
	}
	view, err := s.ws.GetView(ctx, u.ID, workspaceID)
	if err != nil {
		slog.Warn("welcome mail: workspace view", "user", u.ID, "err", err)
		return
	}
	msg, err := s.render.Welcome(u.Email, u.Locale, u.ID, mail.WelcomeData{
		DisplayName: u.DisplayName, WorkspaceName: view.Name,
		WorkspaceURL: s.render.AppURL + "/" + view.OrganizationSlug + "/" + view.Slug,
	})
	if err != nil {
		slog.Warn("welcome mail: render", "user", u.ID, "err", err)
		return
	}
	if _, err := s.out.Enqueue(ctx, s.q, msg); err != nil {
		slog.Warn("welcome mail: enqueue", "user", u.ID, "err", err)
		return
	}
	s.out.Kick()
}
```
Cập nhật mọi `NewOnboardingService(` trong test (`handler/auth_test.go`, `service/*_test.go`) và `main.go`.

Run: `make test-go` → PASS.

- [ ] **Step 4: Commit**

```bash
git add server
git commit -m "feat(onboarding): welcome email after completing setup"
```

---

### Task 10: Frontend — sync locale lên `/me`, `User.locale`

**Files:**
- Modify: `packages/core/types/user.ts`, `packages/core/api/endpoints/auth.ts`, `packages/core/auth/hooks.ts`, `apps/web/platform/locale.tsx`
- Test: `packages/core/api/endpoints/auth.test.ts`

- [ ] **Step 1: Test thất bại**

`auth.test.ts`:
```ts
  it("patchMe sends locale alone", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ user: { ...user, locale: "en" } }));
    const u = await patchMe({ locale: "en" });
    expect(u?.locale).toBe("en");
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0]![1]?.body))).toEqual({ locale: "en" });
  });
```
Run: `pnpm --filter @uniwork/core test -- auth` → FAIL (type).

- [ ] **Step 2: Implement**

`types/user.ts` `UserSchema` thêm `locale: z.string().optional().default("vi")`.
`endpoints/auth.ts`: `patchMe(body: { display_name?: string; locale?: "vi" | "en" })`.
`auth/hooks.ts` `usePatchMe`: `mutationFn: (body: { display_name?: string; locale?: "vi" | "en" }) => auth.patchMe(body)` — sửa nơi gọi `usePatchMe().mutate(name)` (grep `usePatchMe`) thành `mutate({ display_name: name })`.

`apps/web/platform/locale.tsx`: bọc adapter để `persist` cũng gọi API khi đã đăng nhập:
```tsx
import { api } from "@uniwork/core";
import { useAuthStore } from "@uniwork/core/auth/store";
// ...
  const [adapter] = useState(() => {
    const base = createBrowserCookieLocaleAdapter();
    return {
      ...base,
      persist(locale: SupportedLocale) {
        base.persist(locale);
        // Mail follows the user's language; a failed sync only affects the
        // next mail's language, so it is fire-and-forget.
        if (useAuthStore.getState().user) void api.auth.patchMe({ locale }).catch(() => {});
      },
    };
  });
```
(Kiểm tra export path của `useAuthStore` — `packages/core/auth/index.ts`; nếu không export, dùng `useSession`-equivalent từ store hoặc export thêm.)

Run: `pnpm typecheck && pnpm --filter @uniwork/core test` → PASS.

- [ ] **Step 3: Commit**

```bash
git add packages apps
git commit -m "feat(i18n): persist mail locale to the account"
```

---

### Task 11: e2e — reset password end-to-end qua bảng `emails`

**Files:**
- Create: `e2e/db.ts`, `e2e/reset-password.spec.ts`
- Modify: `e2e/package.json`

- [ ] **Step 1: Dependency**

`e2e/package.json` devDependencies thêm `"pg": "^8.13.0"`, `"@types/pg": "^8.11.0"`. Run: `pnpm install`.

- [ ] **Step 2: Helper**

`e2e/db.ts`:
```ts
import { Client } from "pg";

/**
 * Đọc mail đã ghi vào outbox. Server local ghi mọi mail vào bảng `emails`
 * (SMTP_HOST trống chỉ in ra log), nên e2e lấy link reset từ đây thay vì
 * một token bypass — bypass cho reset là lỗ hổng không đáng có.
 */
const url =
  process.env.E2E_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgres://uniwork:uniwork@localhost:5433/uniwork?sslmode=disable";

export async function latestEmailText(to: string, kind: string): Promise<string> {
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    for (let i = 0; i < 20; i++) {
      const r = await c.query<{ text: string }>(
        "SELECT text FROM emails WHERE to_email = $1 AND kind = $2 ORDER BY created_at DESC LIMIT 1",
        [to, kind],
      );
      if (r.rows[0]) return r.rows[0].text;
      await new Promise((res) => setTimeout(res, 250));
    }
    throw new Error(`no ${kind} email for ${to}`);
  } finally {
    await c.end();
  }
}
```
Kiểm tra cổng Postgres mặc định trong `scripts/local-env.sh` (`POSTGRES_PORT`) và dùng đúng giá trị.

- [ ] **Step 3: Spec**

`e2e/reset-password.spec.ts`:
```ts
import { expect, test } from "@playwright/test";
import { registerVerified } from "./auth-nav";
import { latestEmailText } from "./db";

test("quên mật khẩu → link trong mail → mật khẩu mới đăng nhập được", async ({ page }) => {
  const { email } = await registerVerified(page, "Reset Bot");
  await page.goto("/login");
  await page.getByRole("link", { name: "Quên mật khẩu?" }).click();
  await expect(page).toHaveURL(/\/forgot-password$/);
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Gửi link đặt lại" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Kiểm tra hộp thư");

  const text = await latestEmailText(email, "password_reset");
  const link = text.match(/https?:\/\/\S+\/reset-password\?token=[A-Za-z0-9]+/)?.[0];
  expect(link, "link đặt lại trong mail").toBeTruthy();
  await page.goto(new URL(link!).pathname + new URL(link!).search);
  await page.getByLabel("Mật khẩu mới").fill("newpassword1");
  await page.getByLabel("Nhập lại mật khẩu").fill("newpassword1");
  await page.getByRole("button", { name: "Đổi mật khẩu" }).click();
  await expect(page).toHaveURL(/\/onboarding$/);

  // Link dùng một lần.
  await page.goto(new URL(link!).pathname + new URL(link!).search);
  await expect(page.getByText("Link đã hết hạn hoặc đã dùng")).toBeVisible();
});
```

- [ ] **Step 4: Chạy**

Run: `make start` (một terminal) rồi `pnpm --filter @uniwork/e2e test -- reset-password`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add e2e pnpm-lock.yaml
git commit -m "test(e2e): password reset through the outbox"
```

---

### Task 12: Metrics counter + tài liệu vận hành

**Files:**
- Modify: `server/internal/metrics/registry.go`, `server/internal/mail/outbox.go`, `server/cmd/server/main.go`, `.env.example`, `docs/superpowers/specs/2026-08-28-transactional-email-design.md` (đổi Trạng thái)

- [ ] **Step 1: Counter**

`metrics/registry.go`:
```go
type Registry struct {
	Gatherer prometheus.Gatherer
	HTTP     *HTTPMetrics
	Emails   *prometheus.CounterVec
}
// trong NewRegistry:
	emails := prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "uniwork_emails_total", Help: "Outbox delivery outcomes by kind.",
	}, []string{"kind", "result"})
	reg.MustRegister(emails)
	// return &Registry{..., Emails: emails}
```
`outbox.go`: field `Counter *prometheus.CounterVec` (public, nil-safe) trên `Outbox`; trong `deliver`: `o.count(row.Kind, "sent"|"retry"|"failed")`:
```go
func (o *Outbox) count(kind, result string) {
	if o.Counter != nil {
		o.Counter.WithLabelValues(kind, result).Inc()
	}
}
```
`main.go`: sau khi tạo `outbox` và nếu `httpMetrics != nil`: `outbox.Counter = reg.Emails` (giữ `reg` ở scope ngoài `if`).

Test: `metrics/registry_test.go` nếu có test liệt kê metric — thêm `uniwork_emails_total` vào kỳ vọng; nếu không, `go test ./internal/metrics/` chỉ cần compile.

- [ ] **Step 2: Docs**

`.env.example` mục Email: thêm chú thích `MAIL_FROM` là địa chỉ hiển thị cho mọi loại mail. Spec: `**Trạng thái:** Đã triển khai (2026-08-xx)`.

- [ ] **Step 3: Kiểm tra tổng**

Run: `make check`
Expected: typecheck, lint, TS tests, Go tests, e2e đều PASS; `scripts/no-usf-leak.test.mjs` PASS.

- [ ] **Step 4: Commit**

```bash
git add server .env.example docs
git commit -m "feat(mail): delivery metrics, docs"
```

---

## Self-review

- **Spec coverage:** §3 dữ liệu → Task 1; §4.1–4.2 render → Task 3; §4.3 outbox → Task 4; §5.1 verification → Task 5; §5.2 reset → Task 7–8; §5.3 invite → Task 6; §5.4 welcome → Task 9; §5.5 locale → Task 2 + 10; §6 frontend → Task 6, 8, 10; §7 vận hành/metrics → Task 5, 12; §8 kiểm thử → mỗi task + Task 11. Spec §7 nhắc `MAIL_OUTBOX_TICK`/`MAIL_HISTORY_RETENTION` env — **bỏ**, hằng số đủ (ponytail: thêm env khi có người cần đổi).
- **Type consistency:** `Enqueuer.Enqueue(ctx, *db.Queries, Message) (string, error)` dùng thống nhất ở Task 4/5/6/7/9; `Renderer` value ở mọi service; `NewWorkspaceService(pool, q, orgs, r, out)`, `NewOnboardingService(q, ws, pub, r, out)`, `NewVerificationService(q, r, out, devCode)`, `NewPasswordResetService(q, auth, r, out)` khớp giữa task định nghĩa và task gọi.
- **Placeholder:** template placeholder ở Task 3 là cố ý để `init()` không panic, được thay ở Task 6/7/9.
