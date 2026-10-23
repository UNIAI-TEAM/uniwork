-- name: InsertTranscriptSegment :one
INSERT INTO meeting_transcript_segments (id, meeting_id, participant_id, speaker_name, text, spoken_at, organization_id)
VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING *;

-- name: ListTranscriptSegmentsLatest :many
-- tenant: parent meeting_id
-- Newest first; callers reverse the page into reading order (G18). The
-- source rule (parent spec §7.3, TranscriptSources) rides on every page:
-- rich = the given transcriptions, else the scribe's lines; captions only
-- when neither. An uploaded recording replaces the live lines (UNI-1995 #11):
-- one transcript, never two copies of the same speech.
SELECT * FROM meeting_transcript_segments
WHERE meeting_id = sqlc.arg('meeting_id')
  AND (CASE WHEN sqlc.arg('rich')::bool
    THEN (source = 'AGENT' AND cardinality(sqlc.arg('transcription_ids')::text[]) = 0) OR transcription_id = ANY(sqlc.arg('transcription_ids')::text[])
    ELSE source = 'CAPTION' END)
ORDER BY spoken_at DESC, id DESC LIMIT sqlc.arg('row_limit');

-- name: ListTranscriptSegmentsBetween :many
-- tenant: parent meeting_id
-- Oldest first in [from_at, to_at) under the same source rule: Ask UNI's
-- get_meeting_transcript reads a stretch of the meeting (scribe spec §5.2).
SELECT * FROM meeting_transcript_segments
WHERE meeting_id = sqlc.arg('meeting_id')
  AND spoken_at >= sqlc.arg('from_at')::timestamptz AND spoken_at < sqlc.arg('to_at')::timestamptz
  AND (CASE WHEN sqlc.arg('rich')::bool
    THEN (source = 'AGENT' AND cardinality(sqlc.arg('transcription_ids')::text[]) = 0) OR transcription_id = ANY(sqlc.arg('transcription_ids')::text[])
    ELSE source = 'CAPTION' END)
ORDER BY spoken_at, id
LIMIT sqlc.arg('row_limit');

-- name: ListTranscriptSegmentsBefore :many
-- tenant: parent meeting_id
-- The page older than the cursor row; the plain spoken_at bound lets the
-- (meeting_id, spoken_at) index start the scan at the cursor.
SELECT * FROM meeting_transcript_segments
WHERE meeting_id = sqlc.arg('meeting_id')
  AND spoken_at <= sqlc.arg('before_at')::timestamptz
  AND (spoken_at, id) < (sqlc.arg('before_at')::timestamptz, sqlc.arg('before_id')::text)
  AND (CASE WHEN sqlc.arg('rich')::bool
    THEN (source = 'AGENT' AND cardinality(sqlc.arg('transcription_ids')::text[]) = 0) OR transcription_id = ANY(sqlc.arg('transcription_ids')::text[])
    ELSE source = 'CAPTION' END)
ORDER BY spoken_at DESC, id DESC
LIMIT sqlc.arg('row_limit');

-- name: ListTranscriptSegmentsAfter :many
-- tenant: parent meeting_id
-- Oldest first, the page after the cursor row (UNI-1995 #9): an ended
-- meeting reads from its start. A zero cursor reads the first page.
SELECT * FROM meeting_transcript_segments
WHERE meeting_id = sqlc.arg('meeting_id')
  AND spoken_at >= sqlc.arg('after_at')::timestamptz
  AND (spoken_at, id) > (sqlc.arg('after_at')::timestamptz, sqlc.arg('after_id')::text)
  AND (CASE WHEN sqlc.arg('rich')::bool
    THEN (source = 'AGENT' AND cardinality(sqlc.arg('transcription_ids')::text[]) = 0) OR transcription_id = ANY(sqlc.arg('transcription_ids')::text[])
    ELSE source = 'CAPTION' END)
ORDER BY spoken_at, id
LIMIT sqlc.arg('row_limit');

-- name: GetVisibleTranscriptSegment :one
-- tenant: parent meeting_id
-- One line of the meeting under the source rule: the anchor of an around=
-- read (a citation's "view in transcript").
SELECT * FROM meeting_transcript_segments
WHERE meeting_id = sqlc.arg('meeting_id') AND id = sqlc.arg('id')
  AND (CASE WHEN sqlc.arg('rich')::bool
    THEN (source = 'AGENT' AND cardinality(sqlc.arg('transcription_ids')::text[]) = 0) OR transcription_id = ANY(sqlc.arg('transcription_ids')::text[])
    ELSE source = 'CAPTION' END);

-- name: ListTranscriptSegmentsCreatedSince :many
-- tenant: parent meeting_id
-- Delta read keyed on created_at, not spoken_at: spoken_at comes from the
-- caption client or the STT agent and can land behind rows already read.
SELECT * FROM meeting_transcript_segments
WHERE meeting_id = sqlc.arg('meeting_id') AND created_at >= sqlc.arg('since')::timestamptz
  AND (CASE WHEN sqlc.arg('rich')::bool
    THEN (source = 'AGENT' AND cardinality(sqlc.arg('transcription_ids')::text[]) = 0) OR transcription_id = ANY(sqlc.arg('transcription_ids')::text[])
    ELSE source = 'CAPTION' END)
ORDER BY created_at ASC, id ASC
LIMIT sqlc.arg('row_limit');

-- name: InsertMeetingSummary :one
INSERT INTO meeting_summaries (id, meeting_id, summary, decisions, action_items, model, created_by, usage_event_id, organization_id, partial, created_by_kind)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
RETURNING *;

-- name: GetLatestMeetingSummary :one
-- tenant: parent meeting_id
SELECT * FROM meeting_summaries WHERE meeting_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1;

-- name: InsertMeetingRecording :one
INSERT INTO meeting_recordings (id, meeting_id, egress_id, started_by, file_id, organization_id)
VALUES ($1, $2, $3, $4, sqlc.narg('file_id'), sqlc.arg('organization_id'))
RETURNING *;

-- name: GetMeetingRecordingByEgressID :one
-- tenant: system
SELECT * FROM meeting_recordings WHERE egress_id = $1 ORDER BY started_at DESC LIMIT 1;

-- name: ListMeetingRecordingFileHolds :many
-- tenant: system
-- FS-C1 section 6: a live recording row holds its file.
SELECT DISTINCT file_id
FROM meeting_recordings
WHERE file_id = ANY($1::text[]);

-- name: ListMeetingRecordings :many
-- tenant: parent meeting_id
SELECT * FROM meeting_recordings WHERE meeting_id = $1 ORDER BY started_at DESC;

-- name: GetMeetingRecordingByID :one
-- tenant: by-id
SELECT * FROM meeting_recordings WHERE id = $1 AND meeting_id = $2;

-- name: GetActiveMeetingRecording :one
-- tenant: parent meeting_id
SELECT * FROM meeting_recordings WHERE meeting_id = $1 AND status = 'ACTIVE' ORDER BY started_at DESC LIMIT 1;

-- name: FinishMeetingRecording :one
-- tenant: by-id
UPDATE meeting_recordings
SET status = $2, file_url = COALESCE(sqlc.narg('file_url'), file_url), ended_at = now()
WHERE id = $1 AND status = 'ACTIVE'
RETURNING *;

-- name: FinishRecordingByEgress :one
-- tenant: system
UPDATE meeting_recordings
SET status = $2, file_url = COALESCE(sqlc.narg('file_url'), file_url), ended_at = COALESCE(ended_at, now())
WHERE egress_id = $1 AND status IN ('ACTIVE', 'PROCESSING')
RETURNING *;

-- name: ListOverdueInProgressMeetings :many
-- tenant: system
-- Empty/idle rooms past ends_at, or ACTIVE rooms past the overtime cutoff
-- (now − 2h). Live = session status ACTIVE only; IDLE does not keep the row.
SELECT m.* FROM meetings m
WHERE m.status = 'IN_PROGRESS'
  AND m.ends_at < sqlc.arg('now')
  AND (
    NOT EXISTS (
      SELECT 1 FROM meeting_conference_sessions s
      WHERE s.meeting_id = m.id
        AND s.status = 'ACTIVE'
    )
    OR m.ends_at < sqlc.arg('overtime_cutoff')
  )
LIMIT 50;

-- name: HasMeetingSummarySource :one
-- tenant: parent meeting_id
-- C-11 §9.1 V1: the same "anything to summarize" test Summarize applies
-- (transcript, notes, meeting chat or a closed motion), as one round trip.
SELECT (
  EXISTS (SELECT 1 FROM meeting_transcript_segments WHERE meeting_id = sqlc.arg(meeting_id)::text)
  OR EXISTS (SELECT 1 FROM meeting_notes WHERE meeting_id = sqlc.arg(meeting_id)::text)
  OR EXISTS (SELECT 1 FROM meeting_chat_messages WHERE meeting_id = sqlc.arg(meeting_id)::text)
  OR EXISTS (SELECT 1 FROM meeting_motions WHERE meeting_id = sqlc.arg(meeting_id)::text AND status = 'CLOSED')
)::boolean AS has_source;

-- name: ListTranscriptSegmentsByIDs :many
-- The cited segments of one meeting (UNI-2002 evidence); an id of another
-- meeting or tenant is simply absent.
SELECT * FROM meeting_transcript_segments
WHERE organization_id = sqlc.arg(organization_id) AND meeting_id = sqlc.arg(meeting_id)
  AND id = ANY(sqlc.arg(ids)::text[]);
