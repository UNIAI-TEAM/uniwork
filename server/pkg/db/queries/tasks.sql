-- name: CreateTask :one
INSERT INTO tasks (id, workspace_id, title, description, priority, assignee_id, due_date, position, created_by)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
RETURNING *;

-- name: ListTasksByWorkspace :many
SELECT * FROM tasks WHERE workspace_id = $1 ORDER BY status, position, created_at;

-- name: GetTask :one
SELECT * FROM tasks WHERE id = $1;

-- name: UpdateTask :one
UPDATE tasks SET
  title       = COALESCE(sqlc.narg('title'), title),
  description = COALESCE(sqlc.narg('description'), description),
  status      = COALESCE(sqlc.narg('status'), status),
  priority    = COALESCE(sqlc.narg('priority'), priority),
  position    = COALESCE(sqlc.narg('position'), position),
  updated_at  = now()
WHERE id = sqlc.arg('id')
RETURNING *;

-- name: SetTaskAssignee :one
UPDATE tasks SET assignee_id = $2, updated_at = now() WHERE id = $1 RETURNING *;

-- name: SetTaskDueDate :one
UPDATE tasks SET due_date = $2, updated_at = now() WHERE id = $1 RETURNING *;

-- name: DeleteTask :exec
DELETE FROM tasks WHERE id = $1;

-- name: MaxTaskPosition :one
SELECT COALESCE(MAX(position), 0)::float8 FROM tasks WHERE workspace_id = $1 AND status = $2;

-- name: CreateTaskComment :one
INSERT INTO task_comments (id, task_id, author_id, body)
VALUES ($1, $2, $3, $4)
RETURNING *;

-- name: ListTaskComments :many
SELECT c.id, c.task_id, c.author_id, c.body, c.created_at, u.display_name, u.avatar_url
FROM task_comments c JOIN users u ON u.id = c.author_id
WHERE c.task_id = $1 ORDER BY c.created_at;

-- name: CreateWelcomeTask :one
INSERT INTO tasks (id, workspace_id, title, description, status, priority, assignee_id, position, created_by, kind)
VALUES ($1, $2, $3, $4, 'in_progress', 'high', $5, $6, $5, 'welcome')
RETURNING *;

-- name: GetWelcomeTask :one
SELECT * FROM tasks WHERE workspace_id = $1 AND created_by = $2 AND kind = 'welcome';
