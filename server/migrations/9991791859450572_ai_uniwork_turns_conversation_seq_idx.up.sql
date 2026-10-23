-- Turns are read and pruned in seq order within one conversation; the
-- transcript replay and the 20-user-turn trim both walk this index.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ai_uniwork_turns_conversation_seq
  ON ai_uniwork_turns (conversation_id, seq);
