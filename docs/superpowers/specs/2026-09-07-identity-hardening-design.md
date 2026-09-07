# UniWork — Identity hardening: MFA TOTP, quản lý phiên/thiết bị, xóa tài khoản

**Ngày:** 2026-09-07
**Trạng thái:** Đã triển khai (2026-09-07, UNI-432). Phạm vi chốt bởi chủ sở hữu sản phẩm ngày 2026-09-07: **không làm provider OIDC thứ hai (Microsoft)** trong đợt này; phần đó chuyển sang A-06 (SSO). Các mục còn lại của F-01 làm hết.
**Spec liên quan:** `2026-08-27-google-auth-email-verification-design.md`, `2026-08-28-transactional-email-design.md`, `2026-08-27-settings-design.md`, `2026-09-04-platform-admin-observability-design.md`, `2026-09-04-audit-domain-events-design.md`
**Tham chiếu:** Vision §6.1 (đăng nhập an toàn), Nghị định 13/2023 (quyền xóa dữ liệu cá nhân), RFC 6238 (TOTP), ADR 0009, ADR 0012; roadmap F-01

## 1. Mục tiêu

1. **MFA TOTP** theo RFC 6238 với mã khôi phục; bắt buộc với người có `users.platform_role` khi vào `/api/v1/admin/*`.
2. **Phiên và thiết bị**: người dùng thấy các phiên đang mở (trình duyệt, IP, lần cuối), thu hồi từng phiên hoặc mọi phiên khác; email cảnh báo khi đăng nhập từ trình duyệt mới.
3. **Xóa tài khoản** theo Nghị định 13: ẩn danh hóa dữ liệu định danh, giữ nguyên `audit_events` (ADR 0012) và nội dung công việc đã tạo (task, comment, meeting) dưới tên "Người dùng đã xóa".

**Ngoài phạm vi đợt này**

- OIDC Microsoft (quyết định 2026-09-07; làm cùng Keycloak/OIDC bất kỳ ở A-06/E-02 với adapter chung).
- Chính sách MFA bắt buộc theo tổ chức (org policy) — chỉ bắt buộc theo `platform_role`.
- WebAuthn/passkey.
- Thu hồi access token trước hạn: access JWT sống tối đa 15 phút sau khi phiên bị thu hồi (xem §4.3).
- Xóa cứng nội dung người dùng đã tạo; xuất dữ liệu cá nhân (data export).

## 2. Quyết định đã chốt

| # | Quyết định |
| --- | --- |
| I1 | TOTP tự cài bằng stdlib (`crypto/hmac`, SHA-1, 6 số, bước 30 s, chấp nhận ±1 bước). Không thêm dependency. |
| I2 | Bí mật TOTP lưu trong `users.totp_secret`, niêm phong AES-256-GCM với khóa dẫn xuất từ `JWT_SECRET` (SHA-256). Không thêm biến môi trường mới; đổi `JWT_SECRET` đồng nghĩa mọi người phải đăng ký MFA lại — ghi trong runbook. |
| I3 | Mã khôi phục: 8 mã dạng `xxxxx-xxxxx`, chỉ hiện một lần khi bật MFA, lưu SHA-256 trong `users.mfa_recovery_codes TEXT[]`; dùng mã là xóa khỏi mảng. Muốn mã mới thì tắt rồi bật lại MFA. |
| I4 | Luồng đăng nhập hai bước: mật khẩu (hoặc Google, hoặc reset mật khẩu) đúng nhưng MFA đang bật → server trả `{mfa_required: true, mfa_token}` thay cho phiên; `mfa_token` là JWT audience `mfa`, sống 5 phút, **không** qua được `RequireAuth`. `POST /auth/mfa/verify` đổi nó lấy phiên. |
| I5 | Với luồng redirect (Google) và reset mật khẩu, `mfa_token` đặt trong cookie HttpOnly `uniwork_mfa` (Path `/api/v1/auth`, 5 phút) và frontend mở `/login?mfa=1`; verify đọc body trước, cookie sau. |
| I6 | Bắt buộc MFA cho `platform_role` thực thi tại cổng `RequirePlatformRole`: có role mà chưa bật MFA → 403 `mfa_required`. Vẫn đăng nhập được app để đi bật MFA. |
| I7 | Không tạo bảng phiên mới. Một phiên = một chuỗi `refresh_tokens` cùng `session_id`; xoay token giữ `session_id`, `user_agent`, cập nhật `ip`. Access JWT mang claim `sid` để đánh dấu "phiên hiện tại". |
| I8 | "Thiết bị mới" = chưa từng có `refresh_tokens` nào của người này với cùng `user_agent`. Lần đăng nhập đầu tiên (đăng ký) không gửi mail. |
| I9 | Xóa tài khoản cần xác thực lại: có mật khẩu → mật khẩu; chỉ Google và có MFA → mã TOTP; chỉ Google, không MFA → xác nhận bằng gõ email. Chủ sở hữu tổ chức phải chuyển quyền trước (409 `owner_must_transfer`). |
| I10 | Ẩn danh hóa thay vì xóa dòng: `email = deleted-<id>@deleted.uniwork.invalid`, `display_name = "Người dùng đã xóa"`, xóa mật khẩu/Google/avatar/TOTP/`platform_role`, `deleted_at = now()`; vô hiệu hóa mọi `organization_members`, xóa PII trong `member_profiles`, thu hồi mọi phiên và push subscription. `audit_events` giữ nguyên (ADR 0012). |

## 3. Data model

Migration `152_identity_hardening` (+ `153` index concurrently):

