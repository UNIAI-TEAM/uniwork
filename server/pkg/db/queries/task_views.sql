-- name: CreateTaskView :one
INSERT INTO task_views (
  id, organization_id, workspace_id, owner_id, name, scope_type, scope_id, scope_variant,
  visibility, definition_version, query, display
) VALUES (
  $1, $2, $3, $4, $5, $6, $7, $8,
  $9, $10, $11, $12
)
RETURNING *;

-- name: ListTaskViewsForUser :many
SELECT * FROM task_views
WHERE organization_id = $1
  AND workspace_id = $2
  AND scope_type = $3
  AND scope_id IS NOT DISTINCT FROM sqlc.narg('scope_id')
  AND (owner_id = $4 OR visibility = 'workspace')
ORDER BY created_at ASC
LIMIT 200;

-- name: CountTaskViewsByOwner :one
SELECT COUNT(*) FROM task_views
WHERE organization_id = $1 AND workspace_id = $2 AND owner_id = $3;

-- name: GetTaskView :one
SELECT * FROM task_views
WHERE id = $1 AND organization_id = $2 AND workspace_id = $3;

-- name: UpdateTaskView :one
UPDATE task_views SET
  name = $4,
  visibility = $5,
  scope_variant = $6,
  query = $7,
  display = $8,
  revision = revision + 1,
  updated_at = now()
WHERE id = $1
  AND organization_id = $2
  AND workspace_id = $3
  AND revision = $9
RETURNING *;

-- name: DeleteTaskView :one
WITH deleted AS (
  DELETE FROM task_views
  WHERE task_views.id = $1
    AND task_views.organization_id = $2
    AND task_views.workspace_id = $3
  RETURNING task_views.id
),
swept_pins AS (
  DELETE FROM task_pins
  WHERE task_pins.item_type = 'task_view'
    AND task_pins.organization_id = $2
    AND task_pins.workspace_id = $3
    AND task_pins.item_id IN (SELECT deleted.id FROM deleted)
)
SELECT deleted.id FROM deleted;

-- name: GetTaskViewPreference :one
SELECT * FROM task_view_preferences
WHERE organization_id = $1
  AND workspace_id = $2
  AND user_id = $3
  AND scope_type = $4
  AND scope_id = $5;

-- name: UpsertTaskViewPreference :one
INSERT INTO task_view_preferences (
  organization_id, workspace_id, user_id, scope_type, scope_id, prefs
) VALUES ($1, $2, $3, $4, $5, $6)
ON CONFLICT (workspace_id, user_id, scope_type, scope_id)
DO UPDATE SET
  prefs = EXCLUDED.prefs,
  organization_id = EXCLUDED.organization_id,
  updated_at = now()
RETURNING *;
