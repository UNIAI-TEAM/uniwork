-- name: ListTaskProperties :many
SELECT p.*,
  (
    SELECT COUNT(*) FROM tasks t
    WHERE t.organization_id = p.organization_id
      AND t.workspace_id = p.workspace_id
      AND t.properties ? p.id
  )::bigint AS usage_count
FROM task_properties p
WHERE p.organization_id = $1 AND p.workspace_id = $2
  AND (sqlc.arg('include_archived')::bool OR p.archived_at IS NULL)
ORDER BY p.position ASC, LOWER(p.name) ASC, p.id;

-- name: GetTaskPropertyByID :one
SELECT * FROM task_properties
WHERE organization_id = $1 AND workspace_id = $2 AND id = $3;

-- name: CountActiveTaskProperties :one
SELECT COUNT(*)::bigint FROM task_properties
WHERE organization_id = $1 AND workspace_id = $2 AND archived_at IS NULL;

-- name: MaxTaskPropertyPosition :one
SELECT COALESCE(MAX(position), 0)::float8 AS max_position
FROM task_properties
WHERE organization_id = $1 AND workspace_id = $2;

-- name: CreateTaskProperty :one
INSERT INTO task_properties (
  id, organization_id, workspace_id, name, type, description, config,
  position, created_by, created_by_kind
) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
RETURNING *;

-- name: UpdateTaskProperty :one
UPDATE task_properties SET
  name = COALESCE(sqlc.narg('name'), name),
  description = COALESCE(sqlc.narg('description'), description),
  config = COALESCE(sqlc.narg('config'), config),
  archived_at = CASE
    WHEN sqlc.arg('archived_set')::bool THEN sqlc.narg('archived_at')
    ELSE archived_at
  END,
  updated_at = now()
WHERE organization_id = sqlc.arg('organization_id')
  AND workspace_id = sqlc.arg('workspace_id')
  AND id = sqlc.arg('id')
RETURNING *;

-- name: SetTaskPropertyValue :one
UPDATE tasks
SET properties = jsonb_set(properties, ARRAY[sqlc.arg('property_id')::text], sqlc.arg('value')::jsonb, true),
    revision = revision + CASE
      WHEN properties -> sqlc.arg('property_id')::text IS DISTINCT FROM sqlc.arg('value')::jsonb THEN 1
      ELSE 0
    END,
    last_activity_at = CASE
      WHEN properties -> sqlc.arg('property_id')::text IS DISTINCT FROM sqlc.arg('value')::jsonb
      THEN GREATEST(COALESCE(last_activity_at, updated_at), now())
      ELSE last_activity_at
    END,
    updated_at = CASE
      WHEN properties -> sqlc.arg('property_id')::text IS DISTINCT FROM sqlc.arg('value')::jsonb THEN now()
      ELSE updated_at
    END
WHERE id = sqlc.arg('task_id')
  AND organization_id = sqlc.arg('organization_id')
  AND workspace_id = sqlc.arg('workspace_id')
RETURNING *;

-- name: DeleteTaskPropertyValue :one
UPDATE tasks
SET properties = properties - sqlc.arg('property_id')::text,
    revision = revision + CASE WHEN properties ? sqlc.arg('property_id')::text THEN 1 ELSE 0 END,
    last_activity_at = CASE
      WHEN properties ? sqlc.arg('property_id')::text
      THEN GREATEST(COALESCE(last_activity_at, updated_at), now())
      ELSE last_activity_at
    END,
    updated_at = CASE
      WHEN properties ? sqlc.arg('property_id')::text THEN now()
      ELSE updated_at
    END
WHERE id = sqlc.arg('task_id')
  AND organization_id = sqlc.arg('organization_id')
  AND workspace_id = sqlc.arg('workspace_id')
RETURNING *;
