-- A clerk corrects or removes transcript lines, and the retention sweep
-- removes the ones older than the organization keeps (UNI-1995 #5). Every
-- caller resolved the meeting through requireMeetingClerk (or is the
-- system sweep), so the meeting id is the tenant.

-- name: EditTranscriptSegment :one
-- tenant: parent meeting_id
-- original_text keeps the first wording, however often the line is fixed.
UPDATE meeting_transcript_segments
SET original_text = COALESCE(original_text, text), text = sqlc.arg('text'),
    edited_at = now(), edited_by = sqlc.arg('edited_by')
WHERE id = sqlc.arg('id') AND meeting_id = sqlc.arg('meeting_id')
RETURNING *;

-- name: DeleteTranscriptSegment :execrows
-- tenant: parent meeting_id
DELETE FROM meeting_transcript_segments WHERE id = sqlc.arg('id') AND meeting_id = sqlc.arg('meeting_id');

-- name: DeleteTranscriptSegmentsBetweenLines :execrows
-- tenant: parent meeting_id
-- Every line from one line to another, both included, in reading order
-- (spoken_at, id), whatever its source. The bounds are the rows themselves,
-- so no time a client rounded can miss the last line. Nothing goes when
-- either line is not in the meeting or the end comes before the start.
WITH bounds AS (
  SELECT f.spoken_at AS from_at, f.id AS from_row, t.spoken_at AS to_at, t.id AS to_row
  FROM meeting_transcript_segments f, meeting_transcript_segments t
  WHERE f.meeting_id = sqlc.arg('meeting_id') AND f.id = sqlc.arg('from_id')
    AND t.meeting_id = sqlc.arg('meeting_id') AND t.id = sqlc.arg('to_id')
)
DELETE FROM meeting_transcript_segments s USING bounds
WHERE s.meeting_id = sqlc.arg('meeting_id')
  AND s.spoken_at >= bounds.from_at AND s.spoken_at <= bounds.to_at
  AND (s.spoken_at, s.id) >= (bounds.from_at, bounds.from_row) AND (s.spoken_at, s.id) <= (bounds.to_at, bounds.to_row);

-- name: DeleteMeetingTranscriptSegments :execrows
-- tenant: parent meeting_id
DELETE FROM meeting_transcript_segments WHERE meeting_id = sqlc.arg('meeting_id');

-- name: DeleteMeetingLiveTranscript :execrows
-- tenant: parent meeting_id
-- A completed upload replaces the scribe's lines and the captions (#11).
DELETE FROM meeting_transcript_segments
WHERE meeting_id = sqlc.arg('meeting_id') AND source IN ('AGENT', 'CAPTION');

-- name: DeleteTranscriptionSegments :execrows
-- tenant: parent meeting_id
DELETE FROM meeting_transcript_segments
WHERE meeting_id = sqlc.arg('meeting_id') AND transcription_id = sqlc.arg('transcription_id')::text;

-- name: DeleteMeetingTranscription :one
-- tenant: parent meeting_id
-- A job the worker no longer runs; a queued or running one is refused.
DELETE FROM meeting_transcriptions
WHERE id = sqlc.arg('id') AND meeting_id = sqlc.arg('meeting_id') AND status IN ('COMPLETE', 'FAILED')
RETURNING *;

-- name: MarkMeetingSummariesTranscriptChanged :exec
-- tenant: parent meeting_id
UPDATE meeting_summaries SET transcript_changed_at = now()
WHERE meeting_id = sqlc.arg('meeting_id') AND transcript_changed_at IS NULL;

-- name: SetMeetingTranscriptRetention :one
-- The organization's window; the auto-summary switch keeps its value (on
-- for an organization that never touched it).
INSERT INTO meeting_settings (organization_id, transcript_retention_days, updated_by, updated_by_kind)
VALUES (sqlc.arg(organization_id), sqlc.narg(days), sqlc.arg(updated_by), sqlc.arg(updated_by_kind))
ON CONFLICT (organization_id) DO UPDATE
SET transcript_retention_days = EXCLUDED.transcript_retention_days,
    updated_by = EXCLUDED.updated_by,
    updated_by_kind = EXCLUDED.updated_by_kind,
    updated_at = now()
RETURNING *;

-- name: ListTranscriptRetentionSettings :many
-- tenant: system
-- The organizations that keep transcripts only for a while.
SELECT organization_id, transcript_retention_days::int AS days FROM meeting_settings
WHERE transcript_retention_days IS NOT NULL
ORDER BY organization_id;

-- name: ListMeetingsWithExpiredTranscript :many
SELECT DISTINCT meeting_id FROM meeting_transcript_segments
WHERE organization_id = sqlc.arg(organization_id) AND created_at < sqlc.arg(cutoff)::timestamptz
LIMIT sqlc.arg(row_limit);

-- name: DeleteExpiredTranscriptSegments :execrows
DELETE FROM meeting_transcript_segments
WHERE organization_id = sqlc.arg(organization_id) AND meeting_id = sqlc.arg(meeting_id)
  AND created_at < sqlc.arg(cutoff)::timestamptz;

-- name: ListExpiredMeetingTranscriptions :many
-- Uploaded recordings older than the window, oldest first; jobs still
-- queued or running wait for the worker. A small table: no index of its own.
SELECT * FROM meeting_transcriptions
WHERE organization_id = sqlc.arg(organization_id) AND created_at < sqlc.arg(cutoff)::timestamptz
  AND status IN ('COMPLETE', 'FAILED')
ORDER BY created_at, id
LIMIT sqlc.arg(row_limit);

-- name: TranscriptRetentionTryLock :one
-- Run lease of the retention sweep (the file_gc pattern): a session lock
-- held on one connection for the pass, so one replica sweeps at a time.
SELECT pg_try_advisory_lock(sqlc.arg('lock_key')::bigint) AS locked;

-- name: TranscriptRetentionUnlock :one
SELECT pg_advisory_unlock(sqlc.arg('lock_key')::bigint) AS unlocked;
