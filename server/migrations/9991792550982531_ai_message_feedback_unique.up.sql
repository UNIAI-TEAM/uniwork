CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_ai_message_feedback_message_user
  ON ai_message_feedback (message_id, created_by);
