-- The worker's queue: open rows by when they are due.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_meeting_transcriptions_queue
  ON meeting_transcriptions (next_attempt_at) WHERE status IN ('QUEUED', 'RUNNING');
