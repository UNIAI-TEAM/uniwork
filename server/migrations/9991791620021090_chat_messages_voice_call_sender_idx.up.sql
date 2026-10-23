CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_chat_messages_voice_call_sender
  ON chat_messages (sender_id, created_at)
  WHERE kind = 'voice_call_log';
