-- name: UpsertCalendarConnection :one
INSERT INTO calendar_connections (
  id, organization_id, workspace_id, user_id, provider, account_email,
  access_token_enc, refresh_token_enc, access_token_expires_at, selected_calendar_ids
) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
ON CONFLICT (organization_id, workspace_id, user_id, provider)
  WHERE disconnected_at IS NULL
DO UPDATE SET account_email = EXCLUDED.account_email,
  access_token_enc = EXCLUDED.access_token_enc,
  refresh_token_enc = EXCLUDED.refresh_token_enc,
  access_token_expires_at = EXCLUDED.access_token_expires_at,
  updated_at = now()
RETURNING *;

-- name: ListCalendarConnections :many
SELECT * FROM calendar_connections
WHERE organization_id = $1 AND workspace_id = $2 AND user_id = $3
  AND disconnected_at IS NULL
ORDER BY provider;

-- name: GetCalendarConnection :one
SELECT * FROM calendar_connections
WHERE organization_id = $1 AND workspace_id = $2 AND user_id = $3 AND provider = $4
  AND disconnected_at IS NULL;

-- name: UpdateCalendarConnectionTokens :exec
UPDATE calendar_connections SET access_token_enc = $5, refresh_token_enc = $6,
  access_token_expires_at = $7, updated_at = now()
WHERE organization_id = $1 AND workspace_id = $2 AND user_id = $3 AND provider = $4
  AND disconnected_at IS NULL;

-- name: UpdateCalendarConnectionSelection :exec
UPDATE calendar_connections SET selected_calendar_ids = $5, updated_at = now()
WHERE organization_id = $1 AND workspace_id = $2 AND user_id = $3 AND provider = $4
  AND disconnected_at IS NULL;

-- name: DisconnectCalendarConnection :execrows
UPDATE calendar_connections SET disconnected_at = now(), updated_at = now()
WHERE organization_id = $1 AND workspace_id = $2 AND user_id = $3 AND provider = $4
  AND disconnected_at IS NULL;
