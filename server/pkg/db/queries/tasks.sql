-- name: NextTaskNumber :one
UPDATE workspaces
SET task_counter = task_counter + 1, updated_at = now()
WHERE id = sqlc.arg('workspace_id')
  AND organization_id = sqlc.arg('organization_id')
RETURNING task_counter;

-- name: CreateTask :one
INSERT INTO tasks (
  id, organization_id, workspace_id, number, title, description, status, priority,
  assignee_id, assignee_kind, assignee_type, start_date, due_date, start_at, due_at, position,
  created_by, created_by_kind, creator_id, creator_type, revision, last_activity_at,
  origin_type, origin_id, project_id, parent_task_id, stage, properties
) VALUES (
  sqlc.arg('id'), sqlc.arg('organization_id'), sqlc.arg('workspace_id'), sqlc.arg('number'),
  sqlc.arg('title'), sqlc.arg('description'), sqlc.arg('status'), sqlc.arg('priority'),
  sqlc.narg('assignee_id'), sqlc.arg('assignee_kind'), sqlc.narg('assignee_type'),
  sqlc.narg('start_date'), sqlc.narg('due_date'), sqlc.narg('start_at'), sqlc.narg('due_at'),
  sqlc.arg('position'),
  sqlc.arg('created_by'), sqlc.arg('created_by_kind'), sqlc.arg('creator_id'),
  sqlc.arg('creator_type'), sqlc.arg('revision'), sqlc.arg('last_activity_at'),
  sqlc.narg('origin_type'), sqlc.narg('origin_id'), sqlc.narg('project_id'),
  sqlc.narg('parent_task_id'), sqlc.narg('stage'), sqlc.arg('properties')::jsonb
)
RETURNING *;

-- name: ListTasksByWorkspace :many
SELECT * FROM tasks
WHERE organization_id = $1 AND workspace_id = $2
ORDER BY status, position, created_at;

-- name: GetTask :one
-- tenant: by-id
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
  revision    = revision + 1,
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
  revision = revision + 1,
  updated_at = now(),
  last_activity_at = now()
WHERE id = $1
  AND organization_id = $5
  AND workspace_id = $6
RETURNING *;

-- name: SetTaskDueDate :one
UPDATE tasks SET
  due_date = $2,
  revision = revision + 1,
  updated_at = now(),
  last_activity_at = now()
WHERE id = $1
  AND organization_id = $3
  AND workspace_id = $4
RETURNING *;

-- name: SetTaskStartDate :one
UPDATE tasks SET
  start_date = $2,
  revision = revision + 1,
  updated_at = now(),
  last_activity_at = now()
WHERE id = $1
  AND organization_id = $3
  AND workspace_id = $4
RETURNING *;

-- name: SetTaskScheduleTimes :one
UPDATE tasks SET
  start_at = sqlc.narg('start_at'),
  due_at = sqlc.narg('due_at'),
  revision = revision + 1,
  updated_at = now(),
  last_activity_at = now()
WHERE id = sqlc.arg('id')
  AND organization_id = sqlc.arg('organization_id')
  AND workspace_id = sqlc.arg('workspace_id')
RETURNING *;

-- name: SetTaskProjectID :one
UPDATE tasks SET
  project_id = $2,
  revision = revision + 1,
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

-- name: MinTaskPosition :one
SELECT COALESCE(MIN(position), 0)::float8 FROM tasks
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
       c.parent_comment_id, c.comment_type, c.revision, c.updated_at,
       c.resolved_at, c.resolved_by_type, c.resolved_by_id,
       COALESCE(u.display_name, a.name, '')::text AS display_name,
       COALESCE(u.avatar_url, a.avatar_url) AS avatar_url,
       u.avatar_file_id
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

