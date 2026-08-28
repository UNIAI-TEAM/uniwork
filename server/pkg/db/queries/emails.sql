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
