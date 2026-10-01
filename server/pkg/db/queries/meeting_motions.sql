-- name: CreateMeetingMotion :one
-- A new item goes after the last one in its meeting. Two clerks adding at the
-- same instant can share a position; ListMeetingMotions breaks the tie by
-- created_at and the next reorder separates them.
INSERT INTO meeting_motions (
  id, organization_id, workspace_id, meeting_id, title, description, position,
  ballot_mode, threshold, base, created_by
) VALUES (
  sqlc.arg('id'), sqlc.arg('organization_id'), sqlc.arg('workspace_id'), sqlc.arg('meeting_id'),
  sqlc.arg('title'), sqlc.arg('description'),
  (SELECT COALESCE(MAX(position), 0) + 1 FROM meeting_motions WHERE meeting_id = sqlc.arg('meeting_id'))::int,
  sqlc.arg('ballot_mode'), sqlc.arg('threshold'), sqlc.arg('base'), sqlc.arg('created_by')
)
RETURNING *;

-- name: ListMeetingMotions :many
SELECT * FROM meeting_motions WHERE meeting_id = $1 ORDER BY position, created_at;

-- name: LockMeetingMotion :one
-- Scoped by meeting so a motion id from another meeting reads as not found.
SELECT * FROM meeting_motions
WHERE id = sqlc.arg('id') AND meeting_id = sqlc.arg('meeting_id')
FOR UPDATE;

-- name: GetMeetingMotionAtPosition :one
-- The neighbour a reorder swaps with; locked so both rows move together.
SELECT * FROM meeting_motions
WHERE meeting_id = sqlc.arg('meeting_id') AND position = sqlc.arg('position') AND id <> sqlc.arg('id')
LIMIT 1
FOR UPDATE;

-- name: UpdateMeetingMotionDraft :one
UPDATE meeting_motions SET
  title = sqlc.arg('title'),
  description = sqlc.arg('description'),
  ballot_mode = sqlc.arg('ballot_mode'),
  threshold = sqlc.arg('threshold'),
  base = sqlc.arg('base'),
  position = sqlc.arg('position'),
  updated_at = now(),
  version = version + 1
WHERE id = sqlc.arg('id') AND status = 'DRAFT'
RETURNING *;

-- name: SetMeetingMotionPosition :exec
UPDATE meeting_motions SET position = $1, updated_at = now(), version = version + 1
WHERE id = $2;

-- name: DeleteMeetingMotionDraft :execrows
DELETE FROM meeting_motions WHERE id = $1 AND status = 'DRAFT';

-- name: GetOpenMeetingMotion :one
SELECT * FROM meeting_motions WHERE meeting_id = $1 AND status = 'OPEN';

-- name: OpenMeetingMotion :one
-- Freezes the denominators at the moment voting opens; the roll rows are
-- inserted in the same transaction.
UPDATE meeting_motions SET
  status = 'OPEN',
  opened_at = now(),
  opened_by = sqlc.narg('opened_by'),
  total_members = sqlc.arg('total_members')::int,
  roll_size = sqlc.arg('roll_size')::int,
  updated_at = now(),
  version = version + 1
WHERE id = sqlc.arg('id') AND status = 'DRAFT'
RETURNING *;

-- name: InsertMeetingMotionBallot :exec
-- One roll row per eligible member; choice and cast_at stay NULL until the vote.
INSERT INTO meeting_motion_ballots (id, organization_id, meeting_id, motion_id, participant_id)
VALUES ($1, $2, $3, $4, $5);

-- name: CastPublicMeetingBallot :execrows
-- Zero rows: not on the roll, or already voted (the caller tells them apart).
UPDATE meeting_motion_ballots SET cast_at = now(), choice = sqlc.arg('choice')
WHERE motion_id = sqlc.arg('motion_id') AND participant_id = sqlc.arg('participant_id') AND cast_at IS NULL;

-- name: CastSecretMeetingBallot :execrows
-- A secret ballot records only that the member voted: choice is never written,
-- the vote lands in the motion's counters (CountMeetingMotionVote) instead.
UPDATE meeting_motion_ballots SET cast_at = now()
WHERE motion_id = sqlc.arg('motion_id') AND participant_id = sqlc.arg('participant_id') AND cast_at IS NULL;

-- name: GetMeetingMotionBallot :one
SELECT * FROM meeting_motion_ballots WHERE motion_id = $1 AND participant_id = $2;

-- name: CountMeetingMotionVote :exec
UPDATE meeting_motions SET
  yes_count = yes_count + CASE WHEN sqlc.arg('choice')::text = 'YES' THEN 1 ELSE 0 END,
  no_count = no_count + CASE WHEN sqlc.arg('choice')::text = 'NO' THEN 1 ELSE 0 END,
  abstain_count = abstain_count + CASE WHEN sqlc.arg('choice')::text = 'ABSTAIN' THEN 1 ELSE 0 END,
  updated_at = now()
WHERE id = sqlc.arg('id');

-- name: CloseMeetingMotion :one
-- closed_by is NULL when the meeting ended on its own (no person closed it).
UPDATE meeting_motions SET
  status = 'CLOSED',
  outcome = sqlc.arg('outcome')::text,
  closed_at = now(),
  closed_by = sqlc.narg('closed_by'),
  updated_at = now(),
  version = version + 1
WHERE id = sqlc.arg('id') AND status = 'OPEN'
RETURNING *;

-- name: ListOpenMeetingMotionsForUpdate :many
SELECT * FROM meeting_motions WHERE meeting_id = $1 AND status = 'OPEN' ORDER BY position FOR UPDATE;

-- name: ListMeetingBallotsForParticipant :many
SELECT * FROM meeting_motion_ballots WHERE meeting_id = $1 AND participant_id = $2;

-- name: ListPublicMeetingVoters :many
-- Secret ballots never carry a choice, so they fall out of choice IS NOT NULL.
SELECT b.motion_id, b.choice, p.display_name_snapshot
FROM meeting_motion_ballots b
JOIN meeting_participants p ON p.id = b.participant_id
WHERE b.meeting_id = $1 AND b.cast_at IS NOT NULL AND b.choice IS NOT NULL
ORDER BY b.cast_at;

-- name: ListClosedMeetingMotions :many
SELECT * FROM meeting_motions WHERE meeting_id = $1 AND status = 'CLOSED' ORDER BY position;
