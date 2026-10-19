CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_chat_thread_followers_user_ws
  ON chat_thread_followers (user_id, workspace_id)
  WHERE muted = false;
