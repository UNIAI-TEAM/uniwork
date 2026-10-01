-- Office launch sessions (G4-05b). Ticket values are never stored; only a
-- cryptographic digest is persisted.

-- name: InsertOfficeLaunchSession :one
INSERT INTO office_launch_sessions (
  id, ticket_hash, account_id, organization_id, workspace_id, document_id,
  operation, version, client_id, deployment_id, expires_at, created_by,
  created_by_kind
) VALUES (
  sqlc.arg(id), sqlc.arg(ticket_hash), sqlc.arg(account_id),
  sqlc.arg(organization_id), sqlc.arg(workspace_id), sqlc.arg(document_id),
  sqlc.arg(operation), sqlc.arg(version), sqlc.arg(client_id),
  sqlc.arg(deployment_id), sqlc.arg(expires_at), sqlc.arg(created_by),
  sqlc.arg(created_by_kind)
)
RETURNING *;

-- name: GetOfficeLaunchSessionByHash :one
SELECT * FROM office_launch_sessions
WHERE ticket_hash = sqlc.arg(ticket_hash);

-- name: GetOfficeLaunchSessionByID :one
SELECT * FROM office_launch_sessions
WHERE id = sqlc.arg(id);

-- name: RedeemOfficeLaunchSession :one
UPDATE office_launch_sessions
SET device_session_id = sqlc.arg(device_session_id), redeemed_at = now()
WHERE ticket_hash = sqlc.arg(ticket_hash)
  AND account_id = sqlc.arg(account_id)
  AND organization_id = sqlc.arg(organization_id)
  AND workspace_id = sqlc.arg(workspace_id)
  AND document_id = sqlc.arg(document_id)
  AND client_id = sqlc.arg(client_id)
  AND deployment_id = sqlc.arg(deployment_id)
  AND redeemed_at IS NULL
  AND revoked_at IS NULL
  AND expires_at > now() - INTERVAL '30 seconds'
RETURNING *;

-- name: RevokeOfficeLaunchSession :execrows
UPDATE office_launch_sessions
SET revoked_at = COALESCE(revoked_at, now())
WHERE id = sqlc.arg(id)
  AND account_id = sqlc.arg(account_id)
  AND organization_id = sqlc.arg(organization_id)
  AND workspace_id = sqlc.arg(workspace_id)
  AND revoked_at IS NULL
  AND redeemed_at IS NULL;

-- name: DeleteExpiredOfficeLaunchSessions :execrows
DELETE FROM office_launch_sessions
WHERE organization_id = sqlc.arg(organization_id)
  AND workspace_id = sqlc.arg(workspace_id)
  AND (
    expires_at < now() - INTERVAL '24 hours'
    OR revoked_at < now() - INTERVAL '24 hours'
    OR redeemed_at < now() - INTERVAL '24 hours'
  );
