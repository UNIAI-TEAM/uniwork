-- Office offline leases (G5-08s, UNI-1350; decision G5-D1). One row per
-- (device_session_id, document_id); OfficeLeaseService is the only writer
-- besides the revoke helpers it owns (device/session revoke, the outbox
-- consumer, the sweeper and the uniwork-admin org-wide revoke).

-- name: GetOfficeOfflinePolicyEpoch :one
-- No row is epoch 0.
SELECT COALESCE((
  SELECT epoch FROM office_offline_policy WHERE organization_id = sqlc.arg(organization_id)
), 0)::bigint AS epoch;

-- name: BumpOfficeOfflinePolicyEpoch :one
INSERT INTO office_offline_policy (organization_id, epoch, updated_at)
VALUES (sqlc.arg(organization_id), 1, now())
ON CONFLICT (organization_id) DO UPDATE
  SET epoch = office_offline_policy.epoch + 1, updated_at = now()
RETURNING epoch;

-- name: GetOfficeOfflineLeaseForDeviceDocument :one
-- The row a grant or renewal of this device on this document works on,
-- locked so two requests of one device serialize.
SELECT * FROM office_offline_leases
WHERE organization_id = sqlc.arg(organization_id)
  AND device_session_id = sqlc.arg(device_session_id)
  AND document_id = sqlc.arg(document_id)
FOR UPDATE;

-- name: GetOfficeOfflineLeaseByID :one
SELECT * FROM office_offline_leases
WHERE id = sqlc.arg(id) AND organization_id = sqlc.arg(organization_id);

-- name: CountLiveOfficeOfflineLeasesForDevice :one
-- tenant: self
-- The per-device cap (G5-D1 row 11) spans organizations: it counts the
-- caller's own device, other than the document being granted.
SELECT count(*) FROM office_offline_leases
WHERE user_id = sqlc.arg(user_id)
  AND device_session_id = sqlc.arg(device_session_id)
  AND document_id <> sqlc.arg(document_id)
  AND revoked_at IS NULL
  AND expires_at > sqlc.arg(now)::timestamptz;

-- name: InsertOfficeOfflineLease :one
INSERT INTO office_offline_leases (
  id, organization_id, workspace_id, document_id, user_id, device_session_id,
  deployment_id, version_id, version, revision, level, policy_epoch, generation,
  issued_at, expires_at, created_by, created_by_kind
) VALUES (
  sqlc.arg(id), sqlc.arg(organization_id), sqlc.arg(workspace_id), sqlc.arg(document_id),
  sqlc.arg(user_id), sqlc.arg(device_session_id), sqlc.arg(deployment_id), sqlc.arg(version_id),
  sqlc.arg(version), sqlc.arg(revision), sqlc.arg(level), sqlc.arg(policy_epoch), 1,
  sqlc.arg(issued_at), sqlc.arg(expires_at), sqlc.arg(created_by), sqlc.arg(created_by_kind)
)
RETURNING *;

-- name: RenewOfficeOfflineLease :one
-- A renewal rewrites the live row in place: same id, generation + 1, every
-- bound value re-read from the live state by the caller.
UPDATE office_offline_leases SET
  workspace_id = sqlc.arg(workspace_id),
  deployment_id = sqlc.arg(deployment_id),
  version_id = sqlc.arg(version_id),
  version = sqlc.arg(version),
  revision = sqlc.arg(revision),
  level = sqlc.arg(level),
  policy_epoch = sqlc.arg(policy_epoch),
  generation = generation + 1,
  issued_at = sqlc.arg(issued_at),
  expires_at = sqlc.arg(expires_at),
  updated_at = now()
WHERE id = sqlc.arg(id) AND organization_id = sqlc.arg(organization_id) AND revoked_at IS NULL
RETURNING *;

-- name: DeleteOfficeOfflineLease :execrows
-- Release, and the replacement of a dead row by a fresh grant.
DELETE FROM office_offline_leases
WHERE id = sqlc.arg(id) AND organization_id = sqlc.arg(organization_id);

-- name: RevokeOfficeOfflineLeasesForDevice :many
-- tenant: self
-- Device logout / revoke (G5-D1 row 6), in the revoking transaction.
UPDATE office_offline_leases
SET revoked_at = now(), revoke_reason = sqlc.arg(reason)::text, updated_at = now()
WHERE user_id = sqlc.arg(user_id) AND device_session_id = sqlc.arg(device_session_id) AND revoked_at IS NULL
RETURNING id, organization_id, workspace_id, document_id, user_id;

