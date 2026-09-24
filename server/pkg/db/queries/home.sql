-- name: ListHomeMyWork :many
-- Open tasks assigned to the person, most urgent first: overdue (oldest due
-- first), due today, due later, then undated; priority and age break ties.
-- "Open" reads the status category, so a custom status in the done or
-- cancelled category counts as closed; a status missing from the catalogue
-- falls back to its own key.
SELECT t.* FROM tasks t
LEFT JOIN task_statuses ts ON ts.workspace_id = t.workspace_id AND ts.key = t.status
WHERE t.organization_id = sqlc.arg('organization_id')
  AND t.workspace_id = sqlc.arg('workspace_id')
  AND t.assignee_id = sqlc.arg('user_id')
  AND t.assignee_kind = 'human'
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

-- name: CountHomeMyWork :one
SELECT
  count(*)::bigint AS open,
  (count(*) FILTER (WHERE t.due_date < sqlc.arg('today')::date))::bigint AS overdue,
  (count(*) FILTER (WHERE t.due_date = sqlc.arg('today')::date))::bigint AS due_today
FROM tasks t
LEFT JOIN task_statuses ts ON ts.workspace_id = t.workspace_id AND ts.key = t.status
WHERE t.organization_id = sqlc.arg('organization_id')
  AND t.workspace_id = sqlc.arg('workspace_id')
  AND t.assignee_id = sqlc.arg('user_id')
  AND t.assignee_kind = 'human'
  AND COALESCE(ts.category, t.status) NOT IN ('done', 'cancelled');

-- name: ListHomeMeetings :many
-- Meetings the person hosts, created or is an active participant of: every
-- one in progress, and scheduled ones starting inside [from_at, to_at).
SELECT m.* FROM meetings m
WHERE m.workspace_id = sqlc.arg('workspace_id')
  AND (
    m.status = 'IN_PROGRESS'
    OR (m.status = 'SCHEDULED' AND m.starts_at >= sqlc.arg('from_at') AND m.starts_at < sqlc.arg('to_at'))
  )
  AND (
    m.host_user_id = sqlc.arg('user_id')
    OR m.created_by = sqlc.arg('user_id')
    OR EXISTS (
      SELECT 1 FROM meeting_participants p
      WHERE p.meeting_id = m.id AND p.user_id = sqlc.arg('user_id') AND p.removed_at IS NULL
    )
  )
ORDER BY CASE WHEN m.status = 'IN_PROGRESS' THEN 0 ELSE 1 END, m.starts_at, m.id
LIMIT sqlc.arg('limit_n');

-- name: CountHomeMeetingsToday :one
-- Meetings still ahead of the person today: scheduled or in progress, starting
-- inside [from_at, to_at).
SELECT count(*)::bigint FROM meetings m
WHERE m.workspace_id = sqlc.arg('workspace_id')
  AND m.status IN ('SCHEDULED', 'IN_PROGRESS')
  AND m.starts_at >= sqlc.arg('from_at') AND m.starts_at < sqlc.arg('to_at')
  AND (
    m.host_user_id = sqlc.arg('user_id')
    OR m.created_by = sqlc.arg('user_id')
    OR EXISTS (
      SELECT 1 FROM meeting_participants p
      WHERE p.meeting_id = m.id AND p.user_id = sqlc.arg('user_id') AND p.removed_at IS NULL
    )
  );

-- name: GetHomePreference :one
SELECT * FROM home_preferences
WHERE organization_id = $1 AND workspace_id = $2 AND user_id = $3;

-- name: UpsertHomePreference :one
INSERT INTO home_preferences (organization_id, workspace_id, user_id, prefs)
VALUES ($1, $2, $3, $4)
ON CONFLICT (workspace_id, user_id)
DO UPDATE SET prefs = EXCLUDED.prefs, organization_id = EXCLUDED.organization_id, updated_at = now()
RETURNING *;
