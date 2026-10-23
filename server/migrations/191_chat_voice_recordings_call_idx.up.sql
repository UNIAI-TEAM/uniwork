CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_chat_voice_recordings_call
  ON chat_voice_recordings (room_id, call_id, started_at DESC);
