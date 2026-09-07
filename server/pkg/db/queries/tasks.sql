-- name: NextTaskNumber :one
UPDATE workspaces
SET task_counter = task_counter + 1, updated_at = now()
WHERE id = sqlc.arg('workspace_id')
  AND organization_id = sqlc.arg('organization_id')
RETURNING task_counter;

-- name: CreateTask :one
INSERT INTO tasks (
  id, organization_id, workspace_id, number, title, description, priority,
  assignee_id, assignee_kind, assignee_type, due_date, position,
  created_by, created_by_kind, creator_id, creator_type, revision, last_activity_at
) VALUES (
  $1, $2, $3, $4, $5, $6, $7,
  $8, $9, $10, $11, $12,
  $13, $14, $15, $16, $17, $18
)
RETURNING *;

-- name: ListTasksByWorkspace :many
SELECT * FROM tasks
WHERE organization_id = $1 AND workspace_id = $2
ORDER BY status, position, created_at;

-- name: GetTask :one
SELECT * FROM tasks WHERE id = $1;

-- name: GetTaskInWorkspace :one
SELECT * FROM tasks
WHERE id = sqlc.arg('id')
  AND organization_id = sqlc.arg('organization_id')
  AND workspace_id = sqlc.arg('workspace_id');

-- name: UpdateTask :one
UPDATE tasks SET
  title       = COALESCE(sqlc.narg('title'), title),
  description = COALESCE(sqlc.narg('description'), description),
  status      = COALESCE(sqlc.narg('status'), status),
  priority    = COALESCE(sqlc.narg('priority'), priority),
  position    = COALESCE(sqlc.narg('position'), position),
  updated_at  = now(),
  last_activity_at = now()
WHERE id = sqlc.arg('id')
  AND organization_id = sqlc.arg('organization_id')
  AND workspace_id = sqlc.arg('workspace_id')
RETURNING *;

-- name: SetTaskAssignee :one
UPDATE tasks SET
  assignee_id = $2,
  assignee_kind = $3,
  assignee_type = $4,
  updated_at = now(),
  last_activity_at = now()
WHERE id = $1
  AND organization_id = $5
  AND workspace_id = $6
RETURNING *;

-- name: SetTaskDueDate :one
UPDATE tasks SET
  due_date = $2,
  updated_at = now(),
  last_activity_at = now()
WHERE id = $1
  AND organization_id = $3
  AND workspace_id = $4
RETURNING *;

-- name: DeleteTask :exec
DELETE FROM tasks
WHERE id = $1
  AND organization_id = $2
  AND workspace_id = $3;

-- name: MaxTaskPosition :one
SELECT COALESCE(MAX(position), 0)::float8 FROM tasks
WHERE organization_id = $1 AND workspace_id = $2 AND status = $3;

-- name: CreateTaskComment :one
INSERT INTO task_comments (
  id, organization_id, workspace_id, task_id, author_id, author_kind, body, origin, updated_at
) VALUES (
  $1, $2, $3, $4, $5, $6, $7, $8, now()
)
RETURNING *;

-- name: ListTaskComments :many
SELECT c.id, c.task_id, c.author_id, c.author_kind, c.body, c.created_at,
       COALESCE(u.display_name, a.name, '')::text AS display_name,
       COALESCE(u.avatar_url, a.avatar_url) AS avatar_url
FROM task_comments c
LEFT JOIN users u ON c.author_kind = 'human' AND u.id = c.author_id
LEFT JOIN agents a ON c.author_kind = 'agent' AND a.id = c.author_id
WHERE c.task_id = $1
  AND c.organization_id = $2
  AND c.workspace_id = $3
ORDER BY c.created_at;

-- name: CreateWelcomeTask :one
INSERT INTO tasks (
  id, organization_id, workspace_id, number, title, description, status, priority,
  assignee_id, assignee_kind, assignee_type, position,
  created_by, created_by_kind, creator_id, creator_type, kind, revision, last_activity_at
) VALUES (
  $1, $2, $3, $4, $5, $6, 'in_progress', 'high',
  $7, 'human', 'member', $8,
  $9, 'human', $10, $11, 'welcome', $12, $13
)
RETURNING *;

-- name: GetWelcomeTask :one
SELECT * FROM tasks
WHERE organization_id = $1
  AND workspace_id = $2
  AND created_by = $3
  AND kind = 'welcome';
