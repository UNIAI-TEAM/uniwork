CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_agent_action_proposals_conversation
  ON agent_action_proposals (conversation_id);
