CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_chat_voice_recordings_egress
  ON chat_voice_recordings (egress_id)
  WHERE egress_id <> '';
