-- Meetings follow-through đợt 5 (UNI-2001, parent spec §5.3, §6.4, §7.3,
-- §7.4): a meeting held without a room, uploaded recordings and their batch
-- transcription.

-- name: RecordMeetingHeld :one
-- tenant: by-id
-- SCHEDULED → ENDED without a room, at the times the host reports.
UPDATE meetings SET
  status = 'ENDED',
  actual_start_at = sqlc.arg('started_at'),
  actual_end_at = sqlc.arg('ended_at'),
  updated_by = sqlc.arg('updated_by'),
  updated_at = now(),
  version = version + 1
WHERE id = sqlc.arg('id') AND status = 'SCHEDULED' AND version = sqlc.arg('version')
RETURNING *;

-- name: InsertMeetingTranscription :one
INSERT INTO meeting_transcriptions (
  id, organization_id, workspace_id, meeting_id, file_id, filename, content_type, size_bytes,
  estimated_seconds, starts_at, language, created_by, created_by_kind
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
RETURNING *;

-- name: ListMeetingTranscriptions :many
-- tenant: parent meeting_id
SELECT * FROM meeting_transcriptions WHERE meeting_id = $1 ORDER BY created_at DESC, id DESC LIMIT 100;

-- name: GetMeetingTranscription :one
-- tenant: by-id
SELECT * FROM meeting_transcriptions WHERE id = $1;

-- name: MeetingTranscriptionFileStart :one
-- tenant: parent meeting_id
-- Where a new part starts on the meeting's clock: a file transcribed before
-- keeps its place; another follows every earlier file that did not fail,
-- each counted by its reported length, else its estimate.
SELECT
  (SELECT t.starts_at FROM meeting_transcriptions t
    WHERE t.meeting_id = sqlc.arg('meeting_id') AND t.file_id = sqlc.arg('file_id')
    ORDER BY t.created_at, t.id LIMIT 1)::timestamptz AS previous_start,
  -- FAILED is filtered before the pick: a file whose re-run failed still
  -- shows its earlier COMPLETE run, so it still takes its time.
  COALESCE((SELECT sum(COALESCE(p.audio_seconds, p.estimated_seconds)) FROM (
    SELECT DISTINCT ON (t.file_id) t.audio_seconds, t.estimated_seconds
    FROM meeting_transcriptions t
    WHERE t.meeting_id = sqlc.arg('meeting_id') AND t.file_id <> sqlc.arg('file_id') AND t.status <> 'FAILED'
    ORDER BY t.file_id, t.created_at DESC, t.id DESC
  ) p), 0)::bigint AS earlier_seconds;

-- name: LockTranscriptionQuota :exec
-- Serializes one organization's requests: otherwise two at once each sum the
-- open jobs without the other's row and both pass the quota check.
SELECT pg_advisory_xact_lock(hashtextextended('meeting_transcription_quota:' || sqlc.arg(organization_id)::text, 0));

-- name: OpenTranscriptionMinutes :one
-- Minutes the organization's queued and running jobs were estimated at:
-- not metered yet, already promised.
SELECT COALESCE(sum(ceil(estimated_seconds / 60.0)), 0)::bigint
FROM meeting_transcriptions
WHERE organization_id = $1 AND status IN ('QUEUED', 'RUNNING');

-- name: ClaimMeetingTranscriptions :many
-- tenant: system
-- The worker's claim: due open rows nobody holds, leased for lease_seconds.
-- The lease value is the holder's token for every later write. Every time
-- here is the database's clock, so nodes with drifting clocks agree.
UPDATE meeting_transcriptions SET lease_until = now() + make_interval(secs => sqlc.arg('lease_seconds')::int)
WHERE id IN (
  SELECT t.id FROM meeting_transcriptions t
  WHERE t.status IN ('QUEUED', 'RUNNING') AND t.next_attempt_at <= now()
    AND (t.lease_until IS NULL OR t.lease_until < now())
  ORDER BY t.next_attempt_at, t.id
  LIMIT sqlc.arg('row_limit')
  FOR UPDATE SKIP LOCKED
)
RETURNING *;

-- name: MarkTranscriptionSubmitted :execrows
-- tenant: by-id
UPDATE meeting_transcriptions SET
  status = 'RUNNING', provider = sqlc.arg('provider'), model = sqlc.arg('model'),
  provider_job_id = sqlc.arg('provider_job_id'), usage_event_id = sqlc.arg('usage_event_id'),
  attempts = attempts + 1, started_at = COALESCE(started_at, now()),
  deadline_at = now() + make_interval(secs => sqlc.arg('job_seconds')::int),
  next_attempt_at = now() + make_interval(secs => sqlc.arg('after_seconds')::int),
  lease_until = NULL
WHERE id = sqlc.arg('id') AND lease_until = sqlc.arg('lease');

-- name: RescheduleTranscription :execrows
-- tenant: by-id
-- Still running at the vendor: ask again later.
UPDATE meeting_transcriptions SET next_attempt_at = now() + make_interval(secs => sqlc.arg('after_seconds')::int), lease_until = NULL
WHERE id = sqlc.arg('id') AND lease_until = sqlc.arg('lease');

-- name: RetryTranscription :execrows
-- tenant: by-id
-- One attempt failed and another is left: back to the queue after a pause.
UPDATE meeting_transcriptions SET
  status = 'QUEUED', provider_job_id = '', deadline_at = NULL, error_code = sqlc.arg('error_code'),
  attempts = sqlc.arg('attempts'), next_attempt_at = now() + make_interval(secs => sqlc.arg('after_seconds')::int),
  lease_until = NULL
WHERE id = sqlc.arg('id') AND lease_until = sqlc.arg('lease');

-- name: FailTranscription :one
-- tenant: by-id
UPDATE meeting_transcriptions SET
  status = 'FAILED', error_code = sqlc.arg('error_code'), attempts = sqlc.arg('attempts'),
  completed_at = now(), lease_until = NULL
WHERE id = sqlc.arg('id') AND lease_until = sqlc.arg('lease') AND status IN ('QUEUED', 'RUNNING')
RETURNING *;

-- name: CompleteTranscription :one
-- tenant: by-id
UPDATE meeting_transcriptions SET
  status = 'COMPLETE', audio_seconds = sqlc.arg('audio_seconds'), model = sqlc.arg('model'),
  error_code = '', completed_at = now(), lease_until = NULL
WHERE id = sqlc.arg('id') AND lease_until = sqlc.arg('lease') AND status = 'RUNNING'
RETURNING *;

-- name: InsertTranscriptionSegment :exec
INSERT INTO meeting_transcript_segments (
  id, meeting_id, organization_id, speaker_name, text, spoken_at,
  source, transcription_id, start_ms, end_ms, speaker_label, language
) VALUES ($1, $2, $3, '', $4, $5, 'TRANSCRIPTION', $6, $7, $8, $9, $10);

-- name: TranscriptSources :one
-- tenant: parent meeting_id
-- Parent spec §7.3: per uploaded file, its latest COMPLETE transcription;
-- the scribe's lines only while no upload completed (UNI-1995 #11: an upload
-- is the high-accuracy re-pass that replaces them); Web Speech captions only
-- when neither exists.
SELECT
  EXISTS (SELECT 1 FROM meeting_transcript_segments s
    WHERE s.meeting_id = sqlc.arg('meeting_id') AND s.source = 'AGENT')::boolean AS has_agent,
  COALESCE((SELECT array_agg(l.id)::text[] FROM (
    SELECT DISTINCT ON (t.file_id) t.id FROM meeting_transcriptions t
    WHERE t.meeting_id = sqlc.arg('meeting_id') AND t.status = 'COMPLETE'
    ORDER BY t.file_id, t.completed_at DESC, t.id DESC
  ) l), '{}')::text[] AS transcription_ids;

-- name: ListMeetingTranscriptionFileHolds :many
-- tenant: system
-- FS-C1 section 6: a transcription row holds its uploaded recording.
SELECT DISTINCT file_id FROM meeting_transcriptions WHERE file_id = ANY($1::text[]);

-- name: GetMeetingAudioUpload :one
-- The completed meeting_audio session that staged file_id in this
-- organization: who uploaded it, and for which meeting.
SELECT * FROM file_multipart_uploads
WHERE file_id = sqlc.arg('file_id') AND organization_id = sqlc.arg('organization_id')
  AND opened_via = 'meeting_audio' AND status = 'completed';

-- name: TranscriptionOverdue :one
-- tenant: by-id
-- The job deadline, judged on the database's clock like every queue time;
-- a job still queued a day after it was requested is overdue too.
SELECT ((deadline_at IS NOT NULL AND deadline_at < now())
  OR (status = 'QUEUED' AND created_at < now() - interval '24 hours'))::boolean
FROM meeting_transcriptions WHERE id = $1;
