CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ai_memory_proposals_conversation
  ON ai_memory_proposals (conversation_id);
