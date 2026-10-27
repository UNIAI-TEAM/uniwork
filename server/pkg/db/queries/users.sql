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
-- avatar_file_id clears with the URL write: a caller that stores a URL —
-- legacy or external (Google) — is declaring the URL the avatar source again.
UPDATE users SET avatar_url = $2, avatar_file_id = NULL, updated_at = now()
WHERE id = $1
RETURNING *;

-- The FileService swap: the new file id replaces the reference and the URL
-- column clears — for a file-backed avatar the served URL is resolved on read
-- and never persisted (FS-C1 T1-Q7).
-- name: UpdateUserAvatarFile :one
UPDATE users SET avatar_file_id = $2, avatar_url = NULL, updated_at = now()
WHERE id = $1
RETURNING *;

-- Non-locking read that opens a FileService swap: the claim/release has to
-- lock files rows before this transaction locks the user row (FS-C1 §5.4),
-- and the FOR UPDATE re-read afterwards is what serializes a concurrent
-- replace.
-- name: GetUserAvatarFileID :one
SELECT avatar_file_id FROM users WHERE id = $1;

-- Reads the current avatar file under the row lock so a concurrent replace
-- serializes here instead of releasing the same file twice.
-- name: GetUserAvatarFileIDForUpdate :one
SELECT avatar_file_id FROM users WHERE id = $1 FOR UPDATE;

-- Reference-provider view: which of these file ids a live (not deleted)
-- account still wears as its avatar.
-- name: ListUserAvatarFileIDs :many
SELECT avatar_file_id
FROM users
WHERE deleted_at IS NULL
  AND avatar_file_id = ANY(sqlc.arg('file_ids')::text[]);

-- name: CreateGoogleUser :one
-- The caller says whether the address starts verified (ADR 0047): Google
-- owns its domain, or a mailed code proved it. The link records the address
-- Google gave, which differs from the account's when a code proved another
-- one ("I was invited with another address").
INSERT INTO users (id, email, display_name, avatar_url, google_id, google_email, google_linked_at, email_verified_at, locale)
VALUES (
  sqlc.arg('id'), sqlc.arg('email'), sqlc.arg('display_name'), sqlc.narg('avatar_url'), sqlc.arg('google_id'),
  sqlc.arg('google_email'), now(), CASE WHEN sqlc.arg('email_verified')::bool THEN now() END, sqlc.arg('locale')
)
RETURNING *;

-- name: GetUserByGoogleID :one
SELECT * FROM users WHERE google_id = $1;

-- name: CreateAppleUser :one
-- Sign in with Apple (ADR 0041): no password, onboarding still ahead
-- (onboarded_at stays NULL). The caller says whether the address starts
-- verified (ADR 0047); the link records the address Apple gave, which
-- differs from the account's when a mailed code proved another one.
INSERT INTO users (id, email, display_name, apple_id, apple_email, apple_linked_at, email_verified_at, locale)
VALUES (
  sqlc.arg('id'), sqlc.arg('email'), sqlc.arg('display_name'), sqlc.arg('apple_id'),
  sqlc.arg('apple_email'), now(), CASE WHEN sqlc.arg('email_verified')::bool THEN now() END, sqlc.arg('locale')
)
RETURNING *;

-- name: GetUserByAppleID :one
SELECT * FROM users WHERE apple_id = $1;

-- name: LinkAppleAccount :one
-- Only a live account whose address is verified, and that is not linked to
-- another Apple subject, takes the link (ADR 0047): a link never verifies an
-- address. It records the Apple address and when (kept on a relink of the
-- same subject) and forgets an unlink of the subject.
UPDATE users SET
  apple_id = sqlc.arg('apple_id'),
  apple_email = sqlc.arg('apple_email'),
  apple_linked_at = CASE WHEN apple_id = sqlc.arg('apple_id') THEN apple_linked_at ELSE now() END,
  apple_unlinked_sub = NULL,
  updated_at = now()
WHERE id = sqlc.arg('id') AND deleted_at IS NULL AND email_verified_at IS NOT NULL
  AND (apple_id IS NULL OR apple_id = sqlc.arg('apple_id'))
RETURNING *;

-- name: UnlinkAppleAccount :one
-- Removes the Apple link and the token kept for it (the caller revokes that
-- token after commit). The subject stays as apple_unlinked_sub, so the same
-- Apple ID is never linked back by its address (ADR 0047).
UPDATE users SET
  apple_unlinked_sub = apple_id,
  apple_id = NULL, apple_email = NULL, apple_linked_at = NULL,
  apple_client_id = NULL, apple_refresh_token_enc = NULL,
  updated_at = now()
WHERE id = $1 AND deleted_at IS NULL AND apple_id IS NOT NULL
RETURNING *;

