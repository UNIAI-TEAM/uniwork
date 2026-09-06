-- Backs AiListMessages in conversation order.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ai_messages_conversation_time
  ON ai_messages (conversation_id, created_at);
