CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_chat_messages_file_id
  ON chat_messages (file_id)
  WHERE file_id IS NOT NULL;
