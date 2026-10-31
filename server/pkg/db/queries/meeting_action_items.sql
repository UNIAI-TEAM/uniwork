-- Action items of a meeting (UNI-1998, spec meeting follow-through §5.1). A
-- row's state is derived in Go (actionItemStatus) from dismissed_at and
-- whether task_id still names a live task: a task that was deleted or sits in
-- the trash does not count, so every read that needs the state joins tasks
-- (trashed_at IS NULL) and reports task_live.

-- name: InsertMeetingActionItem :one
INSERT INTO meeting_action_items (
  id, organization_id, workspace_id, meeting_id, source, summary_id, position,
  title, owner_text, due_text, evidence, description, suggested_priority, created_by, created_by_kind
) VALUES (
  sqlc.arg(id), sqlc.arg(organization_id), sqlc.arg(workspace_id), sqlc.arg(meeting_id), sqlc.arg(source),
  sqlc.narg(summary_id), sqlc.arg(position), sqlc.arg(title), sqlc.arg(owner_text), sqlc.arg(due_text),
  sqlc.arg(evidence), sqlc.arg(description), sqlc.arg(suggested_priority), sqlc.arg(created_by), sqlc.arg(created_by_kind)
)
RETURNING *;

-- name: ListMeetingActionItems :many
-- AI items first in the order the model gave them, then the ones people
-- (and the live scribe) added. The task columns are empty unless the task
-- still exists; task_closed reads the status category the way "open" is
-- read everywhere else (a custom status in done or cancelled is closed).
SELECT sqlc.embed(i),
  (t.id IS NOT NULL)::boolean AS task_live,
  COALESCE(t.title, '')::text AS task_title,
  COALESCE(t.status, '')::text AS task_status,
  (t.id IS NOT NULL AND COALESCE(ts.category, t.status) IN ('done', 'cancelled'))::boolean AS task_closed,
  t.assignee_id AS task_assignee_id,
  t.due_date AS task_due_date
FROM meeting_action_items i
LEFT JOIN tasks t ON t.id = i.task_id AND t.organization_id = i.organization_id AND t.trashed_at IS NULL
LEFT JOIN task_statuses ts ON ts.workspace_id = t.workspace_id AND ts.key = t.status
WHERE i.organization_id = sqlc.arg(organization_id) AND i.meeting_id = sqlc.arg(meeting_id)
ORDER BY (i.source <> 'AI'), i.position, i.created_at, i.id;

-- name: LockMeetingActionItems :many
-- The named items of one meeting, locked in id order so two batches cannot
-- deadlock on them. An id of another meeting or tenant is simply absent.
SELECT sqlc.embed(i), (t.id IS NOT NULL)::boolean AS task_live
FROM meeting_action_items i
LEFT JOIN tasks t ON t.id = i.task_id AND t.organization_id = i.organization_id AND t.trashed_at IS NULL
WHERE i.organization_id = sqlc.arg(organization_id) AND i.meeting_id = sqlc.arg(meeting_id)
  AND i.id = ANY(sqlc.arg(ids)::text[])
ORDER BY i.id
FOR UPDATE OF i;

-- name: NextMeetingActionItemPosition :one
SELECT COALESCE(MAX(position) + 1, 0)::int AS position
FROM meeting_action_items
WHERE organization_id = sqlc.arg(organization_id) AND meeting_id = sqlc.arg(meeting_id);

-- name: ConvertMeetingActionItem :exec
UPDATE meeting_action_items
SET task_id = sqlc.arg(task_id), converted_at = now(), converted_by = sqlc.arg(converted_by), updated_at = now()
WHERE organization_id = sqlc.arg(organization_id) AND id = sqlc.arg(id);

-- name: LockUndoableConvertedActionItems :many
-- The named items of one meeting whose fresh conversion by converted_by can
-- still be taken back (UNI-2285): converted within the window, into a task
-- made in that same transaction (created_at = converted_at, so an item linked
-- to an older task never counts) that is live and nobody used: never updated,
-- no subtask, and none of what leaves updated_at alone (a comment, an
-- attachment, a dependency on either side, another item linked to it). Items
-- and tasks locked in item id order, after LockMeetingSummaryChanges like
-- LockMeetingActionItems.
SELECT sqlc.embed(i), sqlc.embed(t)
FROM meeting_action_items i
JOIN tasks t ON t.id = i.task_id AND t.organization_id = i.organization_id
WHERE i.organization_id = sqlc.arg(organization_id) AND i.meeting_id = sqlc.arg(meeting_id)
  AND i.id = ANY(sqlc.arg(ids)::text[])
  AND i.dismissed_at IS NULL AND i.converted_by = sqlc.arg(converted_by)::text
  AND i.converted_at > now() - make_interval(secs => sqlc.arg(window_seconds)::float8)
  AND t.trashed_at IS NULL AND t.created_at = i.converted_at AND t.updated_at = t.created_at
  AND NOT EXISTS (SELECT 1 FROM tasks c WHERE c.organization_id = t.organization_id AND c.workspace_id = t.workspace_id AND c.parent_task_id = t.id)
  AND NOT EXISTS (SELECT 1 FROM task_comments tc WHERE tc.task_id = t.id)
  AND NOT EXISTS (SELECT 1 FROM attachments a WHERE a.workspace_id = t.workspace_id AND a.task_id = t.id)
  AND NOT EXISTS (SELECT 1 FROM task_dependencies d WHERE d.workspace_id = t.workspace_id AND (d.task_id = t.id OR d.depends_on_task_id = t.id))
  AND NOT EXISTS (SELECT 1 FROM meeting_action_items o WHERE o.task_id = t.id AND o.id <> i.id)