-- name: SetAppleRefreshToken :exec
-- The sealed refresh token of the account's Apple consent and the bundle id it
-- was issued to: account deletion revokes it with that client id.
UPDATE users SET apple_client_id = $2, apple_refresh_token_enc = $3, updated_at = now()
WHERE id = $1 AND apple_id IS NOT NULL;

-- name: LinkGoogleAccount :one
-- Only a live account whose address is verified, and that is not linked to
-- another Google subject, takes the link (ADR 0047): a link never verifies an
-- address. It records the Google address and when (kept on a relink of the
-- same subject), forgets an unlink of the subject and fills an empty avatar.
UPDATE users SET
  google_id = sqlc.arg('google_id'),
  google_email = sqlc.arg('google_email'),
  google_linked_at = CASE WHEN google_id = sqlc.arg('google_id') THEN google_linked_at ELSE now() END,
  google_unlinked_sub = NULL,
  avatar_url = COALESCE(avatar_url, sqlc.narg('avatar_url')),
  updated_at = now()
WHERE id = sqlc.arg('id') AND deleted_at IS NULL AND email_verified_at IS NOT NULL
  AND (google_id IS NULL OR google_id = sqlc.arg('google_id'))
RETURNING *;

-- name: UnlinkGoogleAccount :one
-- The subject stays as google_unlinked_sub, so the same Google account is
-- never linked back by its address (ADR 0047).
UPDATE users SET
  google_unlinked_sub = google_id,
  google_id = NULL, google_email = NULL, google_linked_at = NULL,
  updated_at = now()
WHERE id = $1 AND deleted_at IS NULL AND google_id IS NOT NULL
RETURNING *;

-- name: GetUserForUpdate :one
-- Serializes the commands that change how the account signs in.
SELECT * FROM users WHERE id = $1 FOR UPDATE;

-- name: ReclaimUnverifiedUser :one
-- The owner of the mailbox takes an account someone registered with their
-- address before proving it (ADR 0047): whatever that person set up goes —
-- password, second factor, recovery codes, every provider link (the caller
-- read the sealed Apple token first, to revoke it after commit), the AI
-- consent answer — and the address is verified. Only an unverified, live
-- account matches.
UPDATE users SET
  password_hash = NULL, password_changed_at = NULL,
  totp_secret = NULL, mfa_enabled_at = NULL, mfa_recovery_codes = '{}',
  second_factor_failures = 0, second_factor_locked_until = NULL,
  google_id = NULL, google_email = NULL, google_linked_at = NULL, google_unlinked_sub = NULL,
  apple_id = NULL, apple_email = NULL, apple_linked_at = NULL, apple_unlinked_sub = NULL,
  apple_client_id = NULL, apple_refresh_token_enc = NULL,
  ai_consent_version = NULL, ai_consent_at = NULL, ai_opt_out_at = NULL,
  email_verified_at = now(), updated_at = now()
WHERE id = $1 AND email_verified_at IS NULL AND deleted_at IS NULL
RETURNING *;

-- name: MarkCredentialsRevoked :exec
-- Sensitive commands refuse an access token issued before this (ADR 0047).
-- Truncated to the second because a token's iat is: the session the same
-- command hands out is not older than the mark.
UPDATE users SET credentials_revoked_at = date_trunc('second', now()), updated_at = now()
WHERE id = $1;

-- name: RecordSecondFactorFailure :one
-- One more wrong second factor or step-up proof (ADR 0047). The failure that
-- reaches max_failures locks both until locked_until and starts the count
-- over; the caller compares the lockout it reads back with the one it passed
-- to tell whether this failure started it.
UPDATE users SET
  second_factor_failures = CASE WHEN second_factor_failures + 1 >= sqlc.arg('max_failures')::int THEN 0 ELSE second_factor_failures + 1 END,
  second_factor_locked_until = CASE WHEN second_factor_failures + 1 >= sqlc.arg('max_failures')::int THEN sqlc.arg('locked_until')::timestamptz ELSE second_factor_locked_until END,
  updated_at = now()
WHERE id = sqlc.arg('id') AND deleted_at IS NULL
RETURNING second_factor_failures, second_factor_locked_until;

-- name: ResetSecondFactorFailures :exec
-- A right answer clears the count; a row with nothing to clear is not written.
UPDATE users SET second_factor_failures = 0, second_factor_locked_until = NULL, updated_at = now()
WHERE id = $1 AND (second_factor_failures <> 0 OR second_factor_locked_until IS NOT NULL);

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

-- The person's answer to the AI processing notice (Apple 5.1.2(i)). A NULL
-- version withdraws consent (or declines it) and clears the time with it;
-- declining also keeps the person's messages out of every AI request
-- (ai_opt_out_at), which agreeing again lifts.
-- name: SetUserAIConsent :one
UPDATE users SET
  ai_consent_version = sqlc.narg('version'),
  ai_consent_at      = CASE WHEN sqlc.narg('version')::text IS NULL THEN NULL ELSE now() END,
  ai_opt_out_at      = CASE WHEN sqlc.narg('version')::text IS NULL THEN now() ELSE NULL END,
  updated_at         = now()
