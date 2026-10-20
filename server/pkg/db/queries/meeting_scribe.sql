-- Meeting scribe runs (UNI-2023, spec 2026-10-20-meeting-scribe-agent-design §6.1).

-- name: InsertScribeRun :one
-- No row back means another caller holds the meeting's open run
-- (uidx_meeting_scribe_runs_open): only the winner dispatches.
INSERT INTO meeting_scribe_runs (id, organization_id, workspace_id, meeting_id, created_by, created_by_kind)
VALUES ($1, $2, $3, $4, $5, $6)
ON CONFLICT (meeting_id) WHERE status IN ('DISPATCHED', 'ACTIVE') DO NOTHING
RETURNING *;

-- name: GetScribeRun :one
-- tenant: by-id
SELECT * FROM meeting_scribe_runs WHERE id = $1;

-- name: GetLatestScribeRun :one
-- tenant: parent meeting_id
SELECT * FROM meeting_scribe_runs WHERE meeting_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1;

-- name: SetScribeRunDispatch :one
-- tenant: by-id
-- Records the dispatch just sent; the 60 s clock restarts with it.
UPDATE meeting_scribe_runs SET dispatch_id = $2, dispatched_at = now(), updated_at = now()
WHERE id = $1 AND status = 'DISPATCHED'
RETURNING *;

-- name: FailScribeRunDispatch :one
-- tenant: by-id
-- One more dispatch that never became ACTIVE. Guarded by the failure count the
-- caller read, so two sweeps that saw the same miss count it once; the third
-- miss fails the run.
UPDATE meeting_scribe_runs SET
  failures = failures + 1,
  status = CASE WHEN failures + 1 >= sqlc.arg('max_failures')::int THEN 'FAILED' ELSE status END,
  finished_at = CASE WHEN failures + 1 >= sqlc.arg('max_failures')::int THEN now() ELSE finished_at END,
  dispatched_at = now(),
  updated_at = now()
WHERE id = sqlc.arg('id') AND status = 'DISPATCHED' AND failures = sqlc.arg('failures')
RETURNING *;

-- name: StartScribeRun :one
-- tenant: by-id
UPDATE meeting_scribe_runs SET status = 'ACTIVE', started_at = COALESCE(started_at, now()), updated_at = now()
WHERE id = $1 AND status IN ('DISPATCHED', 'ACTIVE')
RETURNING *;

-- name: FinishScribeRun :one
-- tenant: by-id
-- No row back means the run was already closed; a later report of the vendor
-- session time still lands through AddScribeRunSessionTime.
UPDATE meeting_scribe_runs SET status = 'FINISHED', finished_at = now(), updated_at = now(),
  stt_session_ms = GREATEST(stt_session_ms, sqlc.arg('stt_session_ms')::bigint)
WHERE id = sqlc.arg('id') AND status IN ('DISPATCHED', 'ACTIVE')
RETURNING *;

-- name: AddScribeRunSessionTime :exec
-- tenant: by-id
UPDATE meeting_scribe_runs SET stt_session_ms = GREATEST(stt_session_ms, sqlc.arg('stt_session_ms')::bigint), updated_at = now()
WHERE id = sqlc.arg('id');

-- name: AddScribeRunSpeech :one
-- tenant: by-id
UPDATE meeting_scribe_runs SET
  speech_ms = speech_ms + sqlc.arg('speech_ms')::bigint,
  segments = segments + sqlc.arg('segments')::int,
  updated_at = now()
WHERE id = sqlc.arg('id')
RETURNING *;

-- name: MarkScribeRunMetered :execrows
-- tenant: by-id
-- Moves metered_ms only from the value the caller read, so the usage event
-- and the mark commit once per minute however many batches race.
UPDATE meeting_scribe_runs SET metered_ms = sqlc.arg('metered_ms')::bigint, updated_at = now()
WHERE id = sqlc.arg('id') AND metered_ms = sqlc.arg('previous_ms')::bigint;

-- name: ScribeRoomPresence :one
-- tenant: parent meeting_id
-- People in the room are open attendance sessions; the agent never has one
-- (only uw_participant_ identities do). last_left_at dates the emptying.
SELECT
  EXISTS (SELECT 1 FROM meeting_attendance_sessions a WHERE a.meeting_id = sqlc.arg('meeting_id') AND a.left_at IS NULL) AS present,
  (SELECT max(a.left_at) FROM meeting_attendance_sessions a WHERE a.meeting_id = sqlc.arg('meeting_id'))::timestamptz AS last_left_at;

-- name: ListScribeSweepMeetings :many
-- tenant: system
-- Meetings the 15 s scribe sweep looks at: in progress with people in the
-- room, or holding an open run that may need closing.
SELECT m.id FROM meetings m
WHERE (m.status = 'IN_PROGRESS' AND EXISTS (
    SELECT 1 FROM meeting_attendance_sessions a WHERE a.meeting_id = m.id AND a.left_at IS NULL))
  OR EXISTS (
    SELECT 1 FROM meeting_scribe_runs r WHERE r.meeting_id = m.id AND r.status IN ('DISPATCHED', 'ACTIVE'))
LIMIT $1;

-- name: SetMeetingScribeOff :one
-- tenant: by-id
-- off = true stamps the first switch-off and keeps it; off = false clears it.
UPDATE meetings SET
  scribe_off_at = CASE WHEN sqlc.arg('off')::bool THEN COALESCE(scribe_off_at, now()) ELSE NULL END,
  scribe_off_by = CASE WHEN sqlc.arg('off')::bool THEN COALESCE(scribe_off_by, sqlc.arg('by')::text) ELSE NULL END,
  updated_at = now()
WHERE id = sqlc.arg('id')
RETURNING *;

-- name: InsertAgentTranscriptSegment :one
-- No row back means the agent sent this segment before (a retried batch).
INSERT INTO meeting_transcript_segments (
  id, meeting_id, organization_id, participant_id, speaker_name, text, spoken_at,
  source, start_ms, end_ms, speaker_label, client_segment_id, language
) VALUES (
  $1, $2, $3, $4, $5, $6, $7, 'AGENT', $8, $9, $10, $11, $12
)
ON CONFLICT (meeting_id, client_segment_id) WHERE client_segment_id IS NOT NULL DO NOTHING
RETURNING *;
