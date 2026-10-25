CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ai_memory_proposals_message
  ON ai_memory_proposals (message_id);
