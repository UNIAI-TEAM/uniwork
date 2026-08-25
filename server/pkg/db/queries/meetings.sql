-- name: CreateMeeting :one
INSERT INTO meetings (id, workspace_id, title, description, starts_at, ends_at, room_name, created_by)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
RETURNING *;

-- name: ListMeetingsByWorkspace :many
SELECT * FROM meetings WHERE workspace_id = $1 ORDER BY starts_at DESC;

-- name: GetMeeting :one
SELECT * FROM meetings WHERE id = $1;

-- name: UpdateMeeting :one
UPDATE meetings SET
  title       = COALESCE(sqlc.narg('title'), title),
  description = COALESCE(sqlc.narg('description'), description),
  starts_at   = COALESCE(sqlc.narg('starts_at'), starts_at),
  ends_at     = COALESCE(sqlc.narg('ends_at'), ends_at),
  updated_at  = now()
WHERE id = sqlc.arg('id')
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