-- name: QueryTasks :many
SELECT * FROM tasks
WHERE tasks.organization_id = sqlc.arg('organization_id')
  AND tasks.workspace_id = sqlc.arg('workspace_id')
  AND (sqlc.narg('status')::text IS NULL OR status = sqlc.narg('status'))
  AND (sqlc.narg('project_id')::text IS NULL OR project_id = sqlc.narg('project_id'))
  AND (sqlc.narg('assignee_id')::text IS NULL OR assignee_id = sqlc.narg('assignee_id'))
  AND (sqlc.narg('priority')::text IS NULL OR priority = sqlc.narg('priority'))
  AND (sqlc.narg('due_from')::date IS NULL OR due_date >= sqlc.narg('due_from'))
  AND (sqlc.narg('due_to')::date IS NULL OR due_date <= sqlc.narg('due_to'))
  AND (sqlc.narg('overdue_before')::date IS NULL OR (due_date < sqlc.narg('overdue_before') AND NOT EXISTS (
    SELECT 1 FROM task_statuses s WHERE s.organization_id = tasks.organization_id
      AND s.workspace_id = tasks.workspace_id AND s.key = tasks.status AND s.category IN ('done','cancelled'))))
ORDER BY status, position, created_at
LIMIT sqlc.arg('limit_n') OFFSET sqlc.arg('offset_n');

-- name: CountTasks :one
SELECT count(*)::bigint FROM tasks
WHERE tasks.organization_id = sqlc.arg('organization_id')
  AND tasks.workspace_id = sqlc.arg('workspace_id')
  AND (sqlc.narg('status')::text IS NULL OR status = sqlc.narg('status'))
  AND (sqlc.narg('project_id')::text IS NULL OR project_id = sqlc.narg('project_id'))
  AND (sqlc.narg('assignee_id')::text IS NULL OR assignee_id = sqlc.narg('assignee_id'))
  AND (sqlc.narg('priority')::text IS NULL OR priority = sqlc.narg('priority'))
  AND (sqlc.narg('due_from')::date IS NULL OR due_date >= sqlc.narg('due_from'))
  AND (sqlc.narg('due_to')::date IS NULL OR due_date <= sqlc.narg('due_to'))
  AND (sqlc.narg('overdue_before')::date IS NULL OR (due_date < sqlc.narg('overdue_before') AND NOT EXISTS (
    SELECT 1 FROM task_statuses s WHERE s.organization_id = tasks.organization_id
      AND s.workspace_id = tasks.workspace_id AND s.key = tasks.status AND s.category IN ('done','cancelled'))));

-- name: CountOpenTasksByAssignee :many
-- Open (not done/cancelled) tasks per assignee; overdue = due before today.
SELECT assignee_id::text AS assignee_id,
       count(*)::bigint AS open_count,
       (count(*) FILTER (WHERE due_date < sqlc.arg('today')::date))::bigint AS overdue_count
FROM tasks
WHERE tasks.organization_id = sqlc.arg('organization_id')
  AND tasks.workspace_id = sqlc.arg('workspace_id')
  AND assignee_id IS NOT NULL AND assignee_id <> ''
  AND NOT EXISTS (
    SELECT 1 FROM task_statuses s WHERE s.organization_id = tasks.organization_id
      AND s.workspace_id = tasks.workspace_id AND s.key = tasks.status AND s.category IN ('done','cancelled'))
GROUP BY assignee_id
ORDER BY overdue_count DESC, open_count DESC, assignee_id
LIMIT 200;

-- name: ListTasksByIdentifier :many
-- tenant: by-id
-- Prefix compare is case-insensitive so ALP-1 and alp-1 resolve the same.
-- current_match tells a workspace's current prefix from an old one it keeps,
-- so the caller can prefer the current owner of a reused prefix.
SELECT sqlc.embed(t), (upper(w.task_prefix) = upper(sqlc.arg('prefix')))::bool AS current_match
FROM tasks t
INNER JOIN workspaces w
  ON w.id = t.workspace_id AND w.organization_id = t.organization_id
