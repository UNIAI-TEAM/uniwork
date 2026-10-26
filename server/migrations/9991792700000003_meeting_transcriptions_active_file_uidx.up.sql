-- One running transcription per file: a second request answers 409
-- transcription_in_progress.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uidx_meeting_transcriptions_active_file
  ON meeting_transcriptions (file_id) WHERE status IN ('QUEUED', 'RUNNING');
