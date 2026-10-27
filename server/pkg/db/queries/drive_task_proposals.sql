-- name: CreateDriveTaskProposal :one
INSERT INTO drive_task_proposals (
  id, organization_id, workspace_id, drive_file_id, connection_id,
  requested_by, requested_by_kind, prompt,
  project_id, parent_task_id, context_task_id,
  items, truncated, usage_event_id, status, expires_at
) VALUES (
  sqlc.arg('id'),
  sqlc.arg('organization_id'),
  sqlc.arg('workspace_id'),
  sqlc.arg('drive_file_id'),
  sqlc.arg('connection_id'),
  sqlc.arg('requested_by'),
  COALESCE(NULLIF(sqlc.arg('requested_by_kind')::text, ''), 'human'),
  sqlc.arg('prompt'),
  sqlc.narg('project_id'),
  sqlc.narg('parent_task_id'),
  sqlc.narg('context_task_id'),
  sqlc.arg('items'),
  sqlc.arg('truncated'),
  sqlc.arg('usage_event_id'),
  COALESCE(NULLIF(sqlc.arg('status')::text, ''), 'ready'),
  COALESCE(sqlc.narg('expires_at')::timestamptz, now() + interval '7 days')
)
RETURNING *;

-- name: GetDriveTaskProposalForWorkspace :one
SELECT *
FROM drive_task_proposals
WHERE id = sqlc.arg('id')
  AND workspace_id = sqlc.arg('workspace_id')
  AND (sqlc.arg('organization_id')::text = '' OR organization_id = sqlc.arg('organization_id'));

-- name: LockDriveTaskProposalForUpdate :one
SELECT *
FROM drive_task_proposals
WHERE id = sqlc.arg('id')
  AND workspace_id = sqlc.arg('workspace_id')
  AND (sqlc.arg('organization_id')::text = '' OR organization_id = sqlc.arg('organization_id'))
FOR UPDATE;

-- name: SetDriveTaskProposalStatus :one
UPDATE drive_task_proposals
SET status = sqlc.arg('status'),
    items = NULL,
    status_changed_at = now()
WHERE id = sqlc.arg('id')
  AND workspace_id = sqlc.arg('workspace_id')
  AND (sqlc.arg('organization_id')::text = '' OR organization_id = sqlc.arg('organization_id'))
RETURNING *;

-- name: DiscardReadyDriveTaskProposalsForConnection :many
-- tenant: parent connection_id
UPDATE drive_task_proposals
SET status = 'discarded',
    items = NULL,
    status_changed_at = now()
WHERE connection_id = sqlc.arg('connection_id')
  AND status = 'ready'
RETURNING id, workspace_id, organization_id, requested_by, drive_file_id, connection_id;

-- name: DiscardReadyDriveTaskProposalsForFile :many
-- tenant: parent drive_file_id
UPDATE drive_task_proposals
SET status = 'discarded',
    items = NULL,
    status_changed_at = now()
WHERE drive_file_id = sqlc.arg('drive_file_id')
  AND status = 'ready'
RETURNING id, workspace_id, organization_id, requested_by, drive_file_id, connection_id;

-- name: ListDriveProposalWorkspaceMembers :many
-- Active workspace members (including organization owners and admins who are
-- implicit workspace admins) with display name and email for drive_task_proposals@1
-- and member validation (spec §8.2 steps 3, 5).
SELECT u.id::text AS user_id,
       u.display_name::text AS display_name,
       u.email::text AS email
FROM organization_members om
JOIN users u ON u.id = om.user_id
LEFT JOIN workspace_members wm
  ON wm.workspace_id = sqlc.arg('workspace_id')::text
 AND wm.user_id = om.user_id
WHERE om.organization_id = sqlc.arg('organization_id')::text
  AND om.deactivated_at IS NULL
  AND (wm.user_id IS NOT NULL OR om.role IN ('owner', 'admin'))
ORDER BY lower(u.display_name), u.id;

-- name: ListDriveProposalWorkspaceLabels :many
-- Active non-archived workspace task labels for drive_task_proposals@1 and
-- label validation (spec §8.2 steps 3, 5).
SELECT id, name
FROM task_labels
WHERE organization_id = sqlc.arg('organization_id')
  AND workspace_id = sqlc.arg('workspace_id')
  AND archived_at IS NULL
ORDER BY lower(name) ASC, id ASC;

-- name: ListGrantedDriveFileAccessUserIDs :many
-- Returns user_ids that currently hold a granted drive_file_access row backed
-- by an active Drive connection on drive_file_id (spec §8.2 step 5).
SELECT a.user_id
FROM drive_file_access a
JOIN drive_connections c
  ON c.id = a.connection_id
 AND c.organization_id = a.organization_id
 AND c.user_id = a.user_id
WHERE a.organization_id = sqlc.arg('organization_id')
  AND a.workspace_id = sqlc.arg('workspace_id')
  AND a.drive_file_id = sqlc.arg('drive_file_id')
  AND a.state = 'granted'
  AND c.disconnected_at IS NULL
  AND c.auth_failed_at IS NULL;
