# UNI-432 · Identity hardening Implementation Plan

> **Trạng thái:** shipped — UNI-432 hoàn tất 2026-09-07 trừ OIDC Microsoft (cố ý bỏ, chuyển A-06); Go: `go test ./internal/service ./internal/handler/... ./internal/middleware ./internal/auth ./internal/mail ./migrations` PASS; FE: vitest core/views PASS, `pnpm lint`, `pnpm knip`, `pnpm typecheck` PASS; E2E bỏ qua theo `GATE_LEVEL=fast`.

**Goal:** Đăng nhập an toàn theo Vision §6.1: MFA TOTP với mã khôi phục, danh sách phiên/thiết bị và thu hồi, cảnh báo đăng nhập mới, xóa tài khoản theo Nghị định 13.

**Architecture:** Không bảng mới. `users` nhận `totp_secret` (niêm phong AES-GCM, khóa dẫn từ `JWT_SECRET`), `mfa_enabled_at`, `mfa_recovery_codes`, `deleted_at`; `refresh_tokens` nhận `session_id`/`user_agent`/`ip` và một phiên là chuỗi token cùng `session_id`. Bước hai của đăng nhập là JWT `aud=mfa` 5 phút mà `RequireAuth` từ chối. Metadata phiên đi qua context (`service.WithSessionMeta`) nên không đổi chữ ký service nào.

**Tech Stack:** Go 1.27 stdlib (`crypto/hmac`, `aes-gcm`), pgx/sqlc, Chi SDI/SDO; TypeScript, Zod, Vitest, `qrcode` (dependency mới duy nhất, để hiện QR otpauth).

**Spec:** `docs/superpowers/specs/2026-09-07-identity-hardening-design.md`

**Tracking:** `UNI-432` (nhánh `feature/UNI-432-identity-hardening-mfa-totp-oidc-microso`).

## Global Constraints

- Không FK/cascade; index `CONCURRENTLY` đứng riêng file (`153`).
- Chỉ `internal/audit` ghi audit; ba action mới có trong `audit_coverage_test.go`.
- Không thêm biến môi trường; `qrcode` là dependency mới duy nhất.
- OIDC Microsoft **không** làm — quyết định chủ sở hữu sản phẩm 2026-09-07.

## File map

- Migration: `server/migrations/152_identity_hardening.*`, `153_refresh_tokens_session_idx.*`
- Query: `server/pkg/db/queries/users.sql`, `refresh_tokens.sql`
- Auth pkg: `server/internal/auth/totp.go` (+test), `token.go` (`MintSession`/`MintMFA`/`ParseSession`/`ParseMFA`)
- Service: `server/internal/service/auth.go` (SessionMeta, sessionOrChallenge, new-login mail), `mfa.go`, `sessions.go`, `account_deletion.go`, `errors.go`
- Middleware: `auth.go` (`SessionID`), `platform_role.go` (403 `mfa_required`), `ratelimit.go` (`ClientIP`)
- Handler: `identity.go`, `auth.go`, `google.go`, `password_reset.go`, `router.go`, `router/{auth,me,routes,openapi}.go`, `dto/{sdi,sdo}/auth.go`
- Mail: `server/internal/mail/new_login.go`, `templates/new_login.{vi,en}.{html,txt}`
- Core: `types/user.ts`, `api/endpoints/auth.ts` (+test), `auth/hooks.ts`, `auth/index.ts`, `i18n/locales/{vi,en}.json`
- Views: `auth/mfa-step.tsx`, `auth/login-view.tsx` (+test), `auth/reset-password-view.tsx`, `settings/components/security-tab.tsx` (+test), `delete-account-dialog.tsx`, `settings-page.tsx`, `admin/layout.tsx`
- Web: `apps/web/app/(auth)/login/page.tsx`

## Tasks

- [x] Task 1 — Migration + query + sqlc. `feat(db): identity hardening columns on users and refresh_tokens`
- [x] Task 2 — TOTP/sealer/recovery codes trên stdlib; token `sid` và `aud=mfa`. `feat(auth): stdlib TOTP, sealed secrets, mfa challenge tokens`
- [x] Task 3 — Service: MFA, phiên, xóa tài khoản, mail `new_login`, audit. `feat(service): mfa, sessions and account deletion`
- [x] Task 4 — Handler/route/SDI/SDO; cổng admin 403 `mfa_required`. `feat(api): mfa verify, sessions, delete account routes`
- [x] Task 5 — Core endpoints/hooks + test malformed. `feat(core): identity endpoints and hooks`
- [x] Task 6 — Views: bước MFA khi đăng nhập, tab Bảo mật, dialog xóa, admin guard. `feat(web): security settings tab and mfa login step`
- [x] Task 7 — Docs: spec, plan, roadmap, README, `.env.example`. `docs: identity hardening spec, plan, roadmap`

## Đã cố ý bỏ ra ngoài

- OIDC Microsoft (theo yêu cầu); WebAuthn; org MFA policy; thu hồi access token trước hạn (ceiling 15 phút, nâng cấp: tra `sid` ở Redis trong `RequireAuth`); mã khôi phục sinh lại (tắt/bật lại MFA thay thế); E2E (GATE_LEVEL fast).
