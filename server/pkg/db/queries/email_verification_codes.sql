-- name: CreateEmailVerificationCode :one
INSERT INTO email_verification_codes (id, user_id, code_hash, expires_at, created_at)
VALUES ($1, $2, $3, $4, $5)
RETURNING *;

-- Single-use, expiry and the attempt cap are all decided here so callers
-- cannot forget one of them.
-- name: GetActiveEmailVerificationCode :one
SELECT * FROM email_verification_codes
WHERE user_id = $1 AND used_at IS NULL AND expires_at > now() AND attempts < 5
ORDER BY created_at DESC
LIMIT 1;

-- Newest row regardless of state: powers the resend gate.
-- name: GetLatestEmailVerificationCode :one
SELECT * FROM email_verification_codes
WHERE user_id = $1
ORDER BY created_at DESC
LIMIT 1;

-- name: MarkEmailVerificationCodeUsed :exec
UPDATE email_verification_codes SET used_at = now() WHERE id = $1;

-- name: IncrementEmailVerificationCodeAttempts :exec
UPDATE email_verification_codes SET attempts = attempts + 1 WHERE id = $1;

-- name: DeleteExpiredEmailVerificationCodes :exec
DELETE FROM email_verification_codes WHERE expires_at < now() - interval '1 hour';

-- name: DeleteEmailVerificationCodesForUser :exec
DELETE FROM email_verification_codes WHERE user_id = $1;
