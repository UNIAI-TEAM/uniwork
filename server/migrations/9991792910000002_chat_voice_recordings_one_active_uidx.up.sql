CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_chat_voice_recordings_one_active
  ON chat_voice_recordings (room_id, call_id) WHERE status = 'ACTIVE';
