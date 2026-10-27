-- name: ListTaskPins :many
SELECT * FROM task_pins
WHERE task_pins.organization_id = $1 AND task_pins.workspace_id = $2 AND task_pins.user_id = $3
  AND NOT (task_pins.item_type = 'task' AND EXISTS (
    SELECT 1 FROM tasks t WHERE t.id = task_pins.item_id AND t.trashed_at IS NOT NULL))
  AND NOT (task_pins.item_type = 'project' AND EXISTS (
    SELECT 1 FROM projects p WHERE p.id = task_pins.item_id AND p.trashed_at IS NOT NULL))
ORDER BY task_pins.position ASC, task_pins.created_at ASC;

-- name: CreateTaskPin :one
INSERT INTO task_pins (
  id, organization_id, workspace_id, user_id, item_type, item_id, position
) VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING *;

-- name: DeleteTaskPin :one
DELETE FROM task_pins
WHERE organization_id = $1
  AND workspace_id = $2
  AND user_id = $3
  AND item_type = $4
  AND item_id = $5
RETURNING *;

-- name: UpdateTaskPinPosition :execrows
UPDATE task_pins SET position = $1, updated_at = now()
WHERE id = $2
  AND organization_id = $3
  AND workspace_id = $4
  AND user_id = $5;

-- name: GetMaxTaskPinPosition :one
SELECT COALESCE(MAX(position), 0)::float8 AS max_position
FROM task_pins
WHERE organization_id = $1 AND workspace_id = $2 AND user_id = $3;
