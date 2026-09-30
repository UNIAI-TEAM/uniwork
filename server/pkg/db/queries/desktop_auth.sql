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
UPDATE device_sessions SET revoked_at = COALESCE(revoked_at, now())
WHERE user_id = $1 AND revoked_at IS NULL;

-- name: RevokeDesktopSessionFamily :exec
WITH revoked_tokens AS (
  UPDATE refresh_tokens SET revoked_at = now()
  WHERE refresh_tokens.user_id = $1 AND refresh_tokens.session_id = $2 AND refresh_tokens.revoked_at IS NULL
)
UPDATE device_sessions SET revoked_at = COALESCE(revoked_at, now())
WHERE device_sessions.user_id = $1 AND device_sessions.session_family_id = $2 AND device_sessions.revoked_at IS NULL;

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
