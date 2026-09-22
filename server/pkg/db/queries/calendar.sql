-- name: ListCalendarTasksInRange :many
SELECT id, title, status, priority, project_id, start_date, due_date, assignee_id, assignee_kind
FROM tasks
WHERE organization_id = sqlc.arg('organization_id')
  AND workspace_id = sqlc.arg('workspace_id')
  AND due_date IS NOT NULL
  AND due_date >= sqlc.arg('from_date')::date
  AND COALESCE(start_date, due_date) <= sqlc.arg('to_date')::date
  AND (
    sqlc.arg('mine')::bool = false
    OR (assignee_kind = 'human' AND assignee_id = sqlc.arg('user_id'))
  );

-- name: ListCalendarMeetingsInRange :many
SELECT m.id, m.title, m.status, m.starts_at, m.ends_at
FROM meetings m
WHERE m.workspace_id = sqlc.arg('workspace_id')
  AND m.status <> 'CANCELED'
  AND m.starts_at < sqlc.arg('to_at')::timestamptz
  AND m.ends_at > sqlc.arg('from_at')::timestamptz
  AND (
    sqlc.arg('mine')::bool = false
    OR m.host_user_id = sqlc.arg('user_id')
    OR EXISTS (
      SELECT 1 FROM meeting_participants p
      WHERE p.meeting_id = m.id
        AND p.user_id = sqlc.arg('user_id')
        AND p.removed_at IS NULL
    )
  );

-- name: ListCalendarSidebarPriorities :many
SELECT t.id, t.title, t.status, t.priority, t.due_date
FROM tasks t
LEFT JOIN task_statuses ts ON ts.workspace_id = t.workspace_id AND ts.key = t.status
WHERE t.organization_id = sqlc.arg('organization_id')
  AND t.workspace_id = sqlc.arg('workspace_id')
  AND t.priority IN ('urgent', 'high')
  AND COALESCE(ts.category, t.status) NOT IN ('done', 'cancelled')
ORDER BY
  CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 ELSE 2 END,
  t.due_date NULLS LAST,
  t.created_at,
  t.id
LIMIT sqlc.arg('limit_n');

-- name: ListCalendarSidebarMeetWith :many
SELECT m.id, m.title, m.starts_at, m.ends_at
FROM meetings m
WHERE m.workspace_id = sqlc.arg('workspace_id')
  AND m.status <> 'CANCELED'
  AND m.starts_at >= sqlc.arg('from_at')::timestamptz
ORDER BY m.starts_at ASC, m.id
LIMIT sqlc.arg('limit_n');

-- name: ListCalendarSidebarAssigned :many
SELECT t.id, t.title, t.status, t.priority, t.due_date
FROM tasks t
LEFT JOIN task_statuses ts ON ts.workspace_id = t.workspace_id AND ts.key = t.status
WHERE t.organization_id = sqlc.arg('organization_id')
  AND t.workspace_id = sqlc.arg('workspace_id')
  AND t.assignee_kind = 'human'
  AND t.assignee_id = sqlc.arg('user_id')
  AND COALESCE(ts.category, t.status) NOT IN ('done', 'cancelled')
ORDER BY
  CASE
    WHEN t.due_date IS NULL THEN 3
    WHEN t.due_date < sqlc.arg('today')::date THEN 0
    WHEN t.due_date = sqlc.arg('today')::date THEN 1
    ELSE 2
  END,
  t.due_date NULLS LAST,
  CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END,
  t.created_at,
  t.id
LIMIT sqlc.arg('limit_n');

-- name: ListCalendarSidebarTodayOverdue :many
SELECT t.id, t.title, t.status, t.priority, t.due_date
FROM tasks t
LEFT JOIN task_statuses ts ON ts.workspace_id = t.workspace_id AND ts.key = t.status
WHERE t.organization_id = sqlc.arg('organization_id')
  AND t.workspace_id = sqlc.arg('workspace_id')
  AND t.due_date IS NOT NULL
  AND t.due_date <= sqlc.arg('today')::date
  AND COALESCE(ts.category, t.status) NOT IN ('done', 'cancelled')
ORDER BY t.due_date, t.created_at, t.id
LIMIT sqlc.arg('limit_n');

-- name: ListCalendarSidebarBacklog :many
SELECT t.id, t.title, t.status, t.priority, t.due_date
FROM tasks t
LEFT JOIN task_statuses ts ON ts.workspace_id = t.workspace_id AND ts.key = t.status
WHERE t.organization_id = sqlc.arg('organization_id')
  AND t.workspace_id = sqlc.arg('workspace_id')
  AND (t.status = 'backlog' OR ts.category = 'backlog')
  AND COALESCE(ts.category, t.status) NOT IN ('done', 'cancelled')
ORDER BY t.created_at, t.id
LIMIT sqlc.arg('limit_n');