WHERE (
    upper(w.task_prefix) = upper(sqlc.arg('prefix'))
    -- An old prefix the workspace keeps (spec 2026-10-14 §5.3).
    OR EXISTS (
      SELECT 1 FROM workspace_aliases a
      WHERE a.workspace_id = w.id AND a.organization_id = w.organization_id
        AND a.kind = 'task_prefix' AND upper(a.value) = upper(sqlc.arg('prefix'))
    )
  )
  AND t.number = sqlc.arg('number');

-- name: GetTaskInWorkspaceByIdentifier :one
-- A PREFIX-N reference read inside one workspace. Prefixes are three letters
-- of the slug and numbers count per workspace, so across workspaces the same
-- reference can name several tasks; here it names at most one.
SELECT t.* FROM tasks t
INNER JOIN workspaces w
  ON w.id = t.workspace_id AND w.organization_id = t.organization_id
WHERE t.organization_id = sqlc.arg('organization_id')
  AND t.workspace_id = sqlc.arg('workspace_id')
  AND upper(w.task_prefix) = upper(sqlc.arg('prefix'))
  AND t.number = sqlc.arg('number');

-- name: ListMyTasks :many
-- Actor's tasks filtered by relation (all|assigned|created|involved).
-- relation NULL/'all' → assignee OR created_by; 'involved' → empty until agent links exist.
SELECT * FROM tasks
WHERE organization_id = sqlc.arg('organization_id')
  AND workspace_id = sqlc.arg('workspace_id')
  AND (
    (
      (sqlc.narg('relation')::text IS NULL OR sqlc.narg('relation')::text IN ('', 'all'))
      AND (assignee_id = sqlc.arg('actor_id') OR created_by = sqlc.arg('actor_id'))
    )
    OR (sqlc.narg('relation')::text = 'assigned' AND assignee_id = sqlc.arg('actor_id'))
    OR (sqlc.narg('relation')::text = 'created' AND created_by = sqlc.arg('actor_id'))
    OR (sqlc.narg('relation')::text = 'involved' AND FALSE)
  )
  AND (sqlc.narg('status')::text IS NULL OR status = sqlc.narg('status'))
ORDER BY status, position, created_at
LIMIT sqlc.arg('limit_n') OFFSET sqlc.arg('offset_n');

-- name: CountMyTasks :one
SELECT count(*)::bigint FROM tasks
WHERE organization_id = sqlc.arg('organization_id')
  AND workspace_id = sqlc.arg('workspace_id')
  AND (
    (
      (sqlc.narg('relation')::text IS NULL OR sqlc.narg('relation')::text IN ('', 'all'))
      AND (assignee_id = sqlc.arg('actor_id') OR created_by = sqlc.arg('actor_id'))
    )
    OR (sqlc.narg('relation')::text = 'assigned' AND assignee_id = sqlc.arg('actor_id'))
    OR (sqlc.narg('relation')::text = 'created' AND created_by = sqlc.arg('actor_id'))
    OR (sqlc.narg('relation')::text = 'involved' AND FALSE)
  )
  AND (sqlc.narg('status')::text IS NULL OR status = sqlc.narg('status'));

-- name: ListChildTasks :many
SELECT * FROM tasks
WHERE organization_id = sqlc.arg('organization_id')
  AND workspace_id = sqlc.arg('workspace_id')
  AND parent_task_id = sqlc.arg('parent_task_id')
ORDER BY number ASC;

-- name: ListChildrenByParents :many
SELECT * FROM tasks
WHERE organization_id = sqlc.arg('organization_id')
  AND workspace_id = sqlc.arg('workspace_id')
  AND parent_task_id = ANY(sqlc.arg('parent_ids')::text[])
ORDER BY parent_task_id, number ASC;

-- name: ChildTaskProgress :many
SELECT parent_task_id,
       COUNT(*)::bigint AS total,
       COUNT(*) FILTER (WHERE status IN ('done', 'cancelled'))::bigint AS done
