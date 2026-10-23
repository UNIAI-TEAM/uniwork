CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_chat_messages_room_created
  ON chat_messages (room_id, created_at DESC);
