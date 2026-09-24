CREATE INDEX CONCURRENTLY idx_chat_messages_thread
  ON chat_messages (thread_root_id, created_at)
  WHERE thread_root_id IS NOT NULL;
