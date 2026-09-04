-- name: CreatePasswordResetToken :one
INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at, created_at)
VALUES ($1, $2, $3, $4, $5)
RETURNING *;

-- Chưa dùng và chưa hết hạn quyết định ở đây, caller không thể quên.
-- name: GetActivePasswordResetTokenByHash :one
SELECT * FROM password_reset_tokens
WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now();

-- name: GetLatestPasswordResetTokenForUser :one
SELECT * FROM password_reset_tokens WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1;

-- name: MarkPasswordResetTokenUsed :execrows
UPDATE password_reset_tokens SET used_at = now() WHERE id = $1 AND used_at IS NULL;

-- Tokens cũ chưa dùng bị vô hiệu hoá (không xoá) để CountPasswordResetTokensForUserSince
-- vẫn đếm được lịch sử trong ngày; DeleteExpiredPasswordResetTokens dọn sau 1 ngày.
-- name: ExpirePasswordResetTokensForUser :exec
UPDATE password_reset_tokens SET used_at = now() WHERE user_id = $1 AND used_at IS NULL;

-- name: DeleteExpiredPasswordResetTokens :exec
DELETE FROM password_reset_tokens WHERE expires_at < now() - interval '1 day';

-- name: CountPasswordResetTokensForUserSince :one
SELECT count(*) FROM password_reset_tokens WHERE user_id = $1 AND created_at > $2;
