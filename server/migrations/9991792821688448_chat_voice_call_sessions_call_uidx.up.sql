CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_chat_voice_call_sessions_call ON chat_voice_call_sessions (room_id, call_id);