```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret TEXT;                       -- AES-GCM sealed, base64
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_enabled_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_recovery_codes TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS session_id TEXT NOT NULL DEFAULT '';
ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS user_agent TEXT NOT NULL DEFAULT '';
ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS ip TEXT NOT NULL DEFAULT '';
UPDATE refresh_tokens SET session_id = id WHERE session_id = '';
CREATE INDEX CONCURRENTLY idx_refresh_tokens_session ON refresh_tokens(session_id);
```

`users` và `refresh_tokens` đã nằm trong `tenantExemptTables` (identity). Không FK, không cascade mới.

## 4. API

Tag `auth` (public, credential rate limit):

| Method | Path | SDI | SDO | Lỗi |
| --- | --- | --- | --- | --- |
| POST | `/auth/login` | `LoginSDI` | `SessionSDO` **hoặc** `MFAChallengeSDO{mfa_required:true, mfa_token}` | 401 `invalid_credentials` |
| POST | `/auth/mfa/verify` | `MFAVerifySDI{mfa_token?, code}` | `SessionSDO` | 401 `invalid_credentials` (mã sai, token hết hạn) |

Tag `me` (Bearer):

| Method | Path | SDI | SDO | Lỗi |
| --- | --- | --- | --- | --- |
| POST | `/me/mfa/setup` | — | `MFASetupSDO{secret, otpauth_url}` | 409 `conflict` khi MFA đã bật |
| POST | `/me/mfa/confirm` | `MFACodeSDI{code}` | `MFARecoveryCodesSDO{recovery_codes[]}` | 400 `invalid_code` |
| POST | `/me/mfa/disable` | `MFACodeSDI{code}` (TOTP hoặc mã khôi phục) | `UserSDO` | 400 `invalid_code` |
| GET | `/me/sessions` | — | `SessionListSDO{sessions[]{id, user_agent, ip, created_at, last_seen_at, current}}` | — |
| DELETE | `/me/sessions/{sessionId}` | — | `StatusSDO` | 404 |
| POST | `/me/sessions/revoke-others` | — | `StatusSDO` | — |
| POST | `/me/delete` | `DeleteAccountSDI{password?, code?, email_confirmation?}` | `StatusSDO` | 401 `invalid_credentials`, 409 `owner_must_transfer` |

`UserDTO` thêm `mfa_enabled_at` (nullable) và `platform_role` (nullable) để UI biết phải nhắc bật MFA.

Cổng admin: `RequirePlatformRole` → 403 `{"code":"mfa_required"}` khi có role mà `mfa_enabled_at IS NULL`.

### 4.3 Giới hạn biết trước

Thu hồi phiên chỉ thu hồi refresh token; access JWT của phiên đó còn hiệu lực tối đa 15 phút. Nâng cấp khi cần: `RequireAuth` tra `sid` trong danh sách thu hồi ở Redis (đã có `MembershipCache` làm mẫu).

## 5. Sự kiện

Không có sự kiện outbox mới (đăng nhập không có consumer, như `recordAuth` đã ghi). Audit mới: `auth.mfa_enabled`, `auth.mfa_disabled`, `user.deleted`; `auth.login_succeeded` mang `metadata.mfa=true` khi qua bước hai; `auth.session_revoked` mang `scope: one|others|all`. Mail mới: kind `new_login` (vi/en, html+txt).

## 6. Quyền

Mọi route `me/*` chỉ tác động lên `middleware.UserID`; không có quyền chéo. Không có rule mới trong `packages/core/permissions/`.

## 7. FE file map

- `packages/core/types/user.ts` — `mfa_enabled_at`, `platform_role`, `MFAChallenge`, `UserSession`.
- `packages/core/api/endpoints/auth.ts` (+ test) — `login` trả `SessionResponse | MFAChallenge`; `verifyMfa`, `mfaSetup`, `mfaConfirm`, `mfaDisable`, `listSessions`, `revokeSession`, `revokeOtherSessions`, `deleteAccount`.
- `packages/core/auth/hooks.ts` — hook tương ứng; `useLogin` trả union.
- `packages/views/auth/mfa-step.tsx` — bước nhập mã (login + `?mfa=1`).
- `packages/views/settings/components/security-tab.tsx` — MFA, phiên, xóa tài khoản; tab `security` trong nhóm Tài khoản.
- `apps/web/app/(auth)/login/page.tsx` — đọc `mfa=1`.
- i18n `auth.mfa.*`, `settings.security.*` (vi/en).

## 8. Kiểm thử bắt buộc

- Go: TOTP vector RFC 6238; seal/open; `Parse` từ chối token `aud=mfa`; login với MFA trả challenge, verify sai/đúng, mã khôi phục dùng một lần; sessions list/revoke/ revoke-others; refresh giữ `session_id`; mail `new_login` chỉ khi UA mới; delete: chủ sở hữu bị chặn, sau xóa email đổi/đăng nhập cũ thất bại/audit còn; `RequirePlatformRole` 403 `mfa_required`; `audit_coverage_test` có ba action mới.
- FE: malformed-response cho từng endpoint mới; `login-view` hiện bước MFA khi nhận challenge; `security-tab` trạng thái rỗng/lỗi/có dữ liệu.

## 9. Kế thừa từ bản cũ

Bản cũ dùng Supabase Auth; chỉ kế thừa yêu cầu (HIBP không làm — ngoài phạm vi; JWT tamper case đã có trong `token_test.go`).

## 10. Câu hỏi mở

Không còn. OIDC Microsoft đã chuyển "ngoài phạm vi" theo quyết định 2026-09-07.
