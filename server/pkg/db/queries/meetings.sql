-- name: CreateMeeting :one
INSERT INTO meetings (
  id, workspace_id, title, description, starts_at, ends_at, room_name, created_by,
  status, meeting_type, host_user_id, timezone, allow_join_request, version, updated_by, project_id, preferred_provider_key
) VALUES (
  $1, $2, $3, $4, $5, $6, $7, $8,
  $9, $10, $11, $12, $13, 1, $8, $14, $15
)
RETURNING *;

-- name: ListMeetingsByWorkspace :many
SELECT * FROM meetings WHERE workspace_id = $1 ORDER BY starts_at DESC;

-- name: ListMeetingsByWorkspaceFiltered :many
SELECT * FROM meetings
WHERE workspace_id = sqlc.arg('workspace_id')
  AND (sqlc.narg('status')::text IS NULL OR status = sqlc.narg('status'))
  AND (sqlc.narg('meeting_type')::text IS NULL OR meeting_type = sqlc.narg('meeting_type'))
  AND (sqlc.narg('host_user_id')::text IS NULL OR host_user_id = sqlc.narg('host_user_id'))
  AND (sqlc.narg('project_id')::text IS NULL OR project_id = sqlc.narg('project_id'))
  AND (sqlc.narg('q')::text IS NULL OR title ILIKE '%' || sqlc.narg('q') || '%')
  AND (sqlc.narg('from_at')::timestamptz IS NULL OR starts_at >= sqlc.narg('from_at'))
  AND (sqlc.narg('to_at')::timestamptz IS NULL OR starts_at <= sqlc.narg('to_at'))
ORDER BY
  CASE WHEN sqlc.arg('sort') = 'actual_start_at' THEN actual_start_at END DESC NULLS LAST,
  -- Agenda order: live/upcoming soonest-first, then past most-recent-first.
  (ends_at < now()),
  CASE WHEN ends_at >= now() THEN starts_at END ASC,
  starts_at DESC
LIMIT sqlc.arg('limit_n') OFFSET sqlc.arg('offset_n');

-- name: CountMeetingsByWorkspaceFiltered :one
SELECT count(*)::bigint FROM meetings
WHERE workspace_id = sqlc.arg('workspace_id')
  AND (sqlc.narg('status')::text IS NULL OR status = sqlc.narg('status'))
  AND (sqlc.narg('meeting_type')::text IS NULL OR meeting_type = sqlc.narg('meeting_type'))
  AND (sqlc.narg('host_user_id')::text IS NULL OR host_user_id = sqlc.narg('host_user_id'))
  AND (sqlc.narg('project_id')::text IS NULL OR project_id = sqlc.narg('project_id'))
  AND (sqlc.narg('q')::text IS NULL OR title ILIKE '%' || sqlc.narg('q') || '%')
  AND (sqlc.narg('from_at')::timestamptz IS NULL OR starts_at >= sqlc.narg('from_at'))
  AND (sqlc.narg('to_at')::timestamptz IS NULL OR starts_at <= sqlc.narg('to_at'));

-- name: GetMeeting :one
SELECT * FROM meetings WHERE id = $1;

-- name: UpdateMeeting :one
UPDATE meetings SET
  title       = COALESCE(sqlc.narg('title'), title),
  description = COALESCE(sqlc.narg('description'), description),
  starts_at   = COALESCE(sqlc.narg('starts_at'), starts_at),
  ends_at     = COALESCE(sqlc.narg('ends_at'), ends_at),
  timezone    = COALESCE(sqlc.narg('timezone'), timezone),
  allow_join_request = COALESCE(sqlc.narg('allow_join_request'), allow_join_request),
  project_id  = COALESCE(sqlc.narg('project_id'), project_id),
  updated_by  = sqlc.narg('updated_by'),
  updated_at  = now(),
  version     = version + 1
WHERE id = sqlc.arg('id') AND version = sqlc.arg('version')
RETURNING *;

-- name: StartMeeting :one
UPDATE meetings SET
  status = 'IN_PROGRESS',
  actual_start_at = now(),
  updated_by = sqlc.arg('updated_by'),
  updated_at = now(),
  version = version + 1
WHERE id = sqlc.arg('id') AND status = 'SCHEDULED' AND version = sqlc.arg('version')
RETURNING *;

-- name: EndMeeting :one
UPDATE meetings SET
  status = 'ENDED',
  actual_end_at = now(),
  updated_by = sqlc.arg('updated_by'),
  updated_at = now(),
  version = version + 1
WHERE id = sqlc.arg('id') AND status = 'IN_PROGRESS' AND version = sqlc.arg('version')
RETURNING *;

-- name: CancelMeeting :one
UPDATE meetings SET
  status = 'CANCELED',
  canceled_by = sqlc.arg('canceled_by'),
  canceled_at = now(),
  cancel_reason = sqlc.narg('cancel_reason'),
  updated_by = sqlc.arg('canceled_by'),
  updated_at = now(),
  version = version + 1
WHERE id = sqlc.arg('id') AND status = 'SCHEDULED' AND version = sqlc.arg('version')
RETURNING *;

-- name: TransferMeetingHost :one
UPDATE meetings SET
  host_user_id = sqlc.arg('host_user_id'),
  updated_by = sqlc.arg('updated_by'),
  updated_at = now(),
  version = version + 1
WHERE id = sqlc.arg('id') AND version = sqlc.arg('version')
  AND status IN ('SCHEDULED', 'IN_PROGRESS')
RETURNING *;

-- name: DeleteMeeting :exec
DELETE FROM meetings WHERE id = $1;

-- name: AddMeetingAttendee :exec
INSERT INTO meeting_attendees (meeting_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING;

-- name: CreateMeetingNote :one
INSERT INTO meeting_notes (id, meeting_id, author_id, body)
VALUES ($1, $2, $3, $4)
RETURNING *;

-- name: ListMeetingNotes :many
SELECT n.id, n.meeting_id, n.author_id, n.body, n.created_at, u.display_name, u.avatar_url
FROM meeting_notes n JOIN users u ON u.id = n.author_id
WHERE n.meeting_id = $1 ORDER BY n.created_at;

-- name: MeetingWorkspaceStatistics :one
SELECT
  count(*)::bigint AS total,
  count(*) FILTER (WHERE status = 'SCHEDULED')::bigint AS scheduled,
  count(*) FILTER (WHERE status = 'IN_PROGRESS')::bigint AS in_progress,
  count(*) FILTER (WHERE status = 'ENDED')::bigint AS ended,
  count(*) FILTER (WHERE status = 'CANCELED')::bigint AS canceled,
  count(*) FILTER (WHERE meeting_type = 'INSTANT')::bigint AS instant
FROM meetings
WHERE workspace_id = $1;
