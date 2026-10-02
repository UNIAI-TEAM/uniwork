-- name: ListAttendanceMarks :many
SELECT * FROM meeting_attendance_marks WHERE meeting_id = $1;

-- name: UpsertAttendanceMark :one
INSERT INTO meeting_attendance_marks (id, organization_id, meeting_id, participant_id, status, note, source, marked_by)
VALUES ($1, $2, $3, $4, $5, $6, 'MANUAL', $7)
ON CONFLICT (meeting_id, participant_id) DO UPDATE SET
  status = EXCLUDED.status,
  note = EXCLUDED.note,
  source = 'MANUAL',
  marked_by = EXCLUDED.marked_by,
  marked_at = now()
RETURNING *;

-- name: InsertAutoAttendanceMark :exec
INSERT INTO meeting_attendance_marks (id, organization_id, meeting_id, participant_id, status, source)
VALUES ($1, $2, $3, $4, $5, 'AUTO')
ON CONFLICT (meeting_id, participant_id) DO NOTHING;

-- name: DeleteAttendanceMark :execrows
DELETE FROM meeting_attendance_marks WHERE meeting_id = $1 AND participant_id = $2;

-- name: DeleteAutoAttendanceMarks :exec
DELETE FROM meeting_attendance_marks WHERE meeting_id = $1 AND source = 'AUTO';

-- name: DeleteInactiveAttendanceMarks :execrows
-- Drops the marks of people who are no longer participants (removed or left
-- while the roll was open), so a finalized roll is exactly the people who
-- were on it when it was finalized.
DELETE FROM meeting_attendance_marks mk
USING meeting_participants p
WHERE mk.participant_id = p.id AND mk.meeting_id = $1 AND p.status <> 'ACTIVE';

-- name: SetAttendanceFinalized :one
UPDATE meetings SET
  attendance_finalized_at = sqlc.narg('finalized_at'),
  attendance_finalized_by = sqlc.narg('finalized_by')
WHERE id = sqlc.arg('id')
RETURNING *;

-- name: AttendanceSessionTotals :many
SELECT
  participant_id,
  min(joined_at)::timestamptz AS first_joined_at,
  (CASE WHEN bool_or(left_at IS NULL) THEN NULL ELSE max(left_at) END)::timestamptz AS last_left_at,
  bool_or(left_at IS NULL)::boolean AS in_room,
  count(*)::int AS session_count,
  COALESCE(sum(EXTRACT(EPOCH FROM (COALESCE(left_at, now()) - joined_at))), 0)::bigint AS present_seconds
FROM meeting_attendance_sessions
WHERE meeting_id = $1
GROUP BY participant_id;

-- name: UpdateParticipantDuties :one
UPDATE meeting_participants SET
  standing = COALESCE(sqlc.narg('standing'), standing),
  is_secretary = COALESCE(sqlc.narg('is_secretary'), is_secretary)
WHERE id = sqlc.arg('id') AND status = 'ACTIVE'
RETURNING *;

-- name: LockMeetingForAttendance :one
-- Serializes finalize, reopen and clear on one meeting so each re-reads the
-- finalized flag under the lock instead of trusting a pre-transaction read.
SELECT * FROM meetings WHERE id = $1 FOR UPDATE;
