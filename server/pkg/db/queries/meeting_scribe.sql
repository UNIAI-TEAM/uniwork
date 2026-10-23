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

-- name: RequeueScribeRunDispatch :one
-- tenant: by-id
-- A dispatch no worker took (benchmark #13): the 60 s clock restarts without
-- counting a miss. Guarded by the dispatch id the caller read, so two sweeps
-- that saw the same dispatch send one new one.
UPDATE meeting_scribe_runs SET dispatched_at = now(), updated_at = now()
WHERE id = sqlc.arg('id') AND status = 'DISPATCHED' AND dispatch_id = sqlc.arg('dispatch_id')
RETURNING *;

-- name: ScribeRunHealth :one
-- tenant: system
-- Fleet-wide, for the sweep's gauge (benchmark #1): ACTIVE runs that started
-- before since and have people in the room now, and of those the ones that
-- transcribed and then no transcript line reached after since
-- (idx_meeting_transcript_meeting_created). A run that never transcribed is a
-- quiet room (screen share, everyone muted), not an outage; an outage from
-- the first word is MeetingScribeSttErrors' to catch. A device-caption line
-- counts: the transcript still flows.
SELECT
  count(*)::int AS active,
  (count(*) FILTER (WHERE r.segments > 0 AND NOT EXISTS (
    SELECT 1 FROM meeting_transcript_segments s
    WHERE s.meeting_id = r.meeting_id AND s.created_at > sqlc.arg('since')::timestamptz)))::int AS silent
FROM meeting_scribe_runs r
WHERE r.status = 'ACTIVE' AND r.started_at < sqlc.arg('since')::timestamptz
  AND EXISTS (SELECT 1 FROM meeting_attendance_sessions a WHERE a.meeting_id = r.meeting_id AND a.left_at IS NULL);

-- name: StartScribeRun :one
-- tenant: by-id
-- The agent's participant SID is the latest connection that reported in.
UPDATE meeting_scribe_runs SET status = 'ACTIVE', started_at = COALESCE(started_at, now()), updated_at = now(),
  agent_participant_sid = COALESCE(NULLIF(sqlc.arg('agent_participant_sid')::text, ''), agent_participant_sid)
WHERE id = sqlc.arg('id') AND status IN ('DISPATCHED', 'ACTIVE')
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
-- One page of the meetings the 15 s scribe sweep looks at, by id after the
-- last page: those holding an open run that may need closing
-- (uidx_meeting_scribe_runs_open), and of the meetings in progress
-- (idx_meetings_in_progress_ends) the ones with people in the room when
-- dispatching is on (with_people), and the ones switched off since off_since,
-- whose agent removal the sweep repeats.
SELECT s.id::text AS id FROM (
  SELECT r.meeting_id AS id FROM meeting_scribe_runs r WHERE r.status IN ('DISPATCHED', 'ACTIVE')
  UNION
  SELECT m.id FROM meetings m
  WHERE m.status = 'IN_PROGRESS' AND (
    (sqlc.arg('with_people')::bool AND EXISTS (
      SELECT 1 FROM meeting_attendance_sessions a WHERE a.meeting_id = m.id AND a.left_at IS NULL))
    OR m.scribe_off_at > sqlc.arg('off_since')::timestamptz)
) s
WHERE s.id > sqlc.arg('after')::text
ORDER BY s.id
LIMIT sqlc.arg('row_limit');

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

-- name: MeetingExtractCursor :one
-- tenant: parent meeting_id
-- The last segment the live-items extraction read (UNI-2025, §4.4), across
-- the meeting's runs: a new run (D18) carries on where the last one stopped.
-- Latest by (created_at, id), the order ListSegmentsAfterExtractCursor reads.
SELECT COALESCE((
  SELECT s.id FROM meeting_scribe_runs r
  JOIN meeting_transcript_segments s ON s.id = r.extract_cursor_segment_id AND s.meeting_id = r.meeting_id
  WHERE r.meeting_id = $1
  ORDER BY s.created_at DESC, s.id DESC LIMIT 1), '')::text AS cursor;

-- name: ListSegmentsAfterExtractCursor :many
-- tenant: parent meeting_id
-- Segments the extraction has not read, in (created_at, id) order on the DB
-- clock. Ids come from each replica's clock and created_at is the inserting
-- transaction's start, so a line can commit after a later one was read: only
-- lines older than 5 s are read, by then every such transaction has
-- committed. An empty or unknown cursor reads from the start.
SELECT s.* FROM meeting_transcript_segments s
LEFT JOIN meeting_transcript_segments c ON c.id = sqlc.arg('cursor')::text AND c.meeting_id = s.meeting_id
WHERE s.meeting_id = sqlc.arg('meeting_id')
  AND s.created_at < now() - interval '5 seconds'
  AND (c.id IS NULL OR (s.created_at, s.id) > (c.created_at, c.id))
ORDER BY s.created_at, s.id
LIMIT sqlc.arg('row_limit');

-- name: ListSegmentsUpToExtractCursor :many
-- tenant: parent meeting_id
-- The last lines the extraction already read, newest first, up to and
-- including the cursor: read-only context for the next extraction (UNI-1995
-- benchmark #21). An empty or unknown cursor has none.
SELECT s.* FROM meeting_transcript_segments s
JOIN meeting_transcript_segments c ON c.id = sqlc.arg('cursor')::text AND c.meeting_id = s.meeting_id
WHERE s.meeting_id = sqlc.arg('meeting_id')
  AND (s.created_at, s.id) <= (c.created_at, c.id)
ORDER BY s.created_at DESC, s.id DESC
LIMIT sqlc.arg('row_limit');

-- name: AdvanceScribeExtractCursor :execrows
-- tenant: by-id
-- Guarded by the extract count the caller read: of two extractions that read
-- the same segments only one stores its items. The cursor read starts at the
-- meeting's cursor, so the new one is always later.
UPDATE meeting_scribe_runs SET
  extract_cursor_segment_id = sqlc.arg('cursor')::text,
  extracts = extracts + 1, last_extract_at = now(), updated_at = now()
WHERE id = sqlc.arg('id') AND extracts = sqlc.arg('extracts')::int;
