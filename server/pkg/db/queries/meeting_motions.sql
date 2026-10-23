-- name: CreateMeetingMotion :one
-- tenant: parent meeting_id
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
-- tenant: parent meeting_id
SELECT * FROM meeting_motions WHERE meeting_id = $1 ORDER BY position, created_at;

-- name: LockMeetingMotion :one
-- tenant: by-id
-- Scoped by meeting so a motion id from another meeting reads as not found.
SELECT * FROM meeting_motions
WHERE id = sqlc.arg('id') AND meeting_id = sqlc.arg('meeting_id')
FOR UPDATE;

-- name: GetMeetingMotionAtPosition :one
-- tenant: parent meeting_id
-- The neighbour a reorder swaps with; locked so both rows move together.
SELECT * FROM meeting_motions
WHERE meeting_id = sqlc.arg('meeting_id') AND position = sqlc.arg('position') AND id <> sqlc.arg('id')
LIMIT 1
FOR UPDATE;

-- name: UpdateMeetingMotionDraft :one
-- tenant: by-id
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
-- tenant: by-id
UPDATE meeting_motions SET position = $1, updated_at = now(), version = version + 1
WHERE id = $2;

-- name: DeleteMeetingMotionDraft :execrows
-- tenant: by-id
DELETE FROM meeting_motions WHERE id = $1 AND status = 'DRAFT';

-- name: GetOpenMeetingMotion :one
-- tenant: parent meeting_id
SELECT * FROM meeting_motions WHERE meeting_id = $1 AND status = 'OPEN';

-- name: OpenMeetingMotion :one
-- tenant: by-id
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

-- name: InsertMeetingMotionBallots :exec
-- The whole roll in one statement: one row per eligible member. Two unnests
-- in one select list advance together, so ids[i] goes with participant_ids[i]
-- (the arrays are always the same length). choice and cast_at stay NULL until
-- the vote.
INSERT INTO meeting_motion_ballots (id, organization_id, meeting_id, motion_id, participant_id)
SELECT
  unnest(sqlc.arg('ids')::text[]),
  sqlc.arg('organization_id')::text,
  sqlc.arg('meeting_id')::text,
  sqlc.arg('motion_id')::text,
  unnest(sqlc.arg('participant_ids')::text[]);

-- name: CastPublicMeetingBallot :execrows
-- tenant: parent motion_id
-- Fills the blank ballot and counts it in one statement. Zero rows: not on
-- the roll, or already voted (the caller tells them apart). The caller holds
-- the motion row (LockMeetingMotion), so the count cannot race a close.
WITH cast_ballot AS (
  UPDATE meeting_motion_ballots SET cast_at = now(), choice = sqlc.arg('choice')::text
  WHERE motion_id = sqlc.arg('motion_id') AND participant_id = sqlc.arg('participant_id') AND cast_at IS NULL
  RETURNING motion_id
)
UPDATE meeting_motions SET
  yes_count = yes_count + CASE WHEN sqlc.arg('choice')::text = 'YES' THEN 1 ELSE 0 END,
  no_count = no_count + CASE WHEN sqlc.arg('choice')::text = 'NO' THEN 1 ELSE 0 END,
  abstain_count = abstain_count + CASE WHEN sqlc.arg('choice')::text = 'ABSTAIN' THEN 1 ELSE 0 END,
  updated_at = now()
FROM cast_ballot
WHERE meeting_motions.id = cast_ballot.motion_id;

-- name: CastSecretMeetingBallot :execrows
-- tenant: parent motion_id
-- A secret ballot records only that the member voted: choice is never written
-- to the ballot, and never sent in the same statement as the participant, so
-- no statement log that keeps parameters can tie the two together. The vote
-- lands in the counters through CountSecretMeetingMotionVote. Zero rows: not
-- on the roll, or already voted (the caller tells them apart).
UPDATE meeting_motion_ballots SET cast_at = now()
WHERE motion_id = sqlc.arg('motion_id') AND participant_id = sqlc.arg('participant_id') AND cast_at IS NULL;

-- name: CountSecretMeetingMotionVote :exec
-- tenant: by-id
-- The secret choice, by motion only. The caller holds the motion row
-- (LockMeetingMotion) and calls this only after CastSecretMeetingBallot
-- stamped a ballot in the same transaction.
UPDATE meeting_motions SET
  yes_count = yes_count + CASE WHEN sqlc.arg('choice')::text = 'YES' THEN 1 ELSE 0 END,
  no_count = no_count + CASE WHEN sqlc.arg('choice')::text = 'NO' THEN 1 ELSE 0 END,
  abstain_count = abstain_count + CASE WHEN sqlc.arg('choice')::text = 'ABSTAIN' THEN 1 ELSE 0 END,
  updated_at = now()
WHERE id = sqlc.arg('id');

-- name: GetMeetingMotionBallot :one
-- tenant: parent motion_id
SELECT * FROM meeting_motion_ballots WHERE motion_id = $1 AND participant_id = $2;

-- name: CloseMeetingMotion :one
-- tenant: by-id
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
-- tenant: parent meeting_id
SELECT * FROM meeting_motions WHERE meeting_id = $1 AND status = 'OPEN' ORDER BY position FOR UPDATE;

-- name: ListMeetingBallotsForParticipant :many
-- tenant: parent meeting_id
SELECT * FROM meeting_motion_ballots WHERE meeting_id = $1 AND participant_id = $2;

-- name: GetMeetingMotion :one
-- tenant: by-id
-- A plain read for the voters panel; scoped by meeting like LockMeetingMotion.
SELECT * FROM meeting_motions WHERE id = sqlc.arg('id') AND meeting_id = sqlc.arg('meeting_id');

-- name: ListPublicMotionVoters :many
-- tenant: parent motion_id
-- One motion's named ballots, loaded only when someone opens its result.
-- Secret ballots never carry a choice, so they fall out of choice IS NOT NULL.
SELECT b.choice, p.display_name_snapshot
FROM meeting_motion_ballots b
JOIN meeting_participants p ON p.id = b.participant_id
WHERE b.motion_id = $1 AND b.cast_at IS NOT NULL AND b.choice IS NOT NULL
ORDER BY b.cast_at;

-- name: ListClosedMeetingMotions :many
-- tenant: parent meeting_id
SELECT * FROM meeting_motions WHERE meeting_id = $1 AND status = 'CLOSED' ORDER BY position;
