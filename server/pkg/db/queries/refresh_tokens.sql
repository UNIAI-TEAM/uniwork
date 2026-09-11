-- A session is the chain of refresh tokens sharing session_id (spec F-01 §2 I7):
-- rotation revokes the old row and inserts a new one with the same session_id.

-- name: CreateRefreshToken :one
INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at, session_id, user_agent, ip)
VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING *;

-- name: GetRefreshTokenByHash :one
SELECT * FROM refresh_tokens
WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now();

-- name: RevokeRefreshToken :exec
UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1;

-- name: RevokeAllRefreshTokensForUser :exec
UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL;

-- name: RevokeSessionForUser :execrows
UPDATE refresh_tokens SET revoked_at = now()
WHERE user_id = $1 AND session_id = $2 AND revoked_at IS NULL;

-- name: RevokeOtherSessionsForUser :execrows
UPDATE refresh_tokens SET revoked_at = now()
WHERE user_id = $1 AND session_id <> $2 AND revoked_at IS NULL;

-- name: ListActiveSessionsForUser :many
-- One live row per session; created_at of the chain is the login time.
SELECT t.session_id, t.user_agent, t.ip, t.created_at AS last_seen_at,
  (SELECT min(created_at) FROM refresh_tokens f WHERE f.session_id = t.session_id)::timestamptz AS created_at
FROM refresh_tokens t
WHERE t.user_id = $1 AND t.revoked_at IS NULL AND t.expires_at > now()
ORDER BY t.created_at DESC;

-- name: CountRefreshTokensForUserAgent :one
SELECT count(*) FROM refresh_tokens WHERE user_id = $1 AND user_agent = $2;

-- name: CountRefreshTokensForUser :one
SELECT count(*) FROM refresh_tokens WHERE user_id = $1;
