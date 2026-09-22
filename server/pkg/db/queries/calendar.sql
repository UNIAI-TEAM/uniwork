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