FROM tasks
WHERE organization_id = sqlc.arg('organization_id')
  AND workspace_id = sqlc.arg('workspace_id')
  AND parent_task_id IS NOT NULL
GROUP BY parent_task_id;

-- name: SetTaskParent :one
UPDATE tasks SET
  parent_task_id = sqlc.narg('parent_task_id'),
  revision = revision + 1,
  updated_at = now(),
  last_activity_at = now()
WHERE id = sqlc.arg('id')
  AND organization_id = sqlc.arg('organization_id')
  AND workspace_id = sqlc.arg('workspace_id')
RETURNING *;

-- name: CreateTaskDependency :one
INSERT INTO task_dependencies (
  id, organization_id, workspace_id, task_id, depends_on_task_id, type
) VALUES (
  $1, $2, $3, $4, $5, $6
)
RETURNING *;

-- name: DeleteTaskDependency :execrows
DELETE FROM task_dependencies
WHERE organization_id = sqlc.arg('organization_id')
  AND workspace_id = sqlc.arg('workspace_id')
  AND task_id = sqlc.arg('task_id')
  AND depends_on_task_id = sqlc.arg('depends_on_task_id')
  AND (sqlc.narg('type')::text IS NULL OR type = sqlc.narg('type'));

-- name: ListTaskDependenciesInWorkspace :many
SELECT * FROM task_dependencies
WHERE organization_id = sqlc.arg('organization_id')
  AND workspace_id = sqlc.arg('workspace_id');

-- name: LockTaskDuplicateKey :exec
SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0));

-- name: FindActiveDuplicateTask :one
SELECT t.* FROM tasks t
LEFT JOIN task_statuses ts ON ts.workspace_id = t.workspace_id AND ts.key = t.status
WHERE t.organization_id = sqlc.arg('organization_id')
  AND t.workspace_id = sqlc.arg('workspace_id')
  AND COALESCE(ts.category, t.status) NOT IN ('done', 'cancelled')
  AND t.project_id IS NOT DISTINCT FROM sqlc.narg('project_id')
  AND t.parent_task_id IS NOT DISTINCT FROM sqlc.narg('parent_task_id')
  AND lower(btrim(regexp_replace(t.title, '[[:space:]]+', ' ', 'g'))) = sqlc.arg('normalized_title')
ORDER BY t.created_at ASC
LIMIT 1;

-- name: ListAssigneeFrequency :many
-- How often the caller put each assignee on a task in this workspace since
-- @since: task.created rows that carry an assignee plus task.updated rows that
-- changed assignee_id (audit.Diff keeps only changed fields). An id with a
-- workspace_agent_members row is an agent; ids are ULIDs, so they never clash.
SELECT
  f.assignee_id::text AS assignee_id,
  (CASE WHEN wam.agent_id IS NULL THEN 'human' ELSE 'agent' END)::text AS assignee_kind,
  f.frequency::bigint AS frequency
FROM (
  SELECT a.changes::jsonb -> 'assignee_id' ->> 'to' AS assignee_id, COUNT(*) AS frequency
  FROM audit_events a
  WHERE a.organization_id = sqlc.arg('organization_id')::text
    AND a.workspace_id = sqlc.arg('workspace_id')::text
    AND a.actor_kind = 'human'
    AND a.actor_id = sqlc.arg('actor_id')::text
    AND a.action IN ('task.created', 'task.updated')
    AND a.occurred_at >= sqlc.arg('since')::timestamptz
    AND a.changes::jsonb -> 'assignee_id' ->> 'to' IS NOT NULL
  GROUP BY 1
) f
LEFT JOIN workspace_agent_members wam
  ON wam.workspace_id = sqlc.arg('workspace_id')::text AND wam.agent_id = f.assignee_id
ORDER BY f.frequency DESC, f.assignee_id
LIMIT 200;
