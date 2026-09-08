-- name: ListTaskPins :many
SELECT * FROM task_pins
WHERE organization_id = $1 AND workspace_id = $2 AND user_id = $3
ORDER BY position ASC, created_at ASC;

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
