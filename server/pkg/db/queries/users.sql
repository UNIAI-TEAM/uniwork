-- name: CreateUser :one
INSERT INTO users (id, email, password_hash, display_name, locale)
VALUES ($1, $2, $3, $4, $5)
RETURNING *;

-- name: GetUserByEmail :one
SELECT * FROM users WHERE email = $1;

-- name: GetUserByID :one
SELECT * FROM users WHERE id = $1;

-- name: PatchUserOnboarding :one
UPDATE users SET
  onboarding_questionnaire = COALESCE(sqlc.narg('questionnaire'), onboarding_questionnaire),
  updated_at = now()
WHERE id = sqlc.arg('id')
RETURNING *;

-- name: MarkUserOnboarded :one
UPDATE users SET onboarded_at = COALESCE(onboarded_at, now()), updated_at = now()
WHERE id = $1
RETURNING *;

-- name: UpdateUserAvatar :one
UPDATE users SET avatar_url = $2, updated_at = now()
WHERE id = $1
RETURNING *;

-- name: CreateGoogleUser :one
INSERT INTO users (id, email, display_name, avatar_url, google_id, email_verified_at, locale)
VALUES ($1, $2, $3, $4, $5, now(), $6)
RETURNING *;

-- name: GetUserByGoogleID :one
SELECT * FROM users WHERE google_id = $1;

-- name: LinkGoogleAccount :one
UPDATE users SET
  google_id = $2,
  email_verified_at = COALESCE(email_verified_at, now()),
  avatar_url = COALESCE(avatar_url, sqlc.narg('avatar_url')),
  updated_at = now()
WHERE id = $1
RETURNING *;

-- name: MarkEmailVerified :one
UPDATE users SET email_verified_at = COALESCE(email_verified_at, now()), updated_at = now()
WHERE id = $1
RETURNING *;

-- Nil arguments keep the current value, so one statement serves both
-- PATCH /me shapes and the two fields commit together.
-- name: UpdateUserProfile :one
UPDATE users SET
  display_name = COALESCE(sqlc.narg('display_name'), display_name),
  locale       = COALESCE(sqlc.narg('locale'), locale),
  timezone     = COALESCE(sqlc.narg('timezone'), timezone),
  updated_at   = now()
WHERE id = sqlc.arg('id')
RETURNING *;

-- name: UpdateUserPassword :one
UPDATE users SET password_hash = $2, updated_at = now()
WHERE id = $1
RETURNING *;

-- name: SetUserMatrixUserID :one
UPDATE users SET matrix_user_id = $2, updated_at = now()
WHERE id = $1
RETURNING *;

-- name: GetUsersByIDs :many
SELECT id, display_name, avatar_url FROM users WHERE id = ANY(sqlc.arg('ids')::text[]);

-- Identity hardening (F-01, UNI-432).

-- name: SetUserTOTPSecret :exec
-- A fresh enrolment: the sealed secret is stored, MFA stays off until confirmed.
UPDATE users SET totp_secret = $2, updated_at = now() WHERE id = $1;

-- name: EnableUserMFA :one
UPDATE users SET mfa_enabled_at = now(), mfa_recovery_codes = $2, updated_at = now()
WHERE id = $1
RETURNING *;

-- name: DisableUserMFA :one
UPDATE users SET totp_secret = NULL, mfa_enabled_at = NULL, mfa_recovery_codes = '{}', updated_at = now()
WHERE id = $1
RETURNING *;

-- name: ConsumeUserRecoveryCode :execrows
-- Removing the hash is the single-use guarantee; zero rows means it was not there.
UPDATE users SET mfa_recovery_codes = array_remove(mfa_recovery_codes, $2::text), updated_at = now()
WHERE id = $1 AND $2::text = ANY(mfa_recovery_codes);

-- name: CountOwnedOrganizationsForUser :one
SELECT count(*) FROM organization_members WHERE user_id = $1 AND role = 'owner';

-- name: AnonymizeUser :one
-- Nghị định 13 deletion: identity fields go, the row and its audit trail stay.
UPDATE users SET
  email = $2, display_name = $3, password_hash = NULL, avatar_url = NULL, google_id = NULL,
  totp_secret = NULL, mfa_enabled_at = NULL, mfa_recovery_codes = '{}',
  platform_role = NULL, matrix_user_id = NULL, onboarding_questionnaire = '{}'::jsonb,
  deleted_at = now(), updated_at = now()
WHERE id = $1 AND deleted_at IS NULL
RETURNING *;

-- name: DeactivateAllOrganizationMembershipsForUser :exec
UPDATE organization_members SET deactivated_at = now(), deactivated_by = $1, updated_at = now()
WHERE user_id = $1 AND deactivated_at IS NULL;

-- name: ScrubMemberProfilesForUser :exec
UPDATE organization_member_profiles SET
  phone = NULL, phone_visible = false, location = NULL, bio = NULL, employee_code = NULL,
  search_text = '', updated_at = now()
WHERE user_id = $1;

-- name: RevokeAllPushSubscriptionsForUser :exec
UPDATE push_subscriptions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL;
