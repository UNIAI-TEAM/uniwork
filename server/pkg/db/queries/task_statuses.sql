-- name: ListTaskStatuses :many
SELECT * FROM task_statuses
WHERE organization_id = $1 AND workspace_id = $2
  AND (sqlc.arg('include_archived')::bool OR archived_at IS NULL)
ORDER BY position, created_at, id;

-- name: GetTaskStatusByKey :one
SELECT * FROM task_statuses
WHERE organization_id = $1 AND workspace_id = $2 AND key = $3;

-- name: GetTaskStatusByID :one
SELECT * FROM task_statuses
WHERE organization_id = $1 AND workspace_id = $2 AND id = $3;

-- name: CreateTaskStatus :one
INSERT INTO task_statuses (
  id, organization_id, workspace_id, key, name, description, category,
  color, is_system, position, created_by, created_by_kind
) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
RETURNING *;

-- name: MaxTaskStatusPositionInCategory :one
SELECT COALESCE(MAX(position), -1)::float8 AS max_position
FROM task_statuses
WHERE organization_id = $1 AND workspace_id = $2 AND category = $3
  AND archived_at IS NULL;

-- name: UpdateTaskStatus :one
UPDATE task_statuses SET
  name = COALESCE(sqlc.narg('name'), name),
  description = COALESCE(sqlc.narg('description'), description),
  color = COALESCE(sqlc.narg('color'), color),
  position = COALESCE(sqlc.narg('position'), position),
  updated_at = now()
WHERE organization_id = sqlc.arg('organization_id')
  AND workspace_id = sqlc.arg('workspace_id')
  AND id = sqlc.arg('id')
  AND is_system = FALSE
  AND archived_at IS NULL
RETURNING *;

-- name: ArchiveTaskStatus :one
UPDATE task_statuses SET
  archived_at = now(),
  updated_at = now()
WHERE organization_id = $1 AND workspace_id = $2 AND id = $3
  AND is_system = FALSE
  AND archived_at IS NULL
RETURNING *;

-- name: ListActiveCustomTaskStatusesInCategory :many
SELECT * FROM task_statuses
WHERE organization_id = $1 AND workspace_id = $2 AND category = $3
  AND is_system = FALSE
  AND archived_at IS NULL
ORDER BY position, key;
