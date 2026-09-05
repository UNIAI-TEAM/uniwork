-- name: CreateTask :one
INSERT INTO tasks (id, workspace_id, title, description, priority, assignee_id, assignee_kind, due_date, position, created_by, created_by_kind)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
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
UPDATE tasks SET assignee_id = $2, assignee_kind = $3, updated_at = now() WHERE id = $1 RETURNING *;

-- name: SetTaskDueDate :one
UPDATE tasks SET due_date = $2, updated_at = now() WHERE id = $1 RETURNING *;

-- name: DeleteTask :exec
DELETE FROM tasks WHERE id = $1;

-- name: MaxTaskPosition :one
SELECT COALESCE(MAX(position), 0)::float8 FROM tasks WHERE workspace_id = $1 AND status = $2;

-- name: CreateTaskComment :one
INSERT INTO task_comments (id, task_id, author_id, author_kind, body, origin)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING *;

-- name: ListTaskComments :many
SELECT c.id, c.task_id, c.author_id, c.author_kind, c.body, c.created_at,
       COALESCE(u.display_name, a.name, '')::text AS display_name,
       COALESCE(u.avatar_url, a.avatar_url) AS avatar_url
FROM task_comments c
LEFT JOIN users u ON c.author_kind = 'human' AND u.id = c.author_id
LEFT JOIN agents a ON c.author_kind = 'agent' AND a.id = c.author_id
WHERE c.task_id = $1 ORDER BY c.created_at;

-- name: CreateWelcomeTask :one
INSERT INTO tasks (id, workspace_id, title, description, status, priority, assignee_id, position, created_by, kind)
VALUES ($1, $2, $3, $4, 'in_progress', 'high', $5, $6, $5, 'welcome')
RETURNING *;

-- name: GetWelcomeTask :one
SELECT * FROM tasks WHERE workspace_id = $1 AND created_by = $2 AND kind = 'welcome';
