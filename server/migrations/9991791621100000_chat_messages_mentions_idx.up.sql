CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_chat_messages_mentions
  ON chat_messages (room_id, created_at)
  WHERE deleted_at IS NULL AND thread_root_id IS NULL
    AND (metadata ? 'mentioned_user_ids' OR metadata ? 'mentions_all');