ORDER BY i.id
FOR UPDATE OF i, t;

-- name: UnconvertMeetingActionItem :exec
UPDATE meeting_action_items
SET task_id = NULL, converted_at = NULL, converted_by = NULL, updated_at = now()
WHERE organization_id = sqlc.arg(organization_id) AND id = sqlc.arg(id);

-- name: DismissMeetingActionItem :exec
UPDATE meeting_action_items
SET dismissed_at = now(), dismissed_by = sqlc.arg(dismissed_by), dismiss_reason = sqlc.arg(dismiss_reason), updated_at = now()
WHERE organization_id = sqlc.arg(organization_id) AND id = sqlc.arg(id);

-- name: RestoreMeetingActionItem :exec
UPDATE meeting_action_items
SET dismissed_at = NULL, dismissed_by = NULL, dismiss_reason = '', updated_at = now()
WHERE organization_id = sqlc.arg(organization_id) AND id = sqlc.arg(id);

-- name: RefineLiveMeetingActionItem :execrows
-- A summary refines a pending live item in place (UNI-1995 benchmark #21):
-- owner, due, priority, description and evidence, never its title. Only while
-- nobody handled it: not dismissed and no live task (deleted or trashed).
UPDATE meeting_action_items i
SET owner_text = sqlc.arg(owner_text), due_text = sqlc.arg(due_text), suggested_priority = sqlc.arg(suggested_priority),
  description = sqlc.arg(description), evidence = sqlc.arg(evidence), updated_at = now()
WHERE i.organization_id = sqlc.arg(organization_id) AND i.meeting_id = sqlc.arg(meeting_id) AND i.id = sqlc.arg(id)
  AND i.source = 'LIVE' AND i.dismissed_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.id = i.task_id AND t.organization_id = i.organization_id AND t.trashed_at IS NULL);

-- name: DeletePendingAIMeetingActionItems :execrows
-- A regenerated summary replaces the AI items nobody has handled yet: not
-- dismissed, and no task, or a task that was deleted or trashed since.
DELETE FROM meeting_action_items i
WHERE i.organization_id = sqlc.arg(organization_id) AND i.meeting_id = sqlc.arg(meeting_id)
  AND i.source = 'AI' AND i.dismissed_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.id = i.task_id AND t.organization_id = i.organization_id AND t.trashed_at IS NULL);

-- name: LockMeetingSummaryChanges :exec
-- Serializes every write on a meeting's summaries and action items: storing a
-- new summary, adding, dismissing, restoring and converting items all take
-- this lock in their transaction first, so a conversion never lands on an
-- item a regenerated summary is replacing. Released at commit or rollback.
SELECT pg_advisory_xact_lock(hashtextextended('meeting_summary_tx:' || sqlc.arg(meeting_id)::text, 0));

-- name: ListCarriedOverActionItems :many
-- Carried over to a meeting (spec §6.5, follow-4): converted items whose task
-- is still open, from the other ENDED meetings of the same project or the
-- same series (series_id, or the series' first meeting itself) that started
-- before it (actual start, else the scheduled one) and after started_after.
-- Open reads the status category as ListMeetingActionItems does. Soonest due
-- first, no due last; total counts every row past the page's limit.
SELECT i.id AS action_item_id, COUNT(*) OVER ()::int AS total,
  m.id AS meeting_id, m.title AS meeting_title,
  COALESCE(m.actual_start_at, m.starts_at)::timestamptz AS meeting_started_at,
  t.id AS task_id, t.title AS task_title, t.status AS task_status,
  t.assignee_id AS task_assignee_id, t.due_date AS task_due_date
FROM meetings m
JOIN meeting_action_items i ON i.meeting_id = m.id AND i.organization_id = m.organization_id
JOIN tasks t ON t.id = i.task_id AND t.organization_id = i.organization_id AND t.trashed_at IS NULL
LEFT JOIN task_statuses ts ON ts.workspace_id = t.workspace_id AND ts.key = t.status
WHERE m.organization_id = sqlc.arg(organization_id) AND m.workspace_id = sqlc.arg(workspace_id)
  AND ((sqlc.narg(project_id)::text IS NOT NULL AND m.project_id = sqlc.narg(project_id)::text)
    OR (sqlc.narg(series_id)::text IS NOT NULL AND (m.series_id = sqlc.narg(series_id)::text OR m.id = sqlc.narg(series_id)::text)))
  AND m.id <> sqlc.arg(meeting_id)
  AND m.status = 'ENDED'
  AND COALESCE(m.actual_start_at, m.starts_at) < sqlc.arg(started_before)::timestamptz
  AND COALESCE(m.actual_start_at, m.starts_at) >= sqlc.arg(started_after)::timestamptz
  AND i.dismissed_at IS NULL
  AND COALESCE(ts.category, t.status) NOT IN ('done', 'cancelled')
ORDER BY t.due_date NULLS LAST, COALESCE(m.actual_start_at, m.starts_at), m.id, i.position, i.id
LIMIT sqlc.arg(row_limit);
