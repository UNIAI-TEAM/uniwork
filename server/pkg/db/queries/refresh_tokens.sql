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
-- Second half of a user-wide revoke: call revokeAllUserSessions (service),
-- which closes the device sessions first so the locks come in one order.
UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL;

-- name: RevokeSessionForUser :execrows
UPDATE refresh_tokens SET revoked_at = now()
WHERE user_id = $1 AND session_id = $2 AND revoked_at IS NULL;

-- name: RevokeOtherSessionsForUser :execrows
-- Second half of revoking every session but the caller's: call
-- revokeOtherUserSessions (service), which closes the other device sessions
-- first so the locks come in one order. session_id is the kept session (a
-- browser session id, or the caller's device family).
UPDATE refresh_tokens SET revoked_at = now()
WHERE user_id = $1 AND session_id <> $2 AND revoked_at IS NULL;

-- name: ListActiveSessionsForUser :many
-- One row per session_id (a refresh rotation can leave several live token rows).
SELECT s.session_id, s.user_agent, s.ip, s.last_seen_at, s.created_at
FROM (
  SELECT DISTINCT ON (t.session_id)
    t.session_id,
    t.user_agent,
    t.ip,
    t.created_at AS last_seen_at,
    (SELECT min(created_at) FROM refresh_tokens f WHERE f.session_id = t.session_id)::timestamptz AS created_at
  FROM refresh_tokens t
  WHERE t.user_id = $1 AND t.revoked_at IS NULL AND t.expires_at > now()
  ORDER BY t.session_id, t.created_at DESC
) s
ORDER BY s.last_seen_at DESC;

-- name: CountRefreshTokensForUserAgent :one
SELECT count(*) FROM refresh_tokens WHERE user_id = $1 AND user_agent = $2;

-- name: CountRefreshTokensForUser :one
SELECT count(*) FROM refresh_tokens WHERE user_id = $1;

-- name: GetWebSessionStart :one
-- When a browser session started (its first refresh token: rotation keeps
-- the session id and no row is ever deleted) and whether any of its tokens
-- is still live. A sign-in ticket links only into a session that started
-- after the ticket was issued (ADR 0047).
SELECT min(created_at)::timestamptz AS started_at,
       COALESCE(bool_or(revoked_at IS NULL AND expires_at > now()), false)::bool AS live
FROM refresh_tokens
WHERE user_id = $1 AND session_id = $2;
