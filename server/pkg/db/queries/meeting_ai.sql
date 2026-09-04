-- name: InsertTranscriptSegment :one
INSERT INTO meeting_transcript_segments (id, meeting_id, participant_id, speaker_name, text, spoken_at)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING *;

-- name: ListTranscriptSegments :many
SELECT * FROM meeting_transcript_segments WHERE meeting_id = $1 ORDER BY spoken_at ASC, id ASC LIMIT $2;

-- name: InsertMeetingSummary :one
INSERT INTO meeting_summaries (id, meeting_id, summary, decisions, action_items, model, created_by)
VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING *;

-- name: GetLatestMeetingSummary :one
SELECT * FROM meeting_summaries WHERE meeting_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1;

-- name: InsertMeetingRecording :one
INSERT INTO meeting_recordings (id, meeting_id, egress_id, started_by)
VALUES ($1, $2, $3, $4)
RETURNING *;

-- name: ListMeetingRecordings :many
SELECT * FROM meeting_recordings WHERE meeting_id = $1 ORDER BY started_at DESC;

-- name: GetActiveMeetingRecording :one
SELECT * FROM meeting_recordings WHERE meeting_id = $1 AND status = 'ACTIVE' ORDER BY started_at DESC LIMIT 1;

-- name: FinishMeetingRecording :one
UPDATE meeting_recordings
SET status = $2, file_url = COALESCE(sqlc.narg('file_url'), file_url), ended_at = now()
WHERE id = $1 AND status = 'ACTIVE'
RETURNING *;

-- name: FinishRecordingByEgress :one
UPDATE meeting_recordings
SET status = $2, file_url = COALESCE(sqlc.narg('file_url'), file_url), ended_at = COALESCE(ended_at, now())
WHERE egress_id = $1 AND status IN ('ACTIVE', 'PROCESSING')
RETURNING *;

-- name: ListOverdueInProgressMeetings :many
SELECT m.* FROM meetings m
WHERE m.status = 'IN_PROGRESS'
  AND m.ends_at < $1
LIMIT 50;
