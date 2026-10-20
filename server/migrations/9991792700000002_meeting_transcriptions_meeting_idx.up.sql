-- The meeting's transcriptions, newest first (GET .../transcriptions).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_meeting_transcriptions_meeting
  ON meeting_transcriptions (meeting_id, created_at);