-- name: RevokeOfficeOfflineLeasesForFamily :many
-- tenant: self
-- A family logout / admin device revoke ends every device of the family.
UPDATE office_offline_leases l
SET revoked_at = now(), revoke_reason = sqlc.arg(reason)::text, updated_at = now()
WHERE l.user_id = sqlc.arg(user_id)
  AND l.device_session_id IN (
    SELECT d.id FROM device_sessions d
    WHERE d.user_id = sqlc.arg(user_id) AND d.session_family_id = sqlc.arg(session_family_id)
  )
  AND l.revoked_at IS NULL
RETURNING l.id, l.organization_id, l.workspace_id, l.document_id, l.user_id;

-- name: RevokeOfficeOfflineLeasesForUser :many
-- tenant: self
-- Every lease of the user in every organization (revokeAllUserSessions).
UPDATE office_offline_leases
SET revoked_at = now(), revoke_reason = sqlc.arg(reason)::text, updated_at = now()
WHERE user_id = sqlc.arg(user_id) AND revoked_at IS NULL
RETURNING id, organization_id, workspace_id, document_id, user_id;

-- name: RevokeOfficeOfflineLeasesForUserInOrganization :many
UPDATE office_offline_leases
SET revoked_at = now(), revoke_reason = sqlc.arg(reason)::text, updated_at = now()
WHERE organization_id = sqlc.arg(organization_id) AND user_id = sqlc.arg(user_id) AND revoked_at IS NULL
RETURNING id, organization_id, workspace_id, document_id, user_id;

-- name: RevokeOfficeOfflineLeasesForOrganization :many
-- One batch of an organization-wide revoke (suspension, uniwork-admin).
UPDATE office_offline_leases
SET revoked_at = now(), revoke_reason = sqlc.arg(reason)::text, updated_at = now()
WHERE id IN (
  SELECT l.id FROM office_offline_leases l
  WHERE l.organization_id = sqlc.arg(organization_id) AND l.revoked_at IS NULL
  ORDER BY l.id
  LIMIT sqlc.arg(batch_limit)
)
RETURNING id, organization_id, workspace_id, document_id, user_id;

-- name: RevokeOfficeOfflineLeasesByIDs :many
UPDATE office_offline_leases
SET revoked_at = now(), revoke_reason = sqlc.arg(reason)::text, updated_at = now()
WHERE organization_id = sqlc.arg(organization_id) AND id = ANY(sqlc.arg(ids)::text[]) AND revoked_at IS NULL
RETURNING id, organization_id, workspace_id, document_id, user_id;

-- name: ListLiveOfficeOfflineLeasesForDocument :many
SELECT id, user_id FROM office_offline_leases
WHERE organization_id = sqlc.arg(organization_id) AND document_id = sqlc.arg(document_id) AND revoked_at IS NULL
ORDER BY id;

-- name: ListLiveOfficeOfflineLeasesForUserInWorkspace :many
-- A document may have moved out of the workspace since the grant, so the
-- caller re-checks the live document of every row, not the row's workspace.
SELECT id, document_id FROM office_offline_leases
WHERE workspace_id = sqlc.arg(workspace_id) AND user_id = sqlc.arg(user_id) AND revoked_at IS NULL
ORDER BY id;

-- name: SweepOfficeOfflineLeases :execrows
-- tenant: system
-- The sweeper (G5-D1 row 18): rows expired or revoked before the cutoff.
DELETE FROM office_offline_leases
WHERE id IN (
  SELECT l.id FROM office_offline_leases l
  WHERE l.expires_at < sqlc.arg(cutoff)::timestamptz OR l.revoked_at < sqlc.arg(cutoff)::timestamptz
  LIMIT sqlc.arg(batch_limit)
);

-- name: LockOfficeLeaseDocument :one
-- tenant: by-id
-- A grant reads the ACL under a share lock on the document row, so a
-- concurrent share revoke or move (withDocumentMutation, FOR UPDATE) is
-- either fully visible or waits for the grant to commit and its outbox
-- consumer then sees the new lease.
SELECT * FROM documents WHERE id = sqlc.arg(id) FOR SHARE;

-- name: GetOfficeOfflineLeaseForRelease :one
-- tenant: self
-- Release works on the caller's own row even when the document is gone or
-- no longer readable, so the row is found by user, device and document.
SELECT * FROM office_offline_leases
WHERE user_id = sqlc.arg(user_id)
  AND device_session_id = sqlc.arg(device_session_id)
  AND document_id = sqlc.arg(document_id)
FOR UPDATE;
