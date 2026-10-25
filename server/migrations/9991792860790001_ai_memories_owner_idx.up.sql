CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ai_memories_owner
  ON ai_memories (organization_id, user_id, created_at);
