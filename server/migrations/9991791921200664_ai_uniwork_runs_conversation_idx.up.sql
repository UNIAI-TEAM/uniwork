-- Every run lifecycle read is keyed by conversation: the orphan patch of the
-- sweep (AiUniworkOrphanRunIDs) and the per-conversation reads of the store
-- (design §3.2, §3.4).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ai_uniwork_runs_conversation
  ON ai_uniwork_runs (conversation_id);
