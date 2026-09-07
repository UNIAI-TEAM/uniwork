-- name: ListTaskStatuses :many
SELECT * FROM task_statuses
WHERE organization_id = $1 AND workspace_id = $2
ORDER BY position, created_at, id;

-- name: GetTaskStatusByKey :one
SELECT * FROM task_statuses
WHERE organization_id = $1 AND workspace_id = $2 AND key = $3;

-- name: CreateTaskStatus :one
INSERT INTO task_statuses (
  id, organization_id, workspace_id, key, name, description, category,
  color, is_system, position, created_by, created_by_kind
) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
RETURNING *;
