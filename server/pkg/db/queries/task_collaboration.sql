-- Task collaboration: comments thread/resolve, reactions, subscribers.

-- name: GetTaskComment :one
SELECT *
FROM task_comments
WHERE id = $1
  AND organization_id = $2
  AND workspace_id = $3;

-- name: GetTaskCommentByID :one
SELECT *
FROM task_comments
WHERE id = $1;

-- name: CreateTaskCommentThreaded :one
INSERT INTO task_comments (
  id, organization_id, workspace_id, task_id, author_id, author_kind, body, origin,
  parent_comment_id, comment_type, updated_at
) VALUES (
  $1, $2, $3, $4, $5, $6, $7, $8,
  $9, $10, now()
)
RETURNING *;

-- name: UpdateTaskCommentBody :one
UPDATE task_comments
SET body = $4,
    revision = revision + 1,
    updated_at = now()
WHERE id = $1
  AND organization_id = $2
  AND workspace_id = $3
RETURNING *;

-- name: DeleteTaskComment :exec
DELETE FROM task_comments
WHERE id = $1
  AND organization_id = $2
  AND workspace_id = $3;

-- name: ResolveTaskComment :one
UPDATE task_comments
SET resolved_at = now(),
    resolved_by_type = $4,
    resolved_by_id = $5,
    revision = revision + 1,
    updated_at = now()
WHERE id = $1
  AND organization_id = $2
  AND workspace_id = $3
  AND resolved_at IS NULL
RETURNING *;

-- name: UnresolveTaskComment :one
UPDATE task_comments
SET resolved_at = NULL,
    resolved_by_type = NULL,
    resolved_by_id = NULL,
    revision = revision + 1,
    updated_at = now()
WHERE id = $1
  AND organization_id = $2
  AND workspace_id = $3
  AND resolved_at IS NOT NULL
RETURNING *;

-- name: InsertCommentReaction :one
INSERT INTO comment_reactions (
  id, organization_id, workspace_id, comment_id, actor_type, actor_id, emoji
) VALUES (
  $1, $2, $3, $4, $5, $6, $7
)
ON CONFLICT (comment_id, actor_type, actor_id, emoji) DO UPDATE
SET emoji = EXCLUDED.emoji
RETURNING *;

-- name: DeleteCommentReaction :execrows
DELETE FROM comment_reactions
WHERE comment_id = $1
  AND organization_id = $2
  AND workspace_id = $3
  AND actor_type = $4
  AND actor_id = $5
  AND emoji = $6;

-- name: ListCommentReactions :many
SELECT *
FROM comment_reactions
WHERE comment_id = $1
  AND organization_id = $2
  AND workspace_id = $3
ORDER BY created_at;

-- name: InsertTaskReaction :one
INSERT INTO task_reactions (
  id, organization_id, workspace_id, task_id, actor_type, actor_id, emoji
) VALUES (
  $1, $2, $3, $4, $5, $6, $7
)
ON CONFLICT (task_id, actor_type, actor_id, emoji) DO UPDATE
SET emoji = EXCLUDED.emoji
RETURNING *;

-- name: DeleteTaskReaction :execrows
DELETE FROM task_reactions
WHERE task_id = $1
  AND organization_id = $2
  AND workspace_id = $3
  AND actor_type = $4
  AND actor_id = $5
  AND emoji = $6;

-- name: ListTaskReactions :many
SELECT *
FROM task_reactions
WHERE task_id = $1
  AND organization_id = $2
  AND workspace_id = $3
ORDER BY created_at;

-- name: UpsertTaskSubscriber :one
INSERT INTO task_subscribers (
  organization_id, workspace_id, task_id, actor_type, actor_id, reason
) VALUES (
  $1, $2, $3, $4, $5, $6
)
ON CONFLICT (workspace_id, task_id, actor_type, actor_id) DO UPDATE
SET reason = EXCLUDED.reason
RETURNING *;

-- name: DeleteTaskSubscriber :execrows
DELETE FROM task_subscribers
WHERE task_id = $1
  AND organization_id = $2
  AND workspace_id = $3
  AND actor_type = $4
  AND actor_id = $5;

-- name: ListTaskSubscribers :many
SELECT *
FROM task_subscribers
WHERE task_id = $1
  AND organization_id = $2
  AND workspace_id = $3
ORDER BY created_at;

-- name: ListDescendantTaskIDs :many
WITH RECURSIVE tree AS (
  SELECT t.id, t.organization_id, t.workspace_id
  FROM tasks t
  WHERE t.id = sqlc.arg('root_id')
    AND t.organization_id = sqlc.arg('organization_id')
    AND t.workspace_id = sqlc.arg('workspace_id')
  UNION ALL
  SELECT c.id, c.organization_id, c.workspace_id
  FROM tasks c
  INNER JOIN tree p ON c.parent_task_id = p.id
    AND c.organization_id = p.organization_id
    AND c.workspace_id = p.workspace_id
)
SELECT tree.id FROM tree;
