-- name: CreateDesktopAuthAttempt :one
INSERT INTO desktop_auth_attempts (
  id, client_id, deployment_id, code_challenge, code_challenge_method,
  redirect_uri, state, state_digest, device_label, platform, build, expires_at
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
RETURNING *;

-- name: GetDesktopAuthAttempt :one
SELECT * FROM desktop_auth_attempts WHERE id = $1;

-- name: GetDesktopAuthAttemptForUpdate :one
SELECT * FROM desktop_auth_attempts WHERE id = $1 FOR UPDATE;

-- name: SetDesktopAuthCSRF :one
UPDATE desktop_auth_attempts SET csrf_digest = $3, user_id = $2
WHERE id = $1 AND (user_id IS NULL OR user_id = $2)
  AND used_at IS NULL AND cancelled_at IS NULL AND expires_at > now()
RETURNING *;

-- name: ApproveDesktopAuthAttempt :one
UPDATE desktop_auth_attempts
SET user_id = $2, code_digest = $3, code_expires_at = $4, approved_at = now(), csrf_digest = NULL
WHERE id = $1 AND user_id = $2 AND used_at IS NULL AND cancelled_at IS NULL AND approved_at IS NULL AND expires_at > now()
RETURNING *;

-- name: CancelDesktopAuthAttempt :execrows
UPDATE desktop_auth_attempts SET cancelled_at = now()
WHERE id = $1 AND user_id = $2 AND used_at IS NULL AND cancelled_at IS NULL AND expires_at > now();

-- name: RedeemDesktopAuthAttempt :one
UPDATE desktop_auth_attempts SET used_at = now()
WHERE code_digest = $1 AND client_id = $2 AND deployment_id = $3 AND redirect_uri = $4 AND code_challenge = $5
  AND used_at IS NULL AND cancelled_at IS NULL AND approved_at IS NOT NULL AND code_expires_at > now()
RETURNING *;

-- name: CreateDeviceSession :one
INSERT INTO device_sessions (
  id, user_id, session_family_id, client_id, deployment_id, device_label,
  platform, build, refresh_token_digest, expires_at, created_by_kind
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
RETURNING *;

-- name: GetDeviceSession :one
SELECT * FROM device_sessions WHERE id = $1;

-- name: GetDeviceSessionForUpdate :one
SELECT * FROM device_sessions WHERE id = $1 FOR UPDATE;

-- name: ListDeviceSessions :many
SELECT * FROM device_sessions WHERE user_id = $1 ORDER BY created_at DESC;

-- name: RevokeDeviceSession :execrows
UPDATE device_sessions SET revoked_at = COALESCE(revoked_at, now())
WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL;

-- name: RevokeAllDeviceSessions :exec
-- First half of a user-wide revoke (revokeAllUserSessions; the refresh tokens
-- follow). Every desktop path locks in one order: device_sessions rows (in id
-- order when it takes several), then the family key, then refresh_tokens.
UPDATE device_sessions d SET revoked_at = COALESCE(d.revoked_at, now())
FROM (
  SELECT l.id FROM device_sessions l
  WHERE l.user_id = sqlc.arg(user_id) AND l.revoked_at IS NULL
  ORDER BY l.id
  FOR UPDATE
) live
WHERE d.id = live.id;

-- name: RevokeDeviceSessionFamily :execrows
-- Closes every live device session of the family, locking them in id order
-- (see RevokeAllDeviceSessions). The caller already holds its own row, so with
-- a live sibling of lower id its order is not strictly by id; production never
-- makes a sibling (Exchange starts one family per device). The family's
-- refresh tokens are a separate statement (RevokeSessionForUser) run after it
-- in the same transaction, so each reports its own row count.
UPDATE device_sessions d SET revoked_at = COALESCE(d.revoked_at, now())
FROM (
  SELECT l.id FROM device_sessions l
  WHERE l.user_id = sqlc.arg(user_id) AND l.session_family_id = sqlc.arg(session_family_id) AND l.revoked_at IS NULL
  ORDER BY l.id
  FOR UPDATE
) live
WHERE d.id = live.id;

-- One family's "last live device session closes its token" decision is made
-- one transaction at a time: a device-scope logout takes this key after the
-- device row lock and before revoking, so two sibling logouts cannot each
-- count the other as live and both leave the family token behind.
-- Transaction-scoped; the family-wide revoke (RevokeDeviceSessionFamily)
-- does not take it, so it never waits on a sibling row while holding it.
-- name: LockDeviceSessionFamily :exec
SELECT pg_advisory_xact_lock(hashtextextended('device_sessions.family:' || sqlc.arg(session_family_id)::text, 0));

-- name: CountLiveDeviceSessionsInFamily :one
SELECT count(*) FROM device_sessions
WHERE user_id = $1 AND session_family_id = $2 AND revoked_at IS NULL;

-- name: RotateDeviceSessionToken :one
UPDATE device_sessions SET refresh_token_digest = $2, last_used_at = now()
WHERE id = $1 AND refresh_token_digest = $3 AND revoked_at IS NULL AND expires_at > now()
RETURNING *;

-- name: TouchDeviceSession :exec
UPDATE device_sessions SET last_used_at = now()
WHERE id = $1 AND revoked_at IS NULL AND expires_at > now();

-- name: RevokeDeviceSessionByID :execrows
UPDATE device_sessions SET revoked_at = COALESCE(revoked_at, now())
WHERE id = $1 AND revoked_at IS NULL;

-- name: RefreshTokenIssuedToFamily :one
-- True when this digest was ever issued to the session family (live or
-- rotated out). Refresh uses it to tell a replayed token from a guess.
SELECT EXISTS (
  SELECT 1 FROM refresh_tokens
  WHERE token_hash = $1 AND user_id = $2 AND session_id = $3
);