WHERE id = sqlc.arg('id') AND deleted_at IS NULL
RETURNING *;

-- name: ListAIOptedOutUserIDs :many
-- Of these people, the ones who declined AI processing: what they wrote stays
-- out of every AI request, whoever makes it (service/ai_opt_out.go).
SELECT id FROM users WHERE id = ANY(sqlc.arg('ids')::text[]) AND ai_opt_out_at IS NOT NULL;

-- name: SetUserPushPreviewsHidden :one
-- Keeps the first time it was hidden, so turning it on twice changes nothing.
UPDATE users SET
  push_previews_hidden_at = CASE WHEN sqlc.arg('hidden')::bool THEN COALESCE(push_previews_hidden_at, now()) ELSE NULL END,
  updated_at              = now()
WHERE id = sqlc.arg('id') AND deleted_at IS NULL
RETURNING *;

-- name: SetUserPassword :one
-- Every password write (reset link, Settings) records when; a deleted
-- account takes none, so a reset link mailed before the deletion is dead.
UPDATE users SET password_hash = $2, password_changed_at = now(), updated_at = now()
WHERE id = $1 AND deleted_at IS NULL
RETURNING *;

-- name: SetUserMatrixUserID :one
UPDATE users SET matrix_user_id = $2, updated_at = now()
WHERE id = $1
RETURNING *;

-- name: GetUsersByIDs :many
SELECT id, display_name, email, avatar_url, avatar_file_id FROM users WHERE id = ANY(sqlc.arg('ids')::text[]);

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
-- tenant: self
-- Only an organization the account still belongs to (ADR 0032 D1) holds the
-- deletion back: a closed one keeps its owner row, deactivated, for a restore.
SELECT count(*) FROM organization_members m
JOIN organizations o ON o.id = m.organization_id
WHERE m.user_id = $1 AND m.role = 'owner' AND m.deactivated_at IS NULL
  AND o.status IN ('active', 'suspended');

-- name: AnonymizeUser :one
-- Nghị định 13 deletion: identity fields go, the row and its audit trail stay;
-- every credential issued before now is marked revoked (ADR 0047).
UPDATE users SET
  email = $2, display_name = $3, password_hash = NULL, avatar_url = NULL, avatar_file_id = NULL,
  google_id = NULL, google_email = NULL, google_linked_at = NULL, google_unlinked_sub = NULL,
  apple_id = NULL, apple_email = NULL, apple_linked_at = NULL, apple_unlinked_sub = NULL,
  apple_client_id = NULL, apple_refresh_token_enc = NULL,
  password_changed_at = NULL, credentials_revoked_at = date_trunc('second', now()),
  totp_secret = NULL, mfa_enabled_at = NULL, mfa_recovery_codes = '{}',
  second_factor_failures = 0, second_factor_locked_until = NULL,
  platform_role = NULL, matrix_user_id = NULL, onboarding_questionnaire = '{}'::jsonb,
  ai_consent_version = NULL, ai_consent_at = NULL,
  deleted_at = now(), updated_at = now()
WHERE id = $1 AND deleted_at IS NULL
RETURNING *;

-- name: DeactivateAllOrganizationMembershipsForUser :exec
-- tenant: self
UPDATE organization_members SET deactivated_at = now(), deactivated_by = $1, updated_at = now()
WHERE user_id = $1 AND deactivated_at IS NULL;

-- name: ScrubMemberProfilesForUser :exec
-- tenant: self
-- phone, location and bio are NOT NULL with an empty default (migration 134);
-- only employee_code is nullable, because its unique index skips NULLs.
UPDATE organization_member_profiles SET
  phone = '', phone_visible = false, location = '', bio = '', employee_code = NULL,
  search_text = '', updated_at = now()
WHERE user_id = $1;

-- name: RevokeAllPushSubscriptionsForUser :exec
UPDATE push_subscriptions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL;

-- name: GetUserAskUniMode :one
SELECT ask_uni_mode FROM users WHERE id = $1;

-- name: SetUserAskUniMode :exec
UPDATE users SET ask_uni_mode = sqlc.narg(mode)::text, updated_at = now() WHERE id = sqlc.arg(id);

-- name: GetUserAskUniMemoryOff :one
SELECT ask_uni_memory_off FROM users WHERE id = $1;

-- name: SetUserAskUniMemoryOff :exec
UPDATE users SET ask_uni_memory_off = sqlc.arg(off), updated_at = now() WHERE id = sqlc.arg(id);
