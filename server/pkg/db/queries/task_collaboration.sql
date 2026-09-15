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

-- name: GetTaskCommentByChatMessageID :one
SELECT *
FROM task_comments
WHERE chat_message_id = $1;

-- name: CreateTaskCommentThreaded :one
INSERT INTO task_comments (
  id, organization_id, workspace_id, task_id, author_id, author_kind, body, origin,
  parent_comment_id, comment_type, chat_message_id, updated_at
) VALUES (
  $1, $2, $3, $4, $5, $6, $7, $8,
  $9, $10, sqlc.narg(chat_message_id), now()
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
ON CONFLICT (comment_id, actor_type, actor_id, emoji) DO NOTHING
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

-- name: ListTaskCommentReactions :many
SELECT r.*
FROM comment_reactions r
JOIN task_comments c ON c.id = r.comment_id
WHERE c.task_id = $1
  AND r.organization_id = $2
  AND r.workspace_id = $3
ORDER BY r.created_at;

-- name: InsertTaskReaction :one
INSERT INTO task_reactions (
  id, organization_id, workspace_id, task_id, actor_type, actor_id, emoji
) VALUES (
  $1, $2, $3, $4, $5, $6, $7
)
ON CONFLICT (task_id, actor_type, actor_id, emoji) DO NOTHING
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

-- name: SubscribeToTaskExplicitly :execrows
INSERT INTO task_subscribers (
  organization_id, workspace_id, task_id, actor_type, actor_id, reason
) VALUES (
  $1, $2, $3, $4, $5, $6
)
ON CONFLICT (workspace_id, task_id, actor_type, actor_id) DO UPDATE
SET reason = EXCLUDED.reason,
    unsubscribed_at = NULL,
    opt_out_scope = NULL
WHERE task_subscribers.reason <> EXCLUDED.reason
   OR task_subscribers.unsubscribed_at IS NOT NULL;

-- name: AutoSubscribeTaskActor :execrows
WITH RECURSIVE ancestors AS (
  SELECT t.id, t.parent_task_id, 0 AS depth
  FROM tasks t
  WHERE t.id = sqlc.arg('task_id')
    AND t.organization_id = sqlc.arg('organization_id')
    AND t.workspace_id = sqlc.arg('workspace_id')
  UNION ALL
  SELECT parent.id, parent.parent_task_id, child.depth + 1
  FROM tasks parent
  INNER JOIN ancestors child ON child.parent_task_id = parent.id
  WHERE parent.organization_id = sqlc.arg('organization_id')
    AND parent.workspace_id = sqlc.arg('workspace_id')
)
INSERT INTO task_subscribers (
  organization_id, workspace_id, task_id, actor_type, actor_id, reason
)
SELECT
  sqlc.arg('organization_id'), sqlc.arg('workspace_id'), sqlc.arg('task_id'),
  sqlc.arg('actor_type'), sqlc.arg('actor_id'), sqlc.arg('reason')
WHERE NOT EXISTS (
  SELECT 1
  FROM task_subscribers subscriber
  INNER JOIN ancestors ON ancestors.id = subscriber.task_id
  WHERE subscriber.organization_id = sqlc.arg('organization_id')
    AND subscriber.workspace_id = sqlc.arg('workspace_id')
    AND subscriber.actor_type = sqlc.arg('actor_type')
    AND subscriber.actor_id = sqlc.arg('actor_id')
    AND subscriber.unsubscribed_at IS NOT NULL
    AND (ancestors.depth = 0 OR subscriber.opt_out_scope = 'subtree')
)
ON CONFLICT (workspace_id, task_id, actor_type, actor_id) DO NOTHING;

-- name: OptOutTaskSubscriber :execrows
INSERT INTO task_subscribers (
  organization_id, workspace_id, task_id, actor_type, actor_id, reason,
  unsubscribed_at, opt_out_scope
) VALUES (
  $1, $2, $3, $4, $5, 'manual', now(), $6
)
ON CONFLICT (workspace_id, task_id, actor_type, actor_id) DO UPDATE
SET unsubscribed_at = now(),
    opt_out_scope = CASE
      WHEN task_subscribers.opt_out_scope = 'subtree'
        OR EXCLUDED.opt_out_scope = 'subtree' THEN 'subtree'
      ELSE 'task'
    END
WHERE task_subscribers.unsubscribed_at IS NULL
   OR (
     task_subscribers.opt_out_scope IS DISTINCT FROM 'subtree'
     AND EXCLUDED.opt_out_scope = 'subtree'
   );

-- name: ListTaskSubscribers :many
WITH RECURSIVE ancestors AS (
  SELECT parent.id, parent.parent_task_id
  FROM tasks child
  INNER JOIN tasks parent ON parent.id = child.parent_task_id
  WHERE child.id = sqlc.arg('task_id')
    AND child.organization_id = sqlc.arg('organization_id')
    AND child.workspace_id = sqlc.arg('workspace_id')
    AND parent.organization_id = sqlc.arg('organization_id')
    AND parent.workspace_id = sqlc.arg('workspace_id')
  UNION ALL
  SELECT parent.id, parent.parent_task_id
  FROM tasks parent
  INNER JOIN ancestors child ON child.parent_task_id = parent.id
  WHERE parent.organization_id = sqlc.arg('organization_id')
    AND parent.workspace_id = sqlc.arg('workspace_id')
)
SELECT subscriber.*
FROM task_subscribers subscriber
WHERE subscriber.task_id = sqlc.arg('task_id')
  AND subscriber.organization_id = sqlc.arg('organization_id')
  AND subscriber.workspace_id = sqlc.arg('workspace_id')
  AND subscriber.unsubscribed_at IS NULL
  AND (
    subscriber.reason = 'manual'
    OR NOT EXISTS (
      SELECT 1
      FROM task_subscribers opt_out
      INNER JOIN ancestors ON ancestors.id = opt_out.task_id
      WHERE opt_out.organization_id = sqlc.arg('organization_id')
        AND opt_out.workspace_id = sqlc.arg('workspace_id')
        AND opt_out.actor_type = subscriber.actor_type
        AND opt_out.actor_id = subscriber.actor_id
        AND opt_out.unsubscribed_at IS NOT NULL
        AND opt_out.opt_out_scope = 'subtree'
    )
  )
ORDER BY subscriber.created_at;

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
